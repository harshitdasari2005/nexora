/**
 * @nexora/ai-runtime — approval binding + actor continuity tests (Prompt 9,
 * G2b / G1 / G4-replay).
 *
 * A resumed run that names an approval must CONSUME it through exactly one
 * bound step. If the approved action did not run (plan changed, no matching
 * gated step, step no longer gated, foreign approval) the run fails
 * `APPROVAL_NOT_BOUND`, audited, the approval stays un-consumed, and it is
 * NEVER reported as completed. The approver is recorded descriptively on
 * lineage and run telemetry; the actor stays the requester.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';
import { nowIso } from '@nexora/shared/time';
import { RunTelemetryHub, type RuntimeRun } from '@nexora/module-observability';

import { EnterpriseAIOrchestrator } from '../src/orchestrator/orchestrator.js';
import { ConversationManager } from '../src/conversation/conversation-manager.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { ToolExecutor } from '../src/execution/tool-executor.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';
import { InMemoryApprovalEngine } from '../src/approval/engine.js';
import { SequentialPlanner } from '../src/planner/sequential-planner.js';
import type { SecurityDecision } from '../src/execution/security-decision.js';
import type {
  ExecutionEvent,
  LineagePort,
  PlannedActionEvent,
} from '../src/execution/lineage-port.js';

const baseRequest = { userId: 'usr_alice', tenantId: 'org_acme', workspaceId: 'wsp_1' };
const UTTERANCE = 'create a workspace called Engineering';

function extract(input: { intent: string }): Record<string, unknown> {
  const match = input.intent.match(/(?:called|named)\s+([A-Za-z0-9]+)/i);
  return match === null ? {} : { name: match[1] };
}

interface Options {
  /** `read_only` un-gates the step (same tool + capability ids). */
  sideEffect?: 'consequential' | 'read_only';
  approvals?: InMemoryApprovalEngine;
  conversations?: InMemoryConversationStore;
  /** Replaces the parameter extractor (a "plan changed" simulation). */
  extractor?: (input: { intent: string }) => Record<string, unknown>;
  /** Registers no capability at all (nothing discoverable). */
  empty?: boolean;
  hub?: RunTelemetryHub;
  verified?: boolean;
}

