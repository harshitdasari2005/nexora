/**
 * @nexora/ai-runtime — agent principal tests (Prompt 4, runtime side).
 *
 * An invocation that runs AS an agent is authorized by the
 * {@link AgentAuthorityPort} at EXECUTION time for every call, fails closed
 * when the port is missing or throws, and is never rescued by an approval.
 * Tool arguments can never name an agent principal or delegation. The
 * orchestrator checks the agent's delegation BEFORE opening an approval,
 * binds the approval to the agent, and only the same agent may resume it.
 */

import { describe, expect, it } from 'vitest';
import type { Tool, ToolExecutionContext } from '@nexora/agent-sdk/tools';
import type { AgentPrincipalContext } from '@nexora/contracts/agent';
import { nowIso } from '@nexora/shared/time';

import { EnterpriseAIOrchestrator } from '../src/orchestrator/orchestrator.js';
import { ConversationManager } from '../src/conversation/conversation-manager.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { ToolExecutor, type ToolInvocation } from '../src/execution/tool-executor.js';
import type {
  AgentAuthorityCheck,
  AgentAuthorityPort,
  AgentAuthorityRequest,
} from '../src/execution/agent-authority.js';
import {
  ArgumentGuard,
  findReservedArgumentPaths,
  isAgentPath,
} from '../src/execution/argument-guard.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';
import { InMemoryApprovalEngine } from '../src/approval/engine.js';
import { SequentialPlanner } from '../src/planner/sequential-planner.js';
import type { SecurityDecision } from '../src/execution/security-decision.js';

const AGENT_A: AgentPrincipalContext = {
  agentId: 'agt_alpha',
  definitionId: 'executive',
  name: 'Alpha Agent',
};
const AGENT_B: AgentPrincipalContext = {
  agentId: 'agt_beta',
  definitionId: 'executive',
  name: 'Beta Agent',
};

const TOOL_ID = 'workspaces.create_workspace';
const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
};

/**
 * A controllable agent authority port: answers are scripted per call
 * (1-based call index) and every request is recorded.
 */
class FakeAgentAuthority implements AgentAuthorityPort {
  readonly calls: AgentAuthorityRequest[] = [];
  answer: (request: AgentAuthorityRequest, call: number) => AgentAuthorityCheck;

  constructor(
    answer: (request: AgentAuthorityRequest, call: number) => AgentAuthorityCheck = () => ALLOW,
  ) {
    this.answer = answer;
  }

  authorize(request: AgentAuthorityRequest): Promise<AgentAuthorityCheck> {
    this.calls.push(request);
    return Promise.resolve(this.answer(request, this.calls.length));
  }
}

const ALLOW: AgentAuthorityCheck = { ok: true, delegationId: 'dlg_1' };
const REVOKED: AgentAuthorityCheck = {
  ok: false,
  reasonCode: 'DELEGATION_REVOKED',
  reason: 'the delegation was revoked',
};

/** A consequential tool that records every context it receives. */
function recordingTool(): { tool: Tool; contexts: ToolExecutionContext[] } {
  const contexts: ToolExecutionContext[] = [];
  const tool: Tool = {
    manifest: {
      id: TOOL_ID,
      name: 'Create workspace',
      description: 'creates',
      sideEffectClass: 'consequential',
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: SCHEMA,
    },
    execute: (input, context) => {
      contexts.push(context);
      return Promise.resolve({
        ok: true,
        output: { workspace: { id: `wsp_${contexts.length}`, name: String(input.name) } },
        completedAt: nowIso(),
      });
    },
  };
  return { tool, contexts };
}

function executorHarness(port?: AgentAuthorityPort): {
  executor: ToolExecutor;
  contexts: ToolExecutionContext[];
  decisions: SecurityDecision[];
} {
  const tools = new ExecutableToolRegistry();
  const { tool, contexts } = recordingTool();
  tools.register(tool);
  const decisions: SecurityDecision[] = [];
  const executor = new ToolExecutor({
    tools,
    securitySink: (decision) => {
      decisions.push(decision);
    },
    ...(port === undefined ? {} : { agentAuthority: port }),
  });
  return { executor, contexts, decisions };
}

