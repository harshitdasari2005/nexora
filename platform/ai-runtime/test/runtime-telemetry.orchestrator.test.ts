/**
 * @nexora/ai-runtime — orchestrator runtime telemetry (Prompt 7).
 *
 * The orchestrator wraps every run with a RunTelemetryHub: one RuntimeRun per
 * run, stages only when used, failure classification, approval facts (the
 * human wait is never part of the run's latency) and one ModelCall per
 * narration — recorded WITHOUT prompt/response content, and never changing the
 * run's outcome.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';
import { PolicyEngine, type PolicyRule } from '@nexora/module-policy';
import { RunTelemetryHub, type ModelPricing, type RuntimeRun } from '@nexora/module-observability';
import { nowIso } from '@nexora/shared/time';

import { EnterpriseAIOrchestrator } from '../src/orchestrator/orchestrator.js';
import type { OrchestratorResponse } from '../src/orchestrator/request.js';
import { ConversationManager } from '../src/conversation/conversation-manager.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { ToolExecutor } from '../src/execution/tool-executor.js';
import { DefaultPolicyPort } from '../src/execution/policy-port.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { ProviderRegistry } from '../src/providers/provider-registry.js';
import { PromptRegistry } from '../src/prompting/prompt-registry.js';
import { createNarrationPrompt, NARRATION_PROMPT_ID } from '../src/prompting/narration-prompt.js';
import {
  InMemoryApprovalEngine,
  type ApprovalRequestRecord,
  type OpenApprovalInput,
} from '../src/approval/engine.js';
import { SequentialPlanner } from '../src/planner/sequential-planner.js';
import type { PlanningStrategy } from '../src/planner/planning-strategy.js';
import type { ChatRequest, ChatResponse } from '../src/providers/chat-provider.js';
import type { ModelProvider } from '../src/providers/model-provider.js';
import { ProviderError } from '../src/errors/index.js';

const baseRequest = { userId: 'usr_1', tenantId: 'org_1', workspaceId: 'wsp_1' };

const TOOL_OUTPUT_CANARY = 'CANARY-TOOL-OUTPUT-4f1c';
const UTTERANCE_CANARY = 'CANARY-UTTERANCE-9d2e';
const RESPONSE_CANARY = 'CANARY-MODEL-RESPONSE-7a3b';

const READ = 'projects.list_projects';
const WRITE = 'workspaces.create_workspace';

/** Answers a completion: scripted per test. */
type Completer = (request: ChatRequest) => Promise<ChatResponse> | ChatResponse;

/** A model provider whose `execution` and completions the test controls. */
function fakeProvider(
  complete: Completer,
  execution: 'local' | 'cloud' | null = 'cloud',
): { provider: ModelProvider; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const provider: ModelProvider = {
    id: 'fake-llm',
    name: 'Fake LLM',
    capabilities: ['chat'],
    models: ['fake-model-default'],
    ...(execution === null ? {} : { execution }),
    chat: {
      id: 'fake-llm',
      complete: async (request) => {
        requests.push(request);
        return complete(request);
      },
    },
  };
  return { provider, requests };
}

const okResponse = (overrides: Partial<ChatResponse> = {}): ChatResponse => ({
  content: RESPONSE_CANARY,
  finishReason: 'stop',
  model: 'fake-model',
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  ...overrides,
});

interface HarnessOptions {
  hub?: RunTelemetryHub;
  provider?: ModelProvider;
  policy?: DefaultPolicyPort;
  planner?: PlanningStrategy;
  approvals?: InMemoryApprovalEngine;
  extractor?: (input: { intent: string }) => Record<string, unknown>;
}

const defaultExtractor = (input: { intent: string }): Record<string, unknown> => {
  const match = input.intent.match(/called\s+([A-Za-z0-9]+)/i);
  return match?.[1] === undefined ? {} : { name: match[1] };
};

