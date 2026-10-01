/**
 * @nexora/ai-runtime — approval governance at the orchestrator (expiry and
 * policy-driven approval requirements).
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';
import {
  DEFAULT_POLICY_RULES,
  POLICY_IDS,
  PolicyEngine,
  type PolicyConfigEntry,
} from '@nexora/module-policy';
import { nowIso } from '@nexora/shared/time';

import { EnterpriseAIOrchestrator } from '../src/orchestrator/orchestrator.js';
import { ConversationManager } from '../src/conversation/conversation-manager.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { ToolExecutor } from '../src/execution/tool-executor.js';
import type { PolicyPort } from '../src/execution/policy-port.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';
import {
  APPROVAL_DEFAULT_TTL_MS,
  InMemoryApprovalEngine,
  type ApprovalClock,
} from '../src/approval/engine.js';
import { SequentialPlanner } from '../src/planner/sequential-planner.js';
import type { SecurityDecision } from '../src/execution/security-decision.js';

interface Harness {
  orchestrator: EnterpriseAIOrchestrator;
  approvals: InMemoryApprovalEngine;
  createInvocations: () => number;
  decisions: SecurityDecision[];
}

const baseRequest = { userId: 'usr_alice', tenantId: 'org_acme', workspaceId: 'wsp_1' };

/**
 * Extracts `{ name }` from "create a workspace called X" intents — mirrors
 * the production extractor (apps/api/src/ai/parameters.ts): the name is
 * bounded at clause words so trailing claims ("in org X", "as owner") are
 * never captured as part of the action input.
 */
const CLAUSE_WORDS = /\s+(?:in|for|with|as|to|under|from|at|by|on|of|belonging)\b/i;

function boundName(raw: string): string {
  const clause = raw.match(CLAUSE_WORDS);
  if (clause?.index !== undefined) {
    return raw.slice(0, clause.index).trim();
  }
  return raw.trim();
}