function harness(options: Options = {}) {
  const sideEffect = options.sideEffect ?? 'consequential';
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  const tools = new ExecutableToolRegistry();
  const conversations = options.conversations ?? new InMemoryConversationStore();
  const approvals = options.approvals ?? new InMemoryApprovalEngine();
  const security: SecurityDecision[] = [];
  const planned: PlannedActionEvent[] = [];
  const executed: ExecutionEvent[] = [];
  let invocations = 0;

  const skill = {
    id: 'workspaces.create',
    description: 'Creates a new workspace in the current organization',
    toolIds: ['workspaces.create_workspace'],
    autonomyTier: 'supervised' as const,
    requiresApproval: sideEffect === 'consequential',
  };
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  };
  if (options.empty !== true) {
    registry.register(
      registryEntries.capability({
        capability: {
          id: 'workspaces.create_workspace',
          name: 'Create workspace',
          description: 'Creates a new workspace in the current organization',
          skillId: 'workspaces.create',
          sideEffectClass: sideEffect,
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
          sideEffectClass: sideEffect,
          idempotent: false,
          timeoutMs: 1000,
          inputSchema: schema,
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
          skills: [skill],
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
    skills.index(skill, 'agt_workspaces');
  }
  const tool: Tool = {
    manifest: {
      id: 'workspaces.create_workspace',
      name: 'Create workspace',
      description: 'creates',
      sideEffectClass: sideEffect,
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: schema,
    },
    execute: async (input) => {
      invocations += 1;
      return {
        ok: options.verified !== false,
        output: { workspace: { name: (input as { name: string }).name } },
        ...(options.verified === false ? { error: 'nope' } : {}),
        completedAt: nowIso(),
      };
    },
  };
  tools.register(tool);
  const lineage: LineagePort = {
    planned: async (event) => void planned.push(event),
    executed: async (event) => void executed.push(event),
  };
  const sink = (decision: SecurityDecision): void => void security.push(decision);
  const orchestrator = new EnterpriseAIOrchestrator({
    discovery: new CapabilityDiscovery(registry, skills),
    executor: new ToolExecutor({ tools, securitySink: sink, lineage }),
    conversations: new ConversationManager(conversations),
    approvals,
    securitySink: sink,
    lineage,
    ...(options.hub === undefined ? {} : { runTelemetry: options.hub }),
    planner: new SequentialPlanner({ parameterExtractor: options.extractor ?? extract }),
  });
  return {
    orchestrator,
    approvals,
    conversations,
    security,
    planned,
    executed,
    invocations: () => invocations,
  };
}

/** Opens + grants an approval for the standard request; returns its id and conversation. */
async function grantedApproval(h: ReturnType<typeof harness>, decidedBy = 'usr_approver') {
  const first = await h.orchestrator.run({ ...baseRequest, utterance: UTTERANCE });
  const approvalId = first.approvals[0]?.id as string;
  expect(approvalId).toMatch(/^apr_/);
  h.approvals.decide(approvalId, { decision: 'grant', decidedBy });
  return { approvalId, conversationId: first.conversationId };
}

describe('G2b — a resumed approval must be consumed by a bound step', () => {
  it('happy path: consumed by exactly one matching step, completes, single execution', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    const resumed = await h.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
      conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.failureCode).toBeUndefined();
    expect(h.invocations()).toBe(1);
    expect(h.approvals.byId(approvalId)?.status).toBe('completed');
    expect(h.security.filter((d) => d.reasonCode === 'APPROVAL_NOT_BOUND')).toEqual([]);
  });

  it('plan changed (different arguments): APPROVAL_ARGUMENTS_MISMATCH keeps its specific failure, approval un-consumed', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    const resumed = await h.orchestrator.run({
      ...baseRequest,
      utterance: 'create a workspace called Finance',
      conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('failed');
    expect(resumed.steps[0]?.errorCode).toBe('APPROVAL_ARGUMENTS_MISMATCH');
    expect(h.invocations()).toBe(0);
    // Never consumed: still approved, claimable by the exact approved request.
    expect(h.approvals.byId(approvalId)?.status).toBe('approved');
  });

  it('no matching step (the rebuilt plan is different): step-less APPROVAL_NOT_BOUND, audited, approval untouched', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    // Same run scope, but the rebuilt plan no longer contains the approved tool.
    const other = harness({
      approvals: h.approvals,
      conversations: h.conversations,
      empty: true,
    });
    const resumed = await other.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
      conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('failed');
    expect(resumed.failureCode).toBe('APPROVAL_NOT_BOUND');
    expect(resumed.steps).toEqual([]);
    expect(other.invocations()).toBe(0);
    expect(other.security).toContainEqual(
      expect.objectContaining({
        reasonCode: 'APPROVAL_NOT_BOUND',
        action: 'approval.resume',
        outcome: 'blocked',
        actorId: 'usr_alice',
        origin: 'approval',
      }),
    );
    expect(h.approvals.byId(approvalId)?.status).toBe('approved');
  });

  it('nothing discoverable on resume: APPROVAL_NOT_BOUND, never "clarification" or "completed"', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    const other = harness({ approvals: h.approvals, conversations: h.conversations, empty: true });
    const resumed = await other.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
      conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('failed');
    expect(resumed.failureCode).toBe('APPROVAL_NOT_BOUND');
    expect(other.security.map((d) => d.reasonCode)).toContain('APPROVAL_NOT_BOUND');
    expect(h.approvals.byId(approvalId)?.status).toBe('approved');
  });

  it('step no longer gated: the step does NOT run around the approval; APPROVAL_NOT_BOUND', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    const ungated = harness({
      approvals: h.approvals,
      conversations: h.conversations,
      sideEffect: 'read_only',
    });
    const resumed = await ungated.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
      conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('failed');
    expect(resumed.failureCode).toBe('APPROVAL_NOT_BOUND');
    expect(ungated.invocations()).toBe(0);
    expect(h.approvals.byId(approvalId)?.status).toBe('approved');
    const audit = ungated.security.find((d) => d.reasonCode === 'APPROVAL_NOT_BOUND');
    expect(audit?.reason).toContain('no longer gated');
    expect(JSON.stringify(audit)).not.toContain('Engineering');
  });

  it('a foreign approval (other user) is never consumed: APPROVAL_NOT_BOUND, no execution', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    const resumed = await h.orchestrator.run({
      ...baseRequest,
      userId: 'usr_mallory',
      utterance: UTTERANCE,
      conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('failed');
    expect(resumed.failureCode).toBe('APPROVAL_NOT_BOUND');
    expect(h.invocations()).toBe(0);
    expect(h.approvals.byId(approvalId)?.status).toBe('approved');
  });

  it('a rejected approval on resume stays blocked (not completed, not NOT_BOUND)', async () => {
    const h = harness();
    const first = await h.orchestrator.run({ ...baseRequest, utterance: UTTERANCE });
    const approvalId = first.approvals[0]?.id as string;
    h.approvals.decide(approvalId, { decision: 'reject', decidedBy: 'usr_approver' });
    const resumed = await h.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
      conversationId: first.conversationId,
      approvalId,
    });
    expect(resumed.status).toBe('blocked');
    expect(resumed.failureCode).toBeUndefined();
    expect(h.invocations()).toBe(0);
  });

  it('a pending approval on resume stays blocked', async () => {
    const h = harness();
    const first = await h.orchestrator.run({ ...baseRequest, utterance: UTTERANCE });
    const resumed = await h.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
      conversationId: first.conversationId,
      approvalId: first.approvals[0]?.id as string,
    });
    expect(resumed.status).toBe('blocked');
    expect(resumed.failureCode).toBeUndefined();
  });

  it('a duplicate delivery replays the stored result without NOT_BOUND and without re-executing', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    const req = { ...baseRequest, utterance: UTTERANCE, conversationId, approvalId };
    await h.orchestrator.run(req);
    const replay = await h.orchestrator.run(req);
    expect(h.invocations()).toBe(1);
    expect(replay.failureCode).toBeUndefined();
    expect(replay.status).toBe('completed');
  });

  it('the failure is classified for telemetry as APPROVAL / APPROVAL_NOT_BOUND', async () => {
    const runs: RuntimeRun[] = [];
    const hub = new RunTelemetryHub({ sink: (run) => void runs.push(run) });
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    const other = harness({
      approvals: h.approvals,
      conversations: h.conversations,
      empty: true,
      hub,
    });
    await other.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
      conversationId,
      approvalId,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.failure).toMatchObject({
      stage: 'APPROVAL',
      code: 'APPROVAL_NOT_BOUND',
      class: 'APPROVAL',
    });
  });
});