function harness(options: HarnessOptions = {}): {
  orchestrator: EnterpriseAIOrchestrator;
  writes: () => number;
} {
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  const tools = new ExecutableToolRegistry();
  let writes = 0;

  const capability = (id: string, description: string, skillId: string, effect: string) =>
    registryEntries.capability({
      capability: {
        id,
        name: id,
        description,
        skillId,
        sideEffectClass: effect as 'read_only' | 'consequential',
      },
      owner: 'test',
      version: '1.0.0',
    });
  registry.register(
    capability(READ, 'Lists projects and their health', 'projects.list', 'read_only'),
  );
  registry.register(
    capability(
      WRITE,
      'Creates a new workspace in the organization',
      'workspaces.create',
      'consequential',
    ),
  );
  const toolEntry = (id: string, effect: string, idempotent: boolean, agent: string) =>
    registryEntries.tool({
      tool: {
        id,
        description: id,
        sideEffectClass: effect as 'read_only' | 'consequential',
        idempotent,
        timeoutMs: 1000,
        inputSchema:
          effect === 'read_only'
            ? {}
            : {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
                additionalProperties: false,
              },
      },
      owner: 'test',
      version: '1.0.0',
      ownedByAgents: [agent],
    });
  registry.register(toolEntry(READ, 'read_only', true, 'agt_projects'));
  registry.register(toolEntry(WRITE, 'consequential', false, 'agt_workspaces'));

  const agent = (id: string, skill: string, toolId: string, requiresApproval: boolean) =>
    registryEntries.agent({
      agent: { id, name: id, displayName: id },
      manifest: {
        identity: { id, name: id, displayName: id },
        version: '1.0.0',
        skills: [
          {
            id: skill,
            description: skill,
            toolIds: [toolId],
            autonomyTier: 'supervised',
            requiresApproval,
          },
        ],
        tools: [],
        knowledgeScopes: [],
        policyIds: [],
        emittedEventTypes: [],
        subscribedEventTypes: [],
        updatedAt: '2026-08-08T00:00:00.000Z',
      },
      health: 'healthy',
      owner: 'test',
      version: '1.0.0',
    });
  registry.register(agent('agt_projects', 'projects.list', READ, false));
  registry.register(agent('agt_workspaces', 'workspaces.create', WRITE, true));
  skills.index(
    {
      id: 'projects.list',
      description: 'Lists projects and their health',
      toolIds: [READ],
      autonomyTier: 'supervised' as const,
      requiresApproval: false,
    },
    'agt_projects',
  );
  skills.index(
    {
      id: 'workspaces.create',
      description: 'Creates a new workspace in the organization',
      toolIds: [WRITE],
      autonomyTier: 'supervised' as const,
      requiresApproval: true,
    },
    'agt_workspaces',
  );

  const readTool: Tool = {
    manifest: {
      id: READ,
      name: READ,
      description: READ,
      sideEffectClass: 'read_only',
      idempotent: true,
      timeoutMs: 1000,
      inputSchema: {},
    },
    execute: async () => ({
      ok: true,
      output: { projects: [{ name: TOOL_OUTPUT_CANARY, health: 'red' }] },
      completedAt: nowIso(),
    }),
  };
  const writeTool: Tool = {
    manifest: {
      id: WRITE,
      name: WRITE,
      description: WRITE,
      sideEffectClass: 'consequential',
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
    execute: async (input) => {
      writes += 1;
      return {
        ok: true,
        output: { workspace: { id: `wsp_${writes}`, name: String(input['name']) } },
        completedAt: nowIso(),
      };
    },
  };
  tools.register(readTool);
  tools.register(writeTool);

  let providers: ProviderRegistry | undefined;
  let prompts: PromptRegistry | undefined;
  if (options.provider !== undefined) {
    providers = new ProviderRegistry();
    providers.register(options.provider);
    prompts = new PromptRegistry();
    prompts.register(createNarrationPrompt());
  }

  const orchestrator = new EnterpriseAIOrchestrator({
    discovery: new CapabilityDiscovery(registry, skills),
    executor: new ToolExecutor({
      tools,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.hub === undefined ? {} : { telemetry: options.hub }),
    }),
    conversations: new ConversationManager(new InMemoryConversationStore()),
    planner:
      options.planner ??
      new SequentialPlanner({ parameterExtractor: options.extractor ?? defaultExtractor }),
    ...(options.approvals === undefined ? {} : { approvals: options.approvals }),
    ...(providers === undefined
      ? {}
      : { providers, prompts, narrationPromptId: NARRATION_PROMPT_ID }),
    ...(options.hub === undefined ? {} : { runTelemetry: options.hub }),
  });
  return { orchestrator, writes: () => writes };
}