const agentInvocation: ToolInvocation = {
  toolId: TOOL_ID,
  capabilityId: TOOL_ID,
  input: { name: 'Engineering' },
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_1',
  runId: 'run_1',
  origin: 'agent',
  agent: AGENT_A,
};

/** The same invocation issued by a human (no agent principal). */
const humanInvocation: ToolInvocation = {
  toolId: TOOL_ID,
  capabilityId: TOOL_ID,
  input: { name: 'Engineering' },
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_1',
  runId: 'run_1',
  origin: 'orchestrator',
};

describe('ToolExecutor — agent principal authorization', () => {
  it('fails closed with no agent authority port (AGENT_AUTHORITY_UNAVAILABLE)', async () => {
    const { executor, contexts, decisions } = executorHarness();
    const result = await executor.execute(agentInvocation, true);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AGENT_NOT_AUTHORIZED');
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'AGENT_AUTHORITY_UNAVAILABLE',
        agentId: 'agt_alpha',
        origin: 'agent',
        action: 'tool.execute',
        actorId: 'usr_alice',
        organizationId: 'org_acme',
        toolId: TOOL_ID,
        policyDecision: 'deny',
        outcome: 'blocked',
      }),
    ]);

    // Positive control: the same harness runs the tool for a human invocation.
    const humanResult = await executor.execute(humanInvocation, true);
    expect(humanResult.ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('a port denial blocks the tool even with approvalGranted=true, audited with agentId + origin', async () => {
    const port = new FakeAgentAuthority(() => REVOKED);
    const { executor, contexts, decisions } = executorHarness(port);
    const result = await executor.execute(agentInvocation, true);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AGENT_NOT_AUTHORIZED');
    expect(result.delegationId).toBeUndefined();
    expect(contexts).toHaveLength(0);
    expect(port.calls).toHaveLength(1);
    expect(decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'DELEGATION_REVOKED',
        agentId: 'agt_alpha',
        origin: 'agent',
        action: 'tool.execute',
        capabilityId: TOOL_ID,
      }),
    ]);

    // Positive control: the same invocation succeeds once the port allows.
    port.answer = () => ALLOW;
    const allowed = await executor.execute(agentInvocation, true);
    expect(allowed.ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('an allowing port runs the tool with agent/delegation/approval/origin context', async () => {
    const port = new FakeAgentAuthority();
    const { executor, contexts, decisions } = executorHarness(port);
    const result = await executor.execute({ ...agentInvocation, approvalId: 'apr_42' }, true);

    expect(result.ok).toBe(true);
    expect(result.delegationId).toBe('dlg_1');
    expect(decisions).toEqual([]);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      userId: 'usr_alice',
      tenantId: 'org_acme',
      workspaceId: 'wsp_1',
      executionId: 'run_1',
      agent: AGENT_A,
      delegationId: 'dlg_1',
      approvalId: 'apr_42',
      origin: 'agent',
    });
    // The port was asked with trusted server-side values only.
    expect(port.calls).toEqual([
      {
        agent: AGENT_A,
        userId: 'usr_alice',
        tenantId: 'org_acme',
        workspaceId: 'wsp_1',
        capabilityId: TOOL_ID,
        toolId: TOOL_ID,
        input: { name: 'Engineering' },
      },
    ]);
  });

  it('an allowing port without approval still honours the approval gate (delegation reported)', async () => {
    const port = new FakeAgentAuthority();
    const { executor, contexts } = executorHarness(port);
    const result = await executor.execute(agentInvocation, false);
    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.error?.code).toBe('APPROVAL_REQUIRED');
    expect(result.delegationId).toBe('dlg_1');
    expect(contexts).toHaveLength(0);
  });

  it('a port that throws fails closed (AGENT_AUTHORITY_UNAVAILABLE)', async () => {
    let shouldThrow = true;
    const port: AgentAuthorityPort = {
      authorize: () =>
        shouldThrow ? Promise.reject(new Error('db down')) : Promise.resolve(ALLOW),
    };
    const { executor, contexts, decisions } = executorHarness(port);
    const result = await executor.execute(agentInvocation, true);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AGENT_NOT_AUTHORIZED');
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([
      expect.objectContaining({ reasonCode: 'AGENT_AUTHORITY_UNAVAILABLE', agentId: 'agt_alpha' }),
    ]);
    // The raw error never leaks into the audit record.
    expect(JSON.stringify(decisions)).not.toContain('db down');

    // Positive control.
    shouldThrow = false;
    expect((await executor.execute(agentInvocation, true)).ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('asks the port at execution time for every call (answer flips between calls)', async () => {
    const port = new FakeAgentAuthority((_request, call) => (call % 2 === 1 ? ALLOW : REVOKED));
    const { executor, contexts } = executorHarness(port);

    const first = await executor.execute(agentInvocation, true);
    const second = await executor.execute(agentInvocation, true);
    const third = await executor.execute(agentInvocation, true);

    expect([first.ok, second.ok, third.ok]).toEqual([true, false, true]);
    expect(second.error?.code).toBe('AGENT_NOT_AUTHORIZED');
    expect(port.calls).toHaveLength(3);
    expect(contexts).toHaveLength(2);
  });

  it('invocations without an agent never call the port and carry no agent context', async () => {
    const port = new FakeAgentAuthority(() => REVOKED);
    const { executor, contexts } = executorHarness(port);
    const result = await executor.execute(humanInvocation, true);

    expect(result.ok).toBe(true);
    expect(result.delegationId).toBeUndefined();
    expect(port.calls).toHaveLength(0);
    expect(contexts[0]?.agent).toBeUndefined();
    expect(contexts[0]?.delegationId).toBeUndefined();
    expect(await executor.checkAgentAuthority(humanInvocation)).toEqual({ ok: true });
    expect(port.calls).toHaveLength(0);
  });
});

describe('ArgumentGuard — forged agent context', () => {
  const guard = new ArgumentGuard();

  it.each([
    [{ name: 'A', agentId: 'agt_x' }],
    [{ name: 'A', agent_id: 'agt_x' }],
    [{ name: 'A', delegationId: 'dlg_x' }],
    [{ name: 'A', onBehalfOf: 'usr_x' }],
    [{ name: 'A', principal: 'agt_x' }],
    [{ name: 'A', ownerUserId: 'usr_x' }],
    [{ name: 'A', grantedBy: 'usr_x' }],
    [{ name: 'A', meta: { nested: { agentId: 'agt_x' } } }],
    [{ name: 'A', items: [{ 'delegation-id': 'dlg_x' }] }],
    // Mixed with a plain scope key: the agent key still classifies it.
    [{ name: 'A', workspaceId: 'wsp_x', agentId: 'agt_x' }],
  ])('rejects %j as FORGED_AGENT_CONTEXT', (input) => {
    const result = guard.check('t', SCHEMA, input);
    expect(result).toMatchObject({ ok: false, code: 'FORGED_AGENT_CONTEXT' });
    if (!result.ok) {
      expect(result.reason).not.toContain('agt_x');
      expect(result.reason).not.toContain('dlg_x');
    }
  });

  it('plain scope keys stay RESERVED_ARGUMENT', () => {
    expect(guard.check('t', SCHEMA, { name: 'A', workspaceId: 'wsp_x' })).toMatchObject({
      ok: false,
      code: 'RESERVED_ARGUMENT',
    });
    expect(guard.check('t', SCHEMA, { name: 'A', meta: { tenant_id: 'x' } })).toMatchObject({
      ok: false,
      code: 'RESERVED_ARGUMENT',
    });
    // Positive control.
    expect(guard.check('t', SCHEMA, { name: 'A' })).toEqual({ ok: true });
  });

  it('isAgentPath classifies by the final key of a path', () => {
    expect(isAgentPath('agentId')).toBe(true);
    expect(isAgentPath('agent_id')).toBe(true);
    expect(isAgentPath('meta.nested.delegationId')).toBe(true);
    expect(isAgentPath('items[0].onBehalfOf')).toBe(true);
    expect(isAgentPath('grants[2]')).toBe(false);
    expect(isAgentPath('workspaceId')).toBe(false);
    expect(isAgentPath('agent.workspaceId')).toBe(false);
    expect(findReservedArgumentPaths({ meta: { principal: 'x' } })).toEqual(['meta.principal']);
  });

  it('the executor audits a forged agent argument before consulting the port', async () => {
    const port = new FakeAgentAuthority();
    const { executor, contexts, decisions } = executorHarness(port);
    const result = await executor.execute(
      { ...agentInvocation, input: { name: 'A', delegationId: 'dlg_forged' } },
      true,
    );
    expect(result.error?.code).toBe('FORGED_AGENT_CONTEXT');
    expect(port.calls).toHaveLength(0);
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([
      expect.objectContaining({ reasonCode: 'FORGED_AGENT_CONTEXT', agentId: 'agt_alpha' }),
    ]);
    expect(JSON.stringify(decisions)).not.toContain('dlg_forged');
  });
});

// --- Orchestrator -----------------------------------------------------------

function extractName(input: { intent: string }): Record<string, unknown> {
  const match = input.intent.match(/(?:called|named)\s+([A-Za-z0-9][A-Za-z0-9 _-]{0,78})/i);
  return match === null ? {} : { name: (match[1] ?? '').trim() };
}

interface OrchestratorHarness {
  orchestrator: EnterpriseAIOrchestrator;
  approvals: InMemoryApprovalEngine;
  port: FakeAgentAuthority;
  decisions: SecurityDecision[];
  contexts: ToolExecutionContext[];
}

function orchestratorHarness(port = new FakeAgentAuthority()): OrchestratorHarness {
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  const tools = new ExecutableToolRegistry();
  const approvals = new InMemoryApprovalEngine();
  const decisions: SecurityDecision[] = [];

  registry.register(
    registryEntries.capability({
      capability: {
        id: TOOL_ID,
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
        id: TOOL_ID,
        description: 'Creates a new workspace in the current organization',
        sideEffectClass: 'consequential',
        idempotent: false,
        timeoutMs: 1000,
        inputSchema: SCHEMA,
      },
      owner: 'workspaces',
      version: '1.0.0',
      ownedByAgents: ['agt_workspaces'],
    }),
  );
  const skill = {
    id: 'workspaces.create',
    description: 'Creates a new workspace in the current organization',
    toolIds: [TOOL_ID],
    autonomyTier: 'supervised' as const,
    requiresApproval: true,
  };
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

  const { tool, contexts } = recordingTool();
  tools.register(tool);

  const securitySink = (decision: SecurityDecision): void => {
    decisions.push(decision);
  };
  const executor = new ToolExecutor({ tools, securitySink, agentAuthority: port });
  const orchestrator = new EnterpriseAIOrchestrator({
    discovery: new CapabilityDiscovery(registry, skills),
    executor,
    conversations: new ConversationManager(new InMemoryConversationStore()),
    approvals,
    securitySink,
    planner: new SequentialPlanner({ parameterExtractor: extractName }),
  });
  return { orchestrator, approvals, port, decisions, contexts };
}

const baseRequest = {
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_1',
  utterance: 'create a workspace called Engineering',
};

interface Run {
  status: string;
  failureCode?: string;
  conversationId: string;
  approvals: { id?: string; status: string }[];
  steps: { status: string; delegationId?: string; error?: string }[];
}

/** Opens (as AGENT_A) and grants an approval; returns its id + conversation. */
async function openAndGrant(
  h: OrchestratorHarness,
): Promise<{ approvalId: string; conversationId: string }> {
  const first = (await h.orchestrator.run({ ...baseRequest, agent: AGENT_A })) as unknown as Run;
  expect(first.status).toBe('blocked');
  const approvalId = first.approvals[0]?.id as string;
  expect(approvalId).toMatch(/^apr_/);
  h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
  return { approvalId, conversationId: first.conversationId };
}

describe('orchestrator — agent principal', () => {
  it('checks the delegation BEFORE opening an approval: denied -> failed, no approval, audited', async () => {
    const h = orchestratorHarness(new FakeAgentAuthority(() => REVOKED));
    const run = (await h.orchestrator.run({ ...baseRequest, agent: AGENT_A })) as unknown as Run;

    expect(run.status).toBe('failed');
    expect(run.steps[0]?.status).toBe('failed');
    expect(run.approvals).toEqual([]);
    expect(h.contexts).toHaveLength(0);
    expect(h.port.calls).toHaveLength(1);
    expect(h.decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'DELEGATION_REVOKED',
        agentId: 'agt_alpha',
        origin: 'agent',
        action: 'tool.execute',
        toolId: TOOL_ID,
        capabilityId: TOOL_ID,
        actorId: 'usr_alice',
        organizationId: 'org_acme',
      }),
    ]);

    // Positive control: the same run opens an approval once the port allows.
    h.port.answer = () => ALLOW;
    const allowed = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_A,
    })) as unknown as Run;
    expect(allowed.status).toBe('blocked');
    expect(allowed.approvals[0]?.status).toBe('pending');
  });

  it('allowed -> approval opened with agentId + delegationId on the record', async () => {
    const h = orchestratorHarness();
    const run = (await h.orchestrator.run({ ...baseRequest, agent: AGENT_A })) as unknown as Run;

    expect(run.status).toBe('blocked');
    expect(run.approvals[0]?.status).toBe('pending');
    const record = await h.approvals.byId(run.approvals[0]?.id as string);
    expect(record).toMatchObject({
      agentId: 'agt_alpha',
      delegationId: 'dlg_1',
      userId: 'usr_alice',
      toolId: TOOL_ID,
      capabilityId: TOOL_ID,
      input: { name: 'Engineering' },
    });
    expect(h.contexts).toHaveLength(0);
    expect(h.decisions).toEqual([]);
  });

  it('a human run opens an approval with no agent binding and never calls the port', async () => {
    const h = orchestratorHarness();
    const run = (await h.orchestrator.run({ ...baseRequest })) as unknown as Run;
    const record = await h.approvals.byId(run.approvals[0]?.id as string);
    expect(record?.agentId).toBeUndefined();
    expect(record?.delegationId).toBeUndefined();
    expect(h.port.calls).toHaveLength(0);
  });

  it('resume as the SAME agent executes once, with the delegation attributed', async () => {
    const h = orchestratorHarness();
    const { approvalId, conversationId } = await openAndGrant(h);

    const resumed = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_A,
      conversationId,
      approvalId,
    })) as unknown as Run;

    expect(resumed.status).toBe('completed');
    expect(resumed.steps[0]?.status).toBe('succeeded');
    expect(resumed.steps[0]?.delegationId).toBe('dlg_1');
    expect(h.contexts).toHaveLength(1);
    expect(h.contexts[0]).toMatchObject({
      agent: AGENT_A,
      delegationId: 'dlg_1',
      approvalId,
      origin: 'agent',
    });
    expect((await h.approvals.byId(approvalId))?.status).toBe('completed');
    // Pre-check on open, pre-check on resume, and the execution-time check.
    expect(h.port.calls).toHaveLength(3);
    expect(h.decisions).toEqual([]);
  });

  it('a human run cannot resume an agent approval (AGENT_APPROVAL_MISMATCH)', async () => {
    const h = orchestratorHarness();
    const { approvalId, conversationId } = await openAndGrant(h);

    const resumed = (await h.orchestrator.run({
      ...baseRequest,
      conversationId,
      approvalId,
    })) as unknown as Run;

    expect(resumed.status).not.toBe('completed');
    expect(resumed.steps[0]?.status).not.toBe('succeeded');
    expect(h.contexts).toHaveLength(0);
    expect(h.decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'AGENT_APPROVAL_MISMATCH',
        action: 'approval.resume',
        origin: 'approval',
        actorId: 'usr_alice',
      }),
    ]);
    expect(h.decisions[0]?.agentId).toBeUndefined();
    // The approval is untouched (still claimable by the right agent).
    expect((await h.approvals.byId(approvalId))?.status).toBe('approved');
  });

  it('a DIFFERENT agent cannot resume the approval (AGENT_APPROVAL_MISMATCH)', async () => {
    const h = orchestratorHarness();
    const { approvalId, conversationId } = await openAndGrant(h);

    const resumed = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_B,
      conversationId,
      approvalId,
    })) as unknown as Run;

    expect(resumed.status).not.toBe('completed');
    expect(h.contexts).toHaveLength(0);
    expect(h.decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'AGENT_APPROVAL_MISMATCH',
        action: 'approval.resume',
        origin: 'agent',
        agentId: 'agt_beta',
      }),
    ]);
    expect((await h.approvals.byId(approvalId))?.status).toBe('approved');

    // Positive control: the owning agent can still resume it afterwards.
    const owner = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_A,
      conversationId,
      approvalId,
    })) as unknown as Run;
    expect(owner.status).toBe('completed');
    expect(h.contexts).toHaveLength(1);
  });

  it('an approval whose capabilityId differs from the step never grants it', async () => {
    const h = orchestratorHarness();
    const { conversationId } = await openAndGrant(h);
    // Same agent, same tool, same input — but bound to another capability.
    const openGranted = (capabilityId: string): string => {
      const record = h.approvals.open({
        conversationId,
        userId: 'usr_alice',
        tenantId: 'org_acme',
        workspaceId: 'wsp_1',
        runId: 'run_x',
        stepId: 'step_x',
        toolId: TOOL_ID,
        capabilityId,
        sideEffectClass: 'consequential',
        reason: 'test',
        intent: baseRequest.utterance,
        input: { name: 'Engineering' },
        agentId: AGENT_A.agentId,
        delegationId: 'dlg_1',
      });
      h.approvals.decide(record.id, { decision: 'grant', decidedBy: 'usr_alice' });
      return record.id;
    };
    const foreign = { id: openGranted('workspaces.other_capability') };

    const resumed = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_A,
      conversationId,
      approvalId: foreign.id,
    })) as unknown as Run;

    // G2b: an approval that binds to no step fails APPROVAL_NOT_BOUND (was: silently blocked).
    expect(resumed.status).toBe('failed');
    expect(resumed.failureCode).toBe('APPROVAL_NOT_BOUND');
    expect(h.contexts).toHaveLength(0);
    expect((await h.approvals.byId(foreign.id))?.status).toBe('approved');
    // The mismatch is an audited security decision (not a silent no-op).
    expect(h.decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'AGENT_APPROVAL_MISMATCH',
        action: 'approval.resume',
        agentId: 'agt_alpha',
      }),
    ]);

    // Positive control: an otherwise identical approval bound to the step's
    // own capability resumes and executes.
    const twinId = openGranted(TOOL_ID);
    const twin = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_A,
      conversationId,
      approvalId: twinId,
    })) as unknown as Run;
    expect(twin.status).toBe('completed');
    expect(h.contexts).toHaveLength(1);
  });

  it('revocation after approval (before resume) is denied at the pre-check; tool never runs', async () => {
    const h = orchestratorHarness();
    const { approvalId, conversationId } = await openAndGrant(h);
    h.port.answer = () => REVOKED;

    const resumed = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_A,
      conversationId,
      approvalId,
    })) as unknown as Run;

    expect(resumed.status).toBe('failed');
    expect(h.contexts).toHaveLength(0);
    expect(h.decisions).toEqual([
      expect.objectContaining({ reasonCode: 'DELEGATION_REVOKED', agentId: 'agt_alpha' }),
    ]);
    expect(h.port.calls).toHaveLength(2);

    // Positive control: once the delegation is restored the same resume runs.
    h.port.answer = () => ALLOW;
    const restored = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_A,
      conversationId,
      approvalId,
    })) as unknown as Run;
    expect(restored.status).toBe('completed');
    expect(h.contexts).toHaveLength(1);
  });

  it('revocation between the resume pre-check and execution is denied at the executor', async () => {
    const h = orchestratorHarness();
    const { approvalId, conversationId } = await openAndGrant(h);
    expect(h.port.calls).toHaveLength(1);
    // Call 2 = resume pre-check (allowed), call 3 = execution-time check (revoked).
    h.port.answer = (_request, call) => (call >= 3 ? REVOKED : ALLOW);

    const resumed = (await h.orchestrator.run({
      ...baseRequest,
      agent: AGENT_A,
      conversationId,
      approvalId,
    })) as unknown as Run;

    expect(h.port.calls).toHaveLength(3);
    expect(resumed.status).toBe('failed');
    expect(resumed.steps[0]?.status).toBe('failed');
    expect(h.contexts).toHaveLength(0);
    expect(h.decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'DELEGATION_REVOKED',
        agentId: 'agt_alpha',
        origin: 'agent',
        action: 'tool.execute',
      }),
    ]);
    expect((await h.approvals.byId(approvalId))?.status).toBe('failed');
  });
});