function extractCreateParameters(input: {
  intent: string;
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  const match = input.intent.match(/(?:called|named)\s+([A-Za-z0-9][A-Za-z0-9 _-]{0,78})/i);
  if (match === null) {
    return {};
  }
  const name = boundName(match[1] ?? '');
  if (name.length === 0) {
    return {};
  }
  return { name };
}

/** Builds a harness with a create-workspace tool wired to an approval engine. */
function harness(
  options: {
    policy?: PolicyPort;
    clock?: ApprovalClock;
    runTelemetry?: never;
  } = {},
): Harness {
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  const tools = new ExecutableToolRegistry();
  const conversations = new InMemoryConversationStore();
  const approvals = new InMemoryApprovalEngine(
    options.clock === undefined ? {} : { clock: options.clock },
  );
  let invocations = 0;
  const decisions: SecurityDecision[] = [];

  registry.register(
    registryEntries.capability({
      capability: {
        id: 'workspaces.create_workspace',
        name: 'Create workspace',
        description: 'Creates a new workspace in the current organization',
        skillId: 'workspaces.create',
        sideEffectClass: 'consequential',
      },
      owner: 'workspaces',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: {
        id: 'workspaces.create_workspace',
        description: 'Creates a new workspace in the current organization',
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
      owner: 'workspaces',
      version: '1.0.0',
      ownedByAgents: ['agt_workspaces'],
    }),
  );
  registry.register(
    registryEntries.agent({
      agent: { id: 'agt_workspaces', name: 'workspaces', displayName: 'Workspaces Agent' },
      manifest: {
        identity: { id: 'agt_workspaces', name: 'workspaces', displayName: 'Workspaces Agent' },
        version: '1.0.0',
        skills: [
          {
            id: 'workspaces.create',
            description: 'Creates a new workspace in the current organization',
            toolIds: ['workspaces.create_workspace'],
            autonomyTier: 'supervised',
            requiresApproval: true,
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
      owner: 'workspaces',
      version: '1.0.0',
    }),
  );
  skills.index(
    {
      id: 'workspaces.create',
      description: 'Creates a new workspace in the current organization',
      toolIds: ['workspaces.create_workspace'],
      autonomyTier: 'supervised',
      requiresApproval: true,
    },
    'agt_workspaces',
  );

  const createTool: Tool = {
    manifest: {
      id: 'workspaces.create_workspace',
      name: 'Create workspace',
      description: 'creates',
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
      // The real CreateWorkspaceTool validates the user-controlled input
      // before creating anything; the harness mirrors that contract so a
      // missing name fails after approval instead of fabricating a success.
      const name = String((input as { name?: string }).name ?? '').trim();
      if (name.length === 0) {
        return { ok: false, error: 'A workspace name is required', completedAt: nowIso() };
      }
      invocations += 1;
      return {
        ok: true,
        output: {
          workspace: {
            id: `wsp_${invocations}`,
            name,
            slug: name.toLowerCase().replace(/\s+/g, '-'),
            organizationId: 'org_acme',
          },
        },
        completedAt: nowIso(),
      };
    },
  };
  tools.register(createTool);

  const discovery = new CapabilityDiscovery(registry, skills);
  const executor = new ToolExecutor({
    tools,
    securitySink: (decision) => {
      decisions.push(decision);
    },
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
  const orchestrator = new EnterpriseAIOrchestrator({
    discovery,
    executor,
    conversations: new ConversationManager(conversations),
    approvals,
    securitySink: (decision) => {
      decisions.push(decision);
    },
    planner: new SequentialPlanner({ parameterExtractor: extractCreateParameters }),
  });

  return {
    orchestrator,
    approvals,
    createInvocations: () => invocations,
    decisions,
  };
}

class FakeClock implements ApprovalClock {
  #ms: number;
  constructor(iso: string) {
    this.#ms = Date.parse(iso);
  }
  now(): Date {
    return new Date(this.#ms);
  }
  advance(ms: number): void {
    this.#ms += ms;
  }
}

/** A port over the REAL engine whose organization configuration the test controls. */
class ConfigPort implements PolicyPort {
  configs: Record<string, PolicyConfigEntry> = {};
  readonly #engine = new PolicyEngine(DEFAULT_POLICY_RULES);
  evaluate(request: Parameters<PolicyPort['evaluate']>[0]): ReturnType<PolicyPort['evaluate']> {
    return Promise.resolve(
      this.#engine.evaluate({
        organizationId: request.organizationId,
        ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
        actor: { userId: request.userId },
        capabilityId: request.capabilityId,
        toolId: request.toolId,
        action: request.action,
        sideEffectClass: request.sideEffectClass,
        autonomyTier: request.autonomyTier,
        origin: request.origin,
        input: request.input,
        facts: { configs: this.configs },
      }),
    );
  }
}

interface Run {
  status: string;
  conversationId: string;
  approvals: {
    id?: string;
    status: string;
    expiresAt?: string;
    requiredApproverRoleId?: string;
    separationOfDuties?: boolean;
  }[];
  steps: { status: string; errorCode?: string }[];
}

const UTTERANCE = 'create a workspace called Engineering';
const T0 = '2026-03-01T10:00:00.000Z';

async function start(h: Harness): Promise<{ first: Run; approvalId: string }> {
  const first = (await h.orchestrator.run({
    ...baseRequest,
    utterance: UTTERANCE,
  })) as unknown as Run;
  return { first, approvalId: first.approvals[0]?.id as string };
}

function resume(h: Harness, first: Run, approvalId: string): Promise<Run> {
  return h.orchestrator.run({
    ...baseRequest,
    utterance: UTTERANCE,
    conversationId: first.conversationId,
    approvalId,
  }) as unknown as Promise<Run>;
}

describe('orchestrator approval expiry', () => {
  it('opens approvals with the default 24h TTL and surfaces expiresAt / governance fields', async () => {
    const clock = new FakeClock(T0);
    const h = harness({ clock });
    const { first, approvalId } = await start(h);
    expect(first.approvals[0]).toMatchObject({
      status: 'pending',
      expiresAt: new Date(Date.parse(T0) + APPROVAL_DEFAULT_TTL_MS).toISOString(),
      separationOfDuties: false,
    });
    expect(first.approvals[0]?.requiredApproverRoleId).toBeUndefined();
    expect((await h.approvals.byId(approvalId))?.status).toBe('awaiting_approval');
  });

  it('a granted-but-unexecuted approval that expired fails APPROVAL_EXPIRED: never claims, never executes', async () => {
    const clock = new FakeClock(T0);
    const h = harness({ clock });
    const { first, approvalId } = await start(h);
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
    clock.advance(APPROVAL_DEFAULT_TTL_MS);

    const resumed = await resume(h, first, approvalId);
    expect(resumed.status).toBe('failed');
    expect(resumed.steps[0]).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_EXPIRED' });
    expect(resumed.approvals[0]).toMatchObject({ status: 'expired', id: approvalId });
    expect(h.createInvocations()).toBe(0);
    // Never claimed: no executedAt.
    expect((await h.approvals.byId(approvalId))?.executedAt).toBeUndefined();
    expect(h.decisions.map((d) => d.reasonCode)).toContain('APPROVAL_EXPIRED');
    // Repeated resume stays failed and still never executes.
    expect((await resume(h, first, approvalId)).steps[0]?.errorCode).toBe('APPROVAL_EXPIRED');
    expect(h.createInvocations()).toBe(0);
  });

  it('an undecided approval that expired fails APPROVAL_EXPIRED (not merely pending)', async () => {
    const clock = new FakeClock(T0);
    const h = harness({ clock });
    const { first, approvalId } = await start(h);
    clock.advance(APPROVAL_DEFAULT_TTL_MS + 1);
    const resumed = await resume(h, first, approvalId);
    expect(resumed.steps[0]?.errorCode).toBe('APPROVAL_EXPIRED');
    expect(resumed.approvals[0]?.status).toBe('expired');
    expect(h.createInvocations()).toBe(0);
  });

  it('positive control: the same approval executes one tick before expiry', async () => {
    const clock = new FakeClock(T0);
    const h = harness({ clock });
    const { first, approvalId } = await start(h);
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
    clock.advance(APPROVAL_DEFAULT_TTL_MS - 1);
    const resumed = await resume(h, first, approvalId);
    expect(resumed.status).toBe('completed');
    expect(h.createInvocations()).toBe(1);
  });

  it('a completed approval replays after its expiry time (execution already happened)', async () => {
    const clock = new FakeClock(T0);
    const h = harness({ clock });
    const { first, approvalId } = await start(h);
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
    await resume(h, first, approvalId);
    clock.advance(APPROVAL_DEFAULT_TTL_MS * 2);
    const replay = await resume(h, first, approvalId);
    expect(replay.steps[0]?.status).toBe('succeeded');
    expect(h.createInvocations()).toBe(1);
  });
});

describe('orchestrator approval requirement propagation', () => {
  const config: PolicyConfigEntry = {
    version: 7,
    config: {
      rules: [
        {
          capabilityPrefix: 'workspaces.',
          separationOfDuties: true,
          requiredApproverRoleId: 'executive.ceo',
          ttlMinutes: 30,
        },
      ],
    },
  };

  it('passes ttl, required approver role and separation of duties from the policy decision to approvals.open', async () => {
    const clock = new FakeClock(T0);
    const port = new ConfigPort();
    port.configs = { [POLICY_IDS.APPROVAL_AUTHORITY]: config };
    const h = harness({ clock, policy: port });
    const { first, approvalId } = await start(h);
    const record = await h.approvals.byId(approvalId);
    expect(record).toMatchObject({
      separationOfDuties: true,
      requiredApproverRoleId: 'executive.ceo',
      expiresAt: new Date(Date.parse(T0) + 30 * 60_000).toISOString(),
    });
    expect(first.approvals[0]).toMatchObject({
      separationOfDuties: true,
      requiredApproverRoleId: 'executive.ceo',
      expiresAt: '2026-03-01T10:30:00.000Z',
    });
    // The governing config is recorded in the approval's policy record.
    expect(record?.policy?.rules.join(',')).toContain('POLICY_APPROVAL_AUTHORITY@1+config.7');
    // ...and expires at the policy TTL, not the default.
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_bob' });
    clock.advance(30 * 60_000);
    expect((await resume(h, first, approvalId)).steps[0]?.errorCode).toBe('APPROVAL_EXPIRED');
    expect(h.createInvocations()).toBe(0);
  });

  it('without a matching configuration the legacy behaviour is unchanged', async () => {
    const port = new ConfigPort();
    const h = harness({ clock: new FakeClock(T0), policy: port });
    const { approvalId } = await start(h);
    const record = await h.approvals.byId(approvalId);
    expect(record?.separationOfDuties).toBe(false);
    expect(record?.requiredApproverRoleId).toBeUndefined();
  });

  it('a configuration change after the approval invalidates it (POLICY_CHANGED_AFTER_APPROVAL)', async () => {
    const port = new ConfigPort();
    port.configs = { [POLICY_IDS.APPROVAL_AUTHORITY]: config };
    const h = harness({ clock: new FakeClock(T0), policy: port });
    const { first, approvalId } = await start(h);
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_bob' });
    port.configs = { [POLICY_IDS.APPROVAL_AUTHORITY]: { ...config, version: 8 } };
    const resumed = await resume(h, first, approvalId);
    expect(resumed.steps[0]?.errorCode).toBe('POLICY_CHANGED_AFTER_APPROVAL');
    expect(h.createInvocations()).toBe(0);
  });

  it('an invalid enabled configuration fails closed: no approval is opened', async () => {
    const port = new ConfigPort();
    port.configs = { [POLICY_IDS.APPROVAL_AUTHORITY]: { version: 1, config: { rules: 'x' } } };
    const h = harness({ clock: new FakeClock(T0), policy: port });
    const run = (await h.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
    })) as unknown as Run;
    expect(run.steps[0]).toMatchObject({ status: 'failed', errorCode: 'POLICY_DENIED' });
    expect(run.approvals).toHaveLength(0);
    expect(h.createInvocations()).toBe(0);
  });
});