function hubWithSink(pricing?: ModelPricing): { hub: RunTelemetryHub; runs: RuntimeRun[] } {
  const runs: RuntimeRun[] = [];
  const hub = new RunTelemetryHub({
    ...(pricing === undefined ? {} : { pricing }),
    sink: (run) => void runs.push(run),
  });
  return { hub, runs };
}

/** The one run a test's hub recorded. */
function only(runs: readonly RuntimeRun[]): RuntimeRun {
  expect(runs).toHaveLength(1);
  return runs[0]!;
}

const HEX64 = /^[0-9a-f]{64}$/;

describe('orchestrator run telemetry — basics', () => {
  it('records one run per run with status, requestId, origin and only the stages used', async () => {
    const { hub, runs } = hubWithSink();
    const { orchestrator } = harness({ hub });
    const response = await orchestrator.run({
      ...baseRequest,
      utterance: 'list projects',
      requestId: 'req_abc',
    });
    expect(response.status).toBe('completed');

    const run = only(runs);
    expect(run).toMatchObject({
      tenantId: 'org_1',
      workspaceId: 'wsp_1',
      actorId: 'usr_1',
      requestId: 'req_abc',
      origin: 'chat',
      status: 'completed',
      schemaVersion: 1,
    });
    expect(run.id).toMatch(/^run_/);
    expect(run.failure).toBeUndefined();
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(run.endedAt)).toBeGreaterThanOrEqual(Date.parse(run.startedAt));

    const stages = run.stages.map((s) => s.stage);
    expect(stages).toEqual(expect.arrayContaining(['REQUEST', 'PLANNING', 'POLICY', 'NARRATION']));
    // A pure retrieval-free read used no approval and (with one tool) exactly one execution.
    expect(stages).not.toContain('APPROVAL');
    expect(stages).toContain('EXECUTION');
    expect(run.tools).toHaveLength(1);
    expect(run.tools[0]).toMatchObject({ toolId: READ, status: 'succeeded', verified: true });
    expect(run.approval).toBeUndefined();
    // No provider configured: no model calls, tokens unavailable, cost null.
    expect(run.models).toEqual([]);
    expect(run.tokenUsage.available).toBe(false);
    expect(run.cost.estimated).toBeNull();
  });

  it('stages are absent when unused: a clarification run has no EXECUTION/APPROVAL/POLICY', async () => {
    const { hub, runs } = hubWithSink();
    const { orchestrator } = harness({ hub });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'zzzz qqqq' });
    expect(response.status).toBe('clarification');
    const run = only(runs);
    expect(run.status).toBe('clarification');
    const stages = run.stages.map((s) => s.stage);
    expect(stages).not.toContain('EXECUTION');
    expect(stages).not.toContain('APPROVAL');
    expect(stages).not.toContain('POLICY');
    expect(run.tools).toEqual([]);
  });

  it('the sink receives exactly one record per run, and the hub retains none', async () => {
    const { hub, runs } = hubWithSink();
    const { orchestrator } = harness({ hub });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((r) => r.id)).size).toBe(2);
    for (const run of runs) expect(hub.get(run.id)).toBeUndefined();
  });

  it('a throwing sink never affects the run response', async () => {
    const hub = new RunTelemetryHub({
      sink: () => {
        throw new Error('sink down');
      },
    });
    const { orchestrator } = harness({ hub });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(response.status).toBe('completed');
  });
});