describe('G1 — approver attribution is descriptive; the actor stays the requester', () => {
  it('a resumed run records approvedBy on PLANNED and EXECUTION events, never as the actor', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h, 'usr_approver');
    const decidedAt = h.approvals.byId(approvalId)?.decidedAt;
    await h.orchestrator.run({ ...baseRequest, utterance: UTTERANCE, conversationId, approvalId });

    const resumedPlanned = h.planned.at(-1) as PlannedActionEvent;
    const execution = h.executed.at(-1) as ExecutionEvent;
    for (const event of [resumedPlanned, execution]) {
      expect(event.approvedBy).toEqual({ userId: 'usr_approver', decidedAt });
      expect(event.userId).toBe('usr_alice');
      expect(event.approvalId).toBe(approvalId);
    }
  });

  it('the FIRST (opening) run has no approver', async () => {
    const h = harness();
    await h.orchestrator.run({ ...baseRequest, utterance: UTTERANCE });
    expect(h.planned[0]?.approvedBy).toBeUndefined();
    expect(h.executed).toHaveLength(0);
  });

  it('an approver id is never used as authorization: a different approver does not change the executor identity', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h, 'usr_someone_else');
    const contexts: string[] = [];
    const resumed = await h.orchestrator.run({
      ...baseRequest,
      utterance: UTTERANCE,
      conversationId,
      approvalId,
    });
    contexts.push(resumed.status);
    expect((h.executed.at(-1) as ExecutionEvent).userId).toBe('usr_alice');
    expect(contexts).toEqual(['completed']);
  });

  it('run telemetry records decidedBy on a resumed run (and never changes actorId)', async () => {
    const runs: RuntimeRun[] = [];
    const hub = new RunTelemetryHub({ sink: (run) => void runs.push(run) });
    const h = harness({ hub });
    const { approvalId, conversationId } = await grantedApproval(h, 'usr_approver');
    await h.orchestrator.run({ ...baseRequest, utterance: UTTERANCE, conversationId, approvalId });
    const resumed = runs.at(-1) as RuntimeRun;
    expect(resumed.approval).toMatchObject({
      approvalId,
      state: 'resumed',
      decision: 'grant',
      decidedBy: 'usr_approver',
    });
    expect(resumed.actorId).toBe('usr_alice');
    // The opening run recorded no decider.
    expect(runs[0]?.approval?.decidedBy).toBeUndefined();
  });
});

describe('G4 — replay of a completed approval', () => {
  it('replay returns the stored result and the verification recorded at completion', async () => {
    const h = harness();
    const { approvalId, conversationId } = await grantedApproval(h);
    const req = { ...baseRequest, utterance: UTTERANCE, conversationId, approvalId };
    const first = await h.orchestrator.run(req);
    expect(first.steps[0]?.verified).toBe(true);
    const replay = await h.orchestrator.run(req);
    // Same stored output, no second execution, and `verified` is only ever
    // true here because a completed approval is recorded ONLY from a verified
    // execution (an unverified tool result records `failed`, never `completed`).
    expect(replay.steps[0]?.output).toEqual(first.steps[0]?.output);
    expect(replay.steps[0]?.verified).toBe(true);
    expect(h.invocations()).toBe(1);
    expect(h.executed).toHaveLength(1);
  });

  it('an unverified execution records the approval FAILED, so a later replay can never claim verified', async () => {
    const h = harness({ verified: false });
    const { approvalId, conversationId } = await grantedApproval(h);
    const req = { ...baseRequest, utterance: UTTERANCE, conversationId, approvalId };
    const first = await h.orchestrator.run(req);
    expect(first.status).toBe('failed');
    expect(h.approvals.byId(approvalId)?.status).toBe('failed');
    const replay = await h.orchestrator.run(req);
    expect(replay.steps[0]?.verified).toBe(false);
    expect(replay.steps[0]?.status).not.toBe('succeeded');
    expect(h.invocations()).toBe(1);
  });
});