describe('orchestrator run telemetry — failure classification', () => {
  it('a policy denial => stage POLICY / POLICY_DENIED / DENIED and no tool calls', async () => {
    const { hub, runs } = hubWithSink();
    const denyRule: PolicyRule = {
      id: 'POLICY_TEST_DENY',
      version: '1',
      evaluate: () => ({ outcome: 'DENY', reasonCode: 'TEST', reason: 'denied' }),
    };
    const { orchestrator } = harness({
      hub,
      policy: new DefaultPolicyPort(new PolicyEngine([denyRule])),
    });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(response.status).toBe('failed');
    const run = only(runs);
    expect(run.status).toBe('failed');
    expect(run.failure).toMatchObject({
      stage: 'POLICY',
      code: 'POLICY_DENIED',
      class: 'DENIED',
      sourceCode: 'POLICY_DENIED',
    });
    expect(run.tools).toEqual([]);
    expect(run.stages.map((s) => s.stage)).not.toContain('EXECUTION');
    expect(run.policies[0]).toMatchObject({ outcome: 'DENY', phase: 'precheck' });
  });

  it('a planner failure classifies as PLANNING', async () => {
    const { hub, runs } = hubWithSink();
    const planner: PlanningStrategy = {
      name: 'failing',
      plan: () => ({ success: false, strategy: 'failing', reason: 'cannot plan' }),
    };
    const { orchestrator } = harness({ hub, planner });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(response.status).toBe('failed');
    const run = only(runs);
    expect(run.failure).toMatchObject({ stage: 'PLANNING', class: 'INPUT' });
    expect(run.tools).toEqual([]);
  });

  it('a thrown orchestrator error still ends the run as failed (INTERNAL) and rethrows', async () => {
    const { hub, runs } = hubWithSink();
    const planner: PlanningStrategy = {
      name: 'throwing',
      plan: () => {
        throw new TypeError('planner exploded');
      },
    };
    const { orchestrator } = harness({ hub, planner });
    await expect(orchestrator.run({ ...baseRequest, utterance: 'list projects' })).rejects.toThrow(
      'planner exploded',
    );
    const run = only(runs);
    expect(run.status).toBe('failed');
    expect(run.failure).toMatchObject({ code: 'INTERNAL_ERROR', class: 'INTERNAL' });
    // The error message is never recorded.
    expect(JSON.stringify(run)).not.toContain('planner exploded');
  });
});

describe('orchestrator run telemetry — approvals', () => {
  /** An approval engine whose requests are created an hour ago (a slow human). */
  class SlowHumanApprovals extends InMemoryApprovalEngine {
    static readonly WAIT_MS = 60 * 60 * 1000;

    override open(input: OpenApprovalInput): ApprovalRequestRecord {
      const request = super.open(input);
      request.createdAt = new Date(Date.now() - SlowHumanApprovals.WAIT_MS).toISOString();
      return request;
    }
  }

  const CREATE = 'create a workspace called Engineering';

  it('an approval-gated run records state "opened" with createdAt and NO waitMs', async () => {
    const { hub, runs } = hubWithSink();
    const approvals = new SlowHumanApprovals();
    const { orchestrator, writes } = harness({ hub, approvals });
    const response = await orchestrator.run({ ...baseRequest, utterance: CREATE });
    expect(response.status).toBe('blocked');
    expect(writes()).toBe(0);

    const run = only(runs);
    expect(run.status).toBe('blocked');
    expect(run.failure).toBeUndefined();
    expect(run.approval).toBeDefined();
    expect(run.approval).toMatchObject({ state: 'opened' });
    expect(run.approval?.approvalId).toMatch(/^apr_/);
    expect(typeof run.approval?.createdAt).toBe('string');
    expect(run.approval?.waitMs).toBeUndefined();
    expect(run.approval?.decidedAt).toBeUndefined();
    expect(run.stages.map((s) => s.stage)).toContain('APPROVAL');
    expect(run.tools).toEqual([]);
  });

  it('a resumed run records "resumed" with waitMs = decidedAt - createdAt, excluded from the run duration', async () => {
    const { hub, runs } = hubWithSink();
    const approvals = new SlowHumanApprovals();
    const { orchestrator, writes } = harness({ hub, approvals });
    const first = await orchestrator.run({ ...baseRequest, utterance: CREATE });
    const approvalId = first.approvals[0]?.id as string;
    approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_1' });

    const resumed = await orchestrator.run({
      ...baseRequest,
      utterance: CREATE,
      conversationId: first.conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('completed');
    expect(writes()).toBe(1);

    expect(runs).toHaveLength(2);
    const run = runs[1]!;
    expect(run.status).toBe('completed');
    const approval = run.approval;
    expect(approval).toMatchObject({ state: 'resumed', approvalId, decision: 'grant' });
    expect(approval?.createdAt).toBeDefined();
    expect(approval?.decidedAt).toBeDefined();
    expect(approval?.waitMs).toBe(
      Date.parse(approval!.decidedAt!) - Date.parse(approval!.createdAt!),
    );
    expect(approval!.waitMs!).toBeGreaterThanOrEqual(SlowHumanApprovals.WAIT_MS);
    // The human wait is NEVER part of the run's own latency.
    expect(run.durationMs).toBeLessThan(SlowHumanApprovals.WAIT_MS / 100);
    const stageTotal = run.stages.reduce((sum, s) => sum + s.durationMs, 0);
    expect(stageTotal).toBeLessThan(SlowHumanApprovals.WAIT_MS / 100);
    expect(run.tools).toHaveLength(1);
    expect(run.tools[0]).toMatchObject({ toolId: WRITE, approvalId, status: 'succeeded' });
  });

  it('a rejected decision records the reject and the wait, and blocks', async () => {
    const { hub, runs } = hubWithSink();
    const approvals = new SlowHumanApprovals();
    const { orchestrator, writes } = harness({ hub, approvals });
    const first = await orchestrator.run({ ...baseRequest, utterance: CREATE });
    const approvalId = first.approvals[0]?.id as string;
    approvals.decide(approvalId, { decision: 'reject', decidedBy: 'usr_1' });
    const resumed = await orchestrator.run({
      ...baseRequest,
      utterance: CREATE,
      conversationId: first.conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('blocked');
    expect(writes()).toBe(0);
    const run = runs[1]!;
    expect(run.approval).toMatchObject({ state: 'resumed', decision: 'reject' });
    expect(run.approval?.waitMs).toBeGreaterThan(0);
    expect(run.tools).toEqual([]);
  });

  it('approved arguments that no longer match => APPROVAL stage / APPROVAL_MISMATCH / APPROVAL', async () => {
    const { hub, runs } = hubWithSink();
    const approvals = new InMemoryApprovalEngine();
    let call = 0;
    const { orchestrator, writes } = harness({
      hub,
      approvals,
      // The second extraction (the resume) yields different arguments.
      extractor: () => ({ name: call++ === 0 ? 'Engineering' : 'Different' }),
    });
    const first = await orchestrator.run({ ...baseRequest, utterance: CREATE });
    const approvalId = first.approvals[0]?.id as string;
    approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_1' });
    const resumed = await orchestrator.run({
      ...baseRequest,
      utterance: CREATE,
      conversationId: first.conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('failed');
    expect(writes()).toBe(0);
    const run = runs[1]!;
    expect(run.failure).toMatchObject({
      stage: 'APPROVAL',
      code: 'APPROVAL_MISMATCH',
      class: 'APPROVAL',
    });
    expect(run.tools).toEqual([]);
  });
});

describe('orchestrator run telemetry — narration model calls', () => {
  it('records provider, execution (local/cloud), model from the completion, usage and fingerprints', async () => {
    for (const execution of ['local', 'cloud'] as const) {
      const { hub, runs } = hubWithSink();
      const { provider } = fakeProvider(() => okResponse(), execution);
      const { orchestrator } = harness({ hub, provider });
      const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
      expect(response.response).toBe(RESPONSE_CANARY);

      const run = only(runs);
      expect(run.models).toHaveLength(1);
      const call = run.models[0]!;
      expect(call).toMatchObject({
        purpose: 'narration',
        provider: 'fake-llm',
        execution,
        model: 'fake-model',
        status: 'succeeded',
        retries: 0,
        usageAvailable: true,
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        finishReason: 'stop',
        promptTemplateId: NARRATION_PROMPT_ID,
        promptVersion: createNarrationPrompt().version,
        narrationSource: 'model',
      });
      expect(call.callId).toMatch(/^mdl_/);
      expect(call.errorCode).toBeUndefined();
      expect(call.fallbackReason).toBeUndefined();
      expect(call.inputFingerprint).toMatch(HEX64);
      expect(call.outputFingerprint).toMatch(HEX64);
      expect(run.provider).toBe('fake-llm');
      expect(run.model).toBe('fake-model');
      expect(run.modelExecution).toBe(execution);
      expect(run.tokenUsage).toEqual({
        available: true,
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
      });
    }
  });

  it('a provider with no declared execution is "unknown"', async () => {
    const { hub, runs } = hubWithSink();
    const { provider } = fakeProvider(() => okResponse(), null);
    const { orchestrator } = harness({ hub, provider });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(only(runs).models[0]?.execution).toBe('unknown');
  });

  it('usage not reported => usageAvailable false, no token fields, tokenUsage.available false, cost null', async () => {
    const pricing: ModelPricing = {
      version: 'p1',
      currency: 'USD',
      models: { 'fake-llm/fake-model': { promptPer1k: 1, completionPer1k: 1 } },
    };
    const { hub, runs } = hubWithSink(pricing);
    const { provider } = fakeProvider(() => {
      const { usage: _usage, ...rest } = okResponse();
      void _usage;
      return rest;
    });
    const { orchestrator } = harness({ hub, provider });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    const run = only(runs);
    const call = run.models[0]!;
    expect(call.usageAvailable).toBe(false);
    expect(call).not.toHaveProperty('promptTokens');
    expect(call).not.toHaveProperty('completionTokens');
    expect(call).not.toHaveProperty('totalTokens');
    expect(call.cost).toBeNull();
    expect(run.tokenUsage.available).toBe(false);
    expect(run.tokenUsage.totalTokens).toBe(0);
    // Even WITH pricing configured, an unreported usage is never estimated.
    expect(run.cost.estimated).toBeNull();
  });

  it('cost is computed from configured pricing only when usage was reported', async () => {
    const pricing: ModelPricing = {
      version: 'p1',
      currency: 'USD',
      models: { 'fake-llm/fake-model': { promptPer1k: 0.5, completionPer1k: 1.5 } },
    };
    const { hub, runs } = hubWithSink(pricing);
    const { provider } = fakeProvider(() => okResponse());
    const { orchestrator } = harness({ hub, provider });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    const run = only(runs);
    // 100/1000 * 0.5 + 20/1000 * 1.5 = 0.05 + 0.03
    expect(run.models[0]?.cost).toBeCloseTo(0.08, 8);
    expect(run.models[0]).toMatchObject({ currency: 'USD', pricingVersion: 'p1' });
    expect(run.cost.estimated).toBeCloseTo(0.08, 8);
    expect(run.cost).toMatchObject({ currency: 'USD', pricingVersion: 'p1' });
  });

  it('with no pricing configured the cost is null even though usage is reported', async () => {
    const { hub, runs } = hubWithSink();
    const { provider } = fakeProvider(() => okResponse());
    const { orchestrator } = harness({ hub, provider });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    const run = only(runs);
    expect(run.models[0]?.usageAvailable).toBe(true);
    expect(run.models[0]?.cost).toBeNull();
    expect(run.cost.estimated).toBeNull();
  });

  it('never stores the raw prompt, utterance, model response or tool output anywhere in the run', async () => {
    const { hub, runs } = hubWithSink();
    const { provider, requests } = fakeProvider(() => okResponse());
    const { orchestrator } = harness({ hub, provider });
    await orchestrator.run({
      ...baseRequest,
      utterance: `list projects ${UTTERANCE_CANARY}`,
    });
    const run = only(runs);
    const serialized = JSON.stringify(run);
    expect(serialized).not.toContain(UTTERANCE_CANARY);
    expect(serialized).not.toContain(RESPONSE_CANARY);
    expect(serialized).not.toContain(TOOL_OUTPUT_CANARY);
    // Sanity: the canaries really did reach the model (so their absence is meaningful).
    const sent = JSON.stringify(requests);
    expect(sent).toContain(UTTERANCE_CANARY);
    expect(sent).toContain(TOOL_OUTPUT_CANARY);
    // Neither the system prompt text nor any message body is recorded.
    for (const message of requests[0]!.messages) {
      expect(serialized).not.toContain(message.content.slice(0, 60));
    }
    const template = createNarrationPrompt();
    expect(serialized).not.toContain(template.text.slice(0, 60));
  });

  it('a provider error => failed ModelCall (MODEL_ERROR), fallback narration, run still completes', async () => {
    const { hub, runs } = hubWithSink();
    const { provider } = fakeProvider(() => {
      throw new ProviderError('upstream 500 SECRET-PROVIDER-DETAIL', { model: 'fake-model' });
    });
    const { orchestrator } = harness({ hub, provider });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(response.status).toBe('completed');
    expect(response.response).not.toBe('');
    const run = only(runs);
    expect(run.status).toBe('completed');
    expect(run.failure).toBeUndefined();
    expect(run.models[0]).toMatchObject({
      status: 'failed',
      errorCode: 'MODEL_ERROR',
      narrationSource: 'fallback',
      fallbackReason: 'MODEL_ERROR',
      usageAvailable: false,
      provider: 'fake-llm',
      // The model asked to serve, since none answered.
      model: 'fake-model-default',
    });
    expect(run.models[0]?.inputFingerprint).toMatch(HEX64);
    expect(run.models[0]?.outputFingerprint).toBeUndefined();
    // The provider's message never reaches the record.
    expect(JSON.stringify(run)).not.toContain('SECRET-PROVIDER-DETAIL');
  });

  it('a provider error with details.timeout => MODEL_TIMEOUT', async () => {
    const { hub, runs } = hubWithSink();
    const { provider } = fakeProvider(() => {
      throw new ProviderError('fake-llm request timed out', { timeout: true });
    });
    const { orchestrator } = harness({ hub, provider });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(response.status).toBe('completed');
    expect(only(runs).models[0]).toMatchObject({
      status: 'failed',
      errorCode: 'MODEL_TIMEOUT',
      fallbackReason: 'MODEL_TIMEOUT',
      narrationSource: 'fallback',
    });
  });

  it('empty output => fallbackReason EMPTY_OUTPUT (call succeeded, deterministic narration used)', async () => {
    const { hub, runs } = hubWithSink();
    const { provider } = fakeProvider(() => okResponse({ content: '   ' }));
    const { orchestrator } = harness({ hub, provider });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(response.status).toBe('completed');
    expect(response.response.trim().length).toBeGreaterThan(0);
    expect(only(runs).models[0]).toMatchObject({
      status: 'succeeded',
      narrationSource: 'fallback',
      fallbackReason: 'EMPTY_OUTPUT',
      usageAvailable: true,
    });
  });

  it('a narration that discloses the system prompt => DISCLOSURE_DISCARDED', async () => {
    const { hub, runs } = hubWithSink();
    const leaked = createNarrationPrompt().text;
    const { provider } = fakeProvider(() => okResponse({ content: leaked }));
    const { orchestrator } = harness({ hub, provider });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(response.status).toBe('completed');
    expect(response.response).not.toContain('You are the Nexora Enterprise AI');
    const run = only(runs);
    expect(run.models[0]).toMatchObject({
      narrationSource: 'fallback',
      fallbackReason: 'DISCLOSURE_DISCARDED',
    });
    expect(JSON.stringify(run)).not.toContain('You are the Nexora Enterprise AI');
  });
});

describe('telemetry never changes the outcome of a run', () => {
  /** Compares two responses ignoring ids/timestamps that are unique per run. */
  function shape(response: OrchestratorResponse): unknown {
    return JSON.parse(
      JSON.stringify({
        status: response.status,
        response: response.response,
        steps: response.steps.map((s) => ({
          toolId: s.toolId,
          status: s.status,
          verified: s.verified,
          errorCode: s.errorCode,
          output: s.output,
        })),
        approvals: response.approvals.map((a) => ({ toolId: a.toolId, status: a.status })),
      }),
    );
  }

  it('identical outcome with and without a hub — read, denied, failed-planning and narrated runs', async () => {
    const denyRule: PolicyRule = {
      id: 'POLICY_TEST_DENY',
      version: '1',
      evaluate: () => ({ outcome: 'DENY', reasonCode: 'T', reason: 'no' }),
    };
    const failing: PlanningStrategy = {
      name: 'failing',
      plan: () => ({ success: false, strategy: 'failing', reason: 'nope' }),
    };
    const scenarios: Array<{
      name: string;
      make: (hub?: RunTelemetryHub) => HarnessOptions;
      u: string;
    }> = [
      { name: 'plain read', make: (hub) => ({ ...(hub ? { hub } : {}) }), u: 'list projects' },
      {
        name: 'policy denied',
        make: (hub) => ({
          ...(hub ? { hub } : {}),
          policy: new DefaultPolicyPort(new PolicyEngine([denyRule])),
        }),
        u: 'list projects',
      },
      {
        name: 'planner failure',
        make: (hub) => ({ ...(hub ? { hub } : {}), planner: failing }),
        u: 'list projects',
      },
      {
        name: 'approval opened',
        make: (hub) => ({ ...(hub ? { hub } : {}), approvals: new InMemoryApprovalEngine() }),
        u: 'create a workspace called Engineering',
      },
      {
        name: 'narrated by model',
        make: (hub) => ({
          ...(hub ? { hub } : {}),
          provider: fakeProvider(() => okResponse()).provider,
        }),
        u: 'list projects',
      },
      {
        name: 'model failure falls back',
        make: (hub) => ({
          ...(hub ? { hub } : {}),
          provider: fakeProvider(() => {
            throw new ProviderError('boom', { timeout: true });
          }).provider,
        }),
        u: 'list projects',
      },
      { name: 'clarification', make: (hub) => ({ ...(hub ? { hub } : {}) }), u: 'zzzz qqqq' },
    ];
    for (const scenario of scenarios) {
      const plain = await harness(scenario.make()).orchestrator.run({
        ...baseRequest,
        utterance: scenario.u,
      });
      const { hub, runs } = hubWithSink();
      const observed = await harness(scenario.make(hub)).orchestrator.run({
        ...baseRequest,
        utterance: scenario.u,
      });
      expect(shape(observed), scenario.name).toEqual(shape(plain));
      expect(runs, scenario.name).toHaveLength(1);
      expect(runs[0]!.status, scenario.name).toBe(observed.status);
    }
  });
});
