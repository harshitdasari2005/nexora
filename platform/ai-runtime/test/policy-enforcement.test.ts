/**
 * @nexora/ai-runtime — central policy enforcement tests (Prompt 5, runtime side).
 *
 * The ToolExecutor asks a PolicyPort for a decision AFTER RBAC, argument
 * guard and agent authority, and BEFORE the approval gate / mutation. DENY is
 * final (INVARIANT 7), a throwing port fails closed, an approval never
 * executes under a policy that changed after the human decided, and policy
 * can never convert an earlier deny into an allow. The orchestrator checks
 * policy before opening an approval and records the decision on it.
 *
 * Every decision here comes from the REAL PolicyEngine (with scripted rules
 * where a specific outcome is needed) behind the real DefaultPolicyPort.
 */

import { describe, expect, it } from 'vitest';
import type { Tool, ToolExecutionContext } from '@nexora/agent-sdk/tools';
import type { AgentPrincipalContext } from '@nexora/contracts/agent';
import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';
import {
  PolicyEngine,
  POLICY_IDS,
  sideEffectApprovalRule,
  sideEffectRequiresApproval,
  type PolicyOutcome,
  type PolicyRule,
  type RuleVerdict,
} from '@nexora/module-policy';
import { nowIso } from '@nexora/shared/time';

import { EnterpriseAIOrchestrator } from '../src/orchestrator/orchestrator.js';
import { ConversationManager } from '../src/conversation/conversation-manager.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { ToolExecutor, type ToolInvocation } from '../src/execution/tool-executor.js';
import {
  DefaultPolicyPort,
  type PolicyInvocationRequest,
  type PolicyPort,
} from '../src/execution/policy-port.js';
import type { AgentAuthorityCheck, AgentAuthorityPort } from '../src/execution/agent-authority.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';
import { InMemoryApprovalEngine } from '../src/approval/engine.js';
import { SequentialPlanner, requiresApprovalFor } from '../src/planner/sequential-planner.js';
import type { SecurityDecision } from '../src/execution/security-decision.js';

const TOOL_ID = 'workspaces.create_workspace';
const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
};
const AGENT_A: AgentPrincipalContext = {
  agentId: 'agt_alpha',
  definitionId: 'executive',
  name: 'Alpha Agent',
};

// --- A scripted rule + a controllable port over the REAL engine -------------

/** A rule whose verdict (and version) the test changes between calls. */
class ScriptedRule implements PolicyRule {
  readonly id = 'POLICY_TEST_SCRIPTED';
  version = '1';
  outcome: PolicyOutcome;
  calls = 0;

  constructor(outcome: PolicyOutcome) {
    this.outcome = outcome;
  }

  evaluate(): RuleVerdict {
    this.calls += 1;
    return {
      outcome: this.outcome,
      reasonCode: `SCRIPTED_${this.outcome}`,
      reason: `scripted ${this.outcome}`,
    };
  }
}

/**
 * The REAL {@link DefaultPolicyPort} over a real engine, wrapped only to
 * record requests and to optionally throw (an unreachable policy store).
 */
class ControlledPort implements PolicyPort {
  readonly requests: PolicyInvocationRequest[] = [];
  throwing = false;
  readonly rule: ScriptedRule;
  readonly #inner: DefaultPolicyPort;

  constructor(outcome: PolicyOutcome, extraRules: readonly PolicyRule[] = []) {
    this.rule = new ScriptedRule(outcome);
    this.#inner = new DefaultPolicyPort(new PolicyEngine([this.rule, ...extraRules]));
  }

  evaluate(request: PolicyInvocationRequest): ReturnType<PolicyPort['evaluate']> {
    this.requests.push(request);
    if (this.throwing) {
      return Promise.reject(new Error('policy store down'));
    }
    return this.#inner.evaluate(request);
  }
}

// --- ToolExecutor harness ----------------------------------------------------

function makeTool(
  sideEffectClass: SideEffectClass = 'consequential',
  id: string = TOOL_ID,
): { tool: Tool; contexts: ToolExecutionContext[] } {
  const contexts: ToolExecutionContext[] = [];
  const tool: Tool = {
    manifest: {
      id,
      name: 'Create workspace',
      description: 'creates',
      sideEffectClass,
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

interface ExecutorHarness {
  executor: ToolExecutor;
  contexts: ToolExecutionContext[];
  decisions: SecurityDecision[];
}

function executorHarness(options: {
  policy?: PolicyPort;
  agentAuthority?: AgentAuthorityPort;
  sideEffectClass?: SideEffectClass;
}): ExecutorHarness {
  const tools = new ExecutableToolRegistry();
  const { tool, contexts } = makeTool(options.sideEffectClass);
  tools.register(tool);
  const decisions: SecurityDecision[] = [];
  const executor = new ToolExecutor({
    tools,
    securitySink: (decision) => {
      decisions.push(decision);
    },
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.agentAuthority === undefined ? {} : { agentAuthority: options.agentAuthority }),
  });
  return { executor, contexts, decisions };
}

const invocation: ToolInvocation = {
  toolId: TOOL_ID,
  capabilityId: TOOL_ID,
  input: { name: 'Engineering' },
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_1',
  runId: 'run_1',
  origin: 'orchestrator',
};

describe('ToolExecutor — policy DENY', () => {
  it('DENY => POLICY_DENIED, tool never runs, audited with policyId/version/rules', async () => {
    const port = new ControlledPort('DENY', [sideEffectApprovalRule]);
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    const result = await executor.execute(invocation, false);
    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.error?.code).toBe('POLICY_DENIED');
    expect(result.policy?.outcome).toBe('DENY');
    expect(contexts).toHaveLength(0);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      reasonCode: 'POLICY_DENIED',
      policyId: 'POLICY_TEST_SCRIPTED',
      policyVersion: '1',
      policyDecision: 'deny',
      outcome: 'blocked',
      action: 'tool.execute',
      toolId: TOOL_ID,
      capabilityId: TOOL_ID,
      actorId: 'usr_alice',
      organizationId: 'org_acme',
    });
    expect(decisions[0]?.policyRules).toEqual([
      'POLICY_TEST_SCRIPTED@1=DENY',
      'POLICY_SIDE_EFFECT_APPROVAL@1=REQUIRE_APPROVAL',
    ]);

    // Positive control: same setup, only the scripted outcome changed.
    port.rule.outcome = 'ALLOW';
    port.rule.version = '2';
    const rerun = await executor.execute(invocation, true);
    expect(rerun.ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('DENY is final even with approvalGranted=true (INVARIANT 7)', async () => {
    const port = new ControlledPort('DENY');
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    const result = await executor.execute({ ...invocation, approvalId: 'apr_1' }, true);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('POLICY_DENIED');
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([
      expect.objectContaining({ reasonCode: 'POLICY_DENIED', policyId: 'POLICY_TEST_SCRIPTED' }),
    ]);

    // Positive control: with the deny lifted the same granted call runs.
    port.rule.outcome = 'REQUIRE_APPROVAL';
    const allowed = await executor.execute({ ...invocation, approvalId: 'apr_1' }, true);
    expect(allowed.ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('a real engine failure (throwing rule) is a DENY that the executor enforces', async () => {
    const throwing: PolicyRule = {
      id: 'POLICY_TEST_THROWS',
      version: '1',
      evaluate: () => {
        throw new Error('boom');
      },
    };
    const port = new ControlledPort('ALLOW', [throwing]);
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    const result = await executor.execute(invocation, true);
    expect(result.error?.code).toBe('POLICY_DENIED');
    expect(result.policy?.reasonCode).toBe('POLICY_EVALUATION_FAILED');
    expect(contexts).toHaveLength(0);
    expect(decisions[0]).toMatchObject({ policyId: 'POLICY_TEST_THROWS' });
    expect(decisions[0]?.policyRules).toContain('POLICY_TEST_THROWS@1=DENY');
    // The error message never leaks into the audit record.
    expect(JSON.stringify(decisions)).not.toContain('boom');
  });
});

describe('ToolExecutor — REQUIRE_APPROVAL / ALLOW', () => {
  it('REQUIRE_APPROVAL without approvalGranted => APPROVAL_REQUIRED carrying the policy; with it => runs', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL');
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    const blocked = await executor.execute(invocation, false);
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.error?.code).toBe('APPROVAL_REQUIRED');
    expect(blocked.policy).toMatchObject({
      outcome: 'REQUIRE_APPROVAL',
      policyId: 'POLICY_TEST_SCRIPTED',
      version: '1',
      approvalRequirement: { type: 'human' },
    });
    expect(blocked.policy?.fingerprint).toBe(
      'REQUIRE_APPROVAL|POLICY_TEST_SCRIPTED@1=REQUIRE_APPROVAL',
    );
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([]);

    const granted = await executor.execute(invocation, true);
    expect(granted.ok).toBe(true);
    expect(granted.policy?.outcome).toBe('REQUIRE_APPROVAL');
    expect(contexts).toHaveLength(1);
  });

  it('ALLOW runs and result.policy is set', async () => {
    const port = new ControlledPort('ALLOW');
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    const result = await executor.execute(invocation, false);
    expect(result.ok).toBe(true);
    expect(result.policy).toMatchObject({ outcome: 'ALLOW', policyId: 'POLICY_TEST_SCRIPTED' });
    expect(contexts).toHaveLength(1);
    expect(decisions).toEqual([]);
    // The port got only trusted values.
    expect(port.requests).toEqual([
      expect.objectContaining({
        organizationId: 'org_acme',
        workspaceId: 'wsp_1',
        userId: 'usr_alice',
        capabilityId: TOOL_ID,
        toolId: TOOL_ID,
        action: 'tool.execute',
        sideEffectClass: 'consequential',
        autonomyTier: 'supervised',
        origin: 'orchestrator',
        input: { name: 'Engineering' },
      }),
    ]);
  });
});

describe('ToolExecutor — policy unavailable (fail closed)', () => {
  it('a port that throws => POLICY_UNAVAILABLE, tool never runs, audited without the raw error', async () => {
    const port = new ControlledPort('ALLOW');
    port.throwing = true;
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    const result = await executor.execute(invocation, true);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('POLICY_UNAVAILABLE');
    expect(result.policy).toBeUndefined();
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'POLICY_UNAVAILABLE',
        policyDecision: 'deny',
        outcome: 'blocked',
        toolId: TOOL_ID,
      }),
    ]);
    expect(JSON.stringify(decisions)).not.toContain('policy store down');

    // Positive control: the same call runs once the port recovers.
    port.throwing = false;
    expect((await executor.execute(invocation, true)).ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('evaluatePolicy reports ok:false (never a decision) when the port throws', async () => {
    const port = new ControlledPort('ALLOW');
    port.throwing = true;
    const { executor } = executorHarness({ policy: port });
    expect(await executor.evaluatePolicy(invocation)).toMatchObject({
      ok: false,
      reasonCode: 'POLICY_UNAVAILABLE',
    });
    port.throwing = false;
    expect(await executor.evaluatePolicy(invocation)).toMatchObject({
      ok: true,
      decision: { outcome: 'ALLOW' },
    });
  });
});

describe('ToolExecutor — policy changed after approval', () => {
  it('approvedPolicy mismatch with approvalGranted => POLICY_CHANGED_AFTER_APPROVAL; matching fingerprint runs', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL');
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    // The approval is opened under the current decision.
    const blocked = await executor.execute(invocation, false);
    const approvedPolicy = blocked.policy?.fingerprint as string;
    expect(approvedPolicy).toMatch(/^REQUIRE_APPROVAL\|/);

    // The policy changes after the human decided (a rule version bump).
    port.rule.version = '2';
    const changed = await executor.execute({ ...invocation, approvedPolicy }, true);
    expect(changed.ok).toBe(false);
    expect(changed.error?.code).toBe('POLICY_CHANGED_AFTER_APPROVAL');
    expect(changed.policy?.version).toBe('2');
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'POLICY_CHANGED_AFTER_APPROVAL',
        policyId: 'POLICY_TEST_SCRIPTED',
        policyVersion: '2',
        policyRules: ['POLICY_TEST_SCRIPTED@2=REQUIRE_APPROVAL'],
      }),
    ]);

    // Positive control: with the version restored the fingerprint matches and it runs.
    port.rule.version = '1';
    const matching = await executor.execute({ ...invocation, approvedPolicy }, true);
    expect(matching.ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('a stale approval under a policy that is now DENY reports POLICY_DENIED (deny wins over the fingerprint check)', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL');
    const { executor, contexts, decisions } = executorHarness({ policy: port });
    const approvedPolicy = (await executor.execute(invocation, false)).policy
      ?.fingerprint as string;

    port.rule.outcome = 'DENY';
    const denied = await executor.execute({ ...invocation, approvedPolicy }, true);
    expect(denied.error?.code).toBe('POLICY_DENIED');
    expect(contexts).toHaveLength(0);
    expect(decisions.map((d) => d.reasonCode)).toEqual(['POLICY_DENIED']);

    // Positive control: policy back to the approved decision => it runs.
    port.rule.outcome = 'REQUIRE_APPROVAL';
    expect((await executor.execute({ ...invocation, approvedPolicy }, true)).ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('the fingerprint is only compared when approval was granted (no approvedPolicy => no check)', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL');
    const { executor, contexts } = executorHarness({ policy: port });
    const stale = 'REQUIRE_APPROVAL|POLICY_TEST_SCRIPTED@0=REQUIRE_APPROVAL';

    // Without a grant the stale fingerprint is irrelevant: the gate blocks first.
    const notGranted = await executor.execute({ ...invocation, approvedPolicy: stale }, false);
    expect(notGranted.error?.code).toBe('APPROVAL_REQUIRED');
    // With a grant the stale fingerprint is refused.
    const granted = await executor.execute({ ...invocation, approvedPolicy: stale }, true);
    expect(granted.error?.code).toBe('POLICY_CHANGED_AFTER_APPROVAL');
    expect(contexts).toHaveLength(0);
  });
});

describe('ToolExecutor — policy cannot convert an earlier deny (INVARIANTS 1, 2, 8)', () => {
  it('an RBAC ceiling deny short-circuits: the policy port is never called', async () => {
    const port = new ControlledPort('ALLOW');
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    const denied = await executor.execute(
      { ...invocation, allowedCapabilityIds: ['workspaces.something_else'] },
      true,
    );
    expect(denied.error?.code).toBe('FORBIDDEN');
    expect(port.requests).toHaveLength(0);
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([
      expect.objectContaining({ reasonCode: 'CAPABILITY_NOT_PERMITTED' }),
    ]);

    // Positive control: the same call inside the ceiling reaches the port and runs.
    const allowed = await executor.execute(
      { ...invocation, allowedCapabilityIds: [TOOL_ID] },
      true,
    );
    expect(allowed.ok).toBe(true);
    expect(port.requests).toHaveLength(1);
  });

  it('an agent-authority deny short-circuits: the policy port is never called', async () => {
    const port = new ControlledPort('ALLOW');
    let check: AgentAuthorityCheck = {
      ok: false,
      reasonCode: 'DELEGATION_REVOKED',
      reason: 'revoked',
    };
    const authority: AgentAuthorityPort = { authorize: () => Promise.resolve(check) };
    const { executor, contexts, decisions } = executorHarness({
      policy: port,
      agentAuthority: authority,
    });
    const agentInvocation: ToolInvocation = { ...invocation, origin: 'agent', agent: AGENT_A };

    const denied = await executor.execute(agentInvocation, true);
    expect(denied.error?.code).toBe('AGENT_NOT_AUTHORIZED');
    expect(port.requests).toHaveLength(0);
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([expect.objectContaining({ reasonCode: 'DELEGATION_REVOKED' })]);

    // Positive control: delegation restored => the port is consulted and the tool runs.
    check = { ok: true, delegationId: 'dlg_1' };
    const allowed = await executor.execute(agentInvocation, true);
    expect(allowed.ok).toBe(true);
    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]?.agent).toEqual({ agentId: 'agt_alpha' });
    expect(allowed.delegationId).toBe('dlg_1');
  });

  it('a reserved-argument deny short-circuits before the port', async () => {
    const port = new ControlledPort('ALLOW');
    const { executor, decisions } = executorHarness({ policy: port });
    const result = await executor.execute(
      { ...invocation, input: { name: 'A', workspaceId: 'wsp_x' } },
      true,
    );
    expect(result.error?.code).toBe('RESERVED_ARGUMENT');
    expect(port.requests).toHaveLength(0);
    expect(decisions).toHaveLength(1);
  });

  it('a policy ALLOW does not rescue an agent deny even when both are present', async () => {
    // Policy would DENY too; the agent deny is reported (first layer), not the policy one.
    const port = new ControlledPort('DENY');
    const authority: AgentAuthorityPort = {
      authorize: () =>
        Promise.resolve({ ok: false, reasonCode: 'AGENT_SUSPENDED', reason: 'suspended' }),
    };
    const { executor, decisions } = executorHarness({ policy: port, agentAuthority: authority });
    const result = await executor.execute({ ...invocation, origin: 'agent', agent: AGENT_A }, true);
    expect(result.error?.code).toBe('AGENT_NOT_AUTHORIZED');
    expect(decisions.map((d) => d.reasonCode)).toEqual(['AGENT_SUSPENDED']);
    expect(port.requests).toHaveLength(0);
  });
});

describe('ToolExecutor — default policy port (no policy option)', () => {
  it('requires approval for a consequential tool; runs it once approved', async () => {
    const { executor, contexts } = executorHarness({});
    const blocked = await executor.execute(invocation, false);
    expect(blocked.error?.code).toBe('APPROVAL_REQUIRED');
    expect(blocked.blocked).toBe(true);
    expect(blocked.policy).toMatchObject({
      outcome: 'REQUIRE_APPROVAL',
      policyId: POLICY_IDS.SIDE_EFFECT_APPROVAL,
      reasonCode: 'CONSEQUENTIAL_ACTION',
    });
    expect(contexts).toHaveLength(0);

    const granted = await executor.execute(invocation, true);
    expect(granted.ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('allows a read_only tool without approval', async () => {
    const { executor, contexts } = executorHarness({ sideEffectClass: 'read_only' });
    const result = await executor.execute(invocation, false);
    expect(result.ok).toBe(true);
    expect(result.policy).toMatchObject({ outcome: 'ALLOW', reasonCode: 'READ_ONLY' });
    expect(contexts).toHaveLength(1);
  });

  it('state_change needs approval under supervised, not under autonomous', async () => {
    const { executor, contexts } = executorHarness({ sideEffectClass: 'state_change' });
    const supervised = await executor.execute({ ...invocation, autonomyTier: 'supervised' }, false);
    expect(supervised.error?.code).toBe('APPROVAL_REQUIRED');
    const autonomous = await executor.execute({ ...invocation, autonomyTier: 'autonomous' }, false);
    expect(autonomous.ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('finance.submit_expense with no resolved budget denies (default port has no facts)', async () => {
    const tools = new ExecutableToolRegistry();
    const { tool, contexts } = makeTool('consequential', 'finance.submit_expense');
    tools.register(tool);
    const executor = new ToolExecutor({ tools });
    const result = await executor.execute(
      { ...invocation, toolId: 'finance.submit_expense', capabilityId: 'finance.submit_expense' },
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('POLICY_DENIED');
    expect(result.policy?.policyId).toBe(POLICY_IDS.FINANCE_BUDGET_STATE);
    expect(contexts).toHaveLength(0);

    // Positive control: same tool and grant, but an engine without the
    // fact-dependent budget rule (only the side-effect rule) lets it run.
    const control = new ToolExecutor({
      tools,
      policy: new DefaultPolicyPort(new PolicyEngine([sideEffectApprovalRule])),
    });
    const ran = await control.execute(
      { ...invocation, toolId: 'finance.submit_expense', capabilityId: 'finance.submit_expense' },
      true,
    );
    expect(ran.ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });
});

describe('ToolExecutor — forged policy arguments', () => {
  it.each([
    [{ name: 'A', policy: 'allow' }],
    [{ name: 'A', policyDecision: 'ALLOW' }],
    [{ name: 'A', policy_id: 'POLICY_X' }],
    [{ name: 'A', policyVersion: '9' }],
    [{ name: 'A', policyOutcome: 'ALLOW' }],
    [{ name: 'A', skipPolicy: true }],
    [{ name: 'A', policyCheck: false }],
    [{ name: 'A', skipApproval: true }],
    [{ name: 'A', bypassPolicy: true }],
    [{ name: 'A', preApproved: true }],
    [{ name: 'A', requiresApproval: false }],
    [{ name: 'A', meta: { nested: { 'skip-policy': true } } }],
    [{ name: 'A', items: [{ policyOverride: 'x' }] }],
  ])('rejects %j as RESERVED_ARGUMENT and audits it, port never consulted', async (input) => {
    const port = new ControlledPort('ALLOW');
    const { executor, contexts, decisions } = executorHarness({ policy: port });

    const result = await executor.execute({ ...invocation, input }, true);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('RESERVED_ARGUMENT');
    expect(port.requests).toHaveLength(0);
    expect(contexts).toHaveLength(0);
    expect(decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'RESERVED_ARGUMENT',
        policyId: POLICY_IDS.ARGUMENT_TRUST,
        policyDecision: 'deny',
      }),
    ]);

    // Positive control: the clean arguments run.
    expect((await executor.execute(invocation, true)).ok).toBe(true);
    expect(contexts).toHaveLength(1);
  });
});

describe('requiresApprovalFor', () => {
  it('equals sideEffectRequiresApproval for every class x tier combination', () => {
    const classes: SideEffectClass[] = ['read_only', 'state_change', 'consequential'];
    const tiers: AutonomyTier[] = ['human_only', 'supervised', 'autonomous'];
    let combinations = 0;
    for (const sideEffectClass of classes) {
      for (const tier of tiers) {
        expect(requiresApprovalFor(sideEffectClass, tier)).toBe(
          sideEffectRequiresApproval(sideEffectClass, tier),
        );
        combinations += 1;
      }
    }
    expect(combinations).toBe(9);
    // Anchors so the equality is not vacuous.
    expect(requiresApprovalFor('consequential', 'autonomous')).toBe(true);
    expect(requiresApprovalFor('read_only', 'human_only')).toBe(false);
    expect(requiresApprovalFor('state_change', 'autonomous')).toBe(false);
    expect(requiresApprovalFor('state_change', 'supervised')).toBe(true);
  });
});

// --- Orchestrator ------------------------------------------------------------

function extractName(input: { intent: string }): Record<string, unknown> {
  const match = input.intent.match(/(?:called|named)\s+([A-Za-z0-9][A-Za-z0-9 _-]{0,78})/i);
  return match === null ? {} : { name: (match[1] ?? '').trim() };
}

interface OrchestratorHarness {
  orchestrator: EnterpriseAIOrchestrator;
  approvals: InMemoryApprovalEngine;
  decisions: SecurityDecision[];
  contexts: ToolExecutionContext[];
}

function orchestratorHarness(
  port?: PolicyPort,
  sideEffectClass: SideEffectClass = 'consequential',
): OrchestratorHarness {
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
        sideEffectClass,
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
        sideEffectClass,
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
    requiresApproval: sideEffectClass !== 'read_only',
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

  const { tool, contexts } = makeTool(sideEffectClass);
  tools.register(tool);

  const securitySink = (decision: SecurityDecision): void => {
    decisions.push(decision);
  };
  const executor = new ToolExecutor({
    tools,
    securitySink,
    ...(port === undefined ? {} : { policy: port }),
  });
  const orchestrator = new EnterpriseAIOrchestrator({
    discovery: new CapabilityDiscovery(registry, skills),
    executor,
    conversations: new ConversationManager(new InMemoryConversationStore()),
    approvals,
    securitySink,
    planner: new SequentialPlanner({ parameterExtractor: extractName }),
  });
  return { orchestrator, approvals, decisions, contexts };
}

const baseRequest = {
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_1',
  utterance: 'create a workspace called Engineering',
};

interface Run {
  status: string;
  conversationId: string;
  approvals: { id?: string; status: string }[];
  steps: { status: string; error?: string; errorCode?: string }[];
}

async function run(h: OrchestratorHarness, extra: Record<string, unknown> = {}): Promise<Run> {
  return (await h.orchestrator.run({ ...baseRequest, ...extra })) as unknown as Run;
}

describe('orchestrator — policy before approval', () => {
  it('policy DENY before an approval opens: no approval record, step failed POLICY_DENIED, audited', async () => {
    const port = new ControlledPort('DENY');
    const h = orchestratorHarness(port);

    const denied = await run(h);
    expect(denied.status).toBe('failed');
    expect(denied.steps[0]).toMatchObject({ status: 'failed', errorCode: 'POLICY_DENIED' });
    expect(denied.approvals).toEqual([]);
    expect(h.contexts).toHaveLength(0);
    expect(h.decisions).toHaveLength(1);
    expect(h.decisions[0]).toMatchObject({
      reasonCode: 'POLICY_DENIED',
      policyId: 'POLICY_TEST_SCRIPTED',
      policyVersion: '1',
      policyRules: ['POLICY_TEST_SCRIPTED@1=DENY'],
      toolId: TOOL_ID,
      capabilityId: TOOL_ID,
      actorId: 'usr_alice',
      organizationId: 'org_acme',
    });
    // No approval was ever recorded for this tenant (not just none returned).
    expect(h.approvals.listByTenant('org_acme', { limit: 10 })).toEqual([]);
    expect(h.approvals.listByConversation(denied.conversationId)).toEqual([]);

    // Positive control: same run opens an approval once the policy asks for one.
    port.rule.outcome = 'REQUIRE_APPROVAL';
    const opened = await run(h);
    expect(opened.status).toBe('blocked');
    expect(opened.approvals[0]?.status).toBe('pending');
    expect(h.approvals.listByTenant('org_acme', { limit: 10 })).toHaveLength(1);
  });

  it('a port that throws before the approval opens: step failed POLICY_UNAVAILABLE, no approval', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL');
    port.throwing = true;
    const h = orchestratorHarness(port);

    const failed = await run(h);
    expect(failed.status).toBe('failed');
    expect(failed.steps[0]).toMatchObject({ status: 'failed', errorCode: 'POLICY_UNAVAILABLE' });
    expect(failed.approvals).toEqual([]);
    expect(h.approvals.listByTenant('org_acme', { limit: 10 })).toEqual([]);
    expect(h.contexts).toHaveLength(0);
    expect(h.decisions).toEqual([expect.objectContaining({ reasonCode: 'POLICY_UNAVAILABLE' })]);

    port.throwing = false;
    expect((await run(h)).approvals[0]?.status).toBe('pending');
  });

  it('REQUIRE_APPROVAL opens an approval whose record.policy carries id/version/fingerprint/rules', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL', [sideEffectApprovalRule]);
    const h = orchestratorHarness(port);

    const blocked = await run(h);
    expect(blocked.status).toBe('blocked');
    expect(blocked.approvals[0]?.status).toBe('pending');
    const record = await h.approvals.byId(blocked.approvals[0]?.id as string);
    expect(record?.policy).toEqual({
      outcome: 'REQUIRE_APPROVAL',
      policyId: 'POLICY_SIDE_EFFECT_APPROVAL',
      version: '1',
      reasonCode: 'CONSEQUENTIAL_ACTION',
      reason: expect.any(String),
      fingerprint:
        'REQUIRE_APPROVAL|POLICY_SIDE_EFFECT_APPROVAL@1=REQUIRE_APPROVAL,POLICY_TEST_SCRIPTED@1=REQUIRE_APPROVAL',
      rules: [
        'POLICY_SIDE_EFFECT_APPROVAL@1=REQUIRE_APPROVAL',
        'POLICY_TEST_SCRIPTED@1=REQUIRE_APPROVAL',
      ],
    });
    expect(record?.input).toEqual({ name: 'Engineering' });
    expect(h.contexts).toHaveLength(0);
    expect(h.decisions).toEqual([]);
  });

  it('resume with an unchanged policy executes exactly the approved input', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL');
    const h = orchestratorHarness(port);
    const first = await run(h);
    const approvalId = first.approvals[0]?.id as string;
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });

    const resumed = await run(h, { conversationId: first.conversationId, approvalId });
    expect(resumed.status).toBe('completed');
    expect(resumed.steps[0]?.status).toBe('succeeded');
    expect(h.contexts).toHaveLength(1);
    expect(h.contexts[0]).toMatchObject({ approvalId });
    expect((await h.approvals.byId(approvalId))?.status).toBe('completed');
    expect(h.decisions).toEqual([]);
    // Orchestrator pre-check on open, pre-check on resume, executor at run time.
    expect(port.requests).toHaveLength(3);
    expect(port.requests[2]?.input).toEqual({ name: 'Engineering' });
  });

  it('resume after the policy decision changed => POLICY_CHANGED_AFTER_APPROVAL, tool not run, approval not consumed, audited', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL');
    const h = orchestratorHarness(port);
    const first = await run(h);
    const approvalId = first.approvals[0]?.id as string;
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
    const opened = await h.approvals.byId(approvalId);
    expect(opened?.policy?.fingerprint).toBe(
      'REQUIRE_APPROVAL|POLICY_TEST_SCRIPTED@1=REQUIRE_APPROVAL',
    );

    // The deciding rule changed after the human approved.
    port.rule.version = '2';
    const resumed = await run(h, { conversationId: first.conversationId, approvalId });

    expect(resumed.status).toBe('failed');
    expect(resumed.steps[0]).toMatchObject({
      status: 'failed',
      errorCode: 'POLICY_CHANGED_AFTER_APPROVAL',
    });
    expect(h.contexts).toHaveLength(0);
    // Not consumed: still approved (never claimed / executing / failed).
    expect((await h.approvals.byId(approvalId))?.status).toBe('approved');
    expect(h.decisions).toEqual([
      expect.objectContaining({
        reasonCode: 'POLICY_CHANGED_AFTER_APPROVAL',
        action: 'approval.resume',
        policyId: 'POLICY_TEST_SCRIPTED',
        policyVersion: '2',
        policyRules: ['POLICY_TEST_SCRIPTED@2=REQUIRE_APPROVAL'],
      }),
    ]);
    // The recorded policy is history: it keeps the version it was approved under.
    expect((await h.approvals.byId(approvalId))?.policy?.version).toBe('1');

    // Positive control: with the policy back as approved, the same approval executes.
    port.rule.version = '1';
    const restored = await run(h, { conversationId: first.conversationId, approvalId });
    expect(restored.status).toBe('completed');
    expect(h.contexts).toHaveLength(1);
    expect((await h.approvals.byId(approvalId))?.status).toBe('completed');
  });

  it('a policy that turns DENY after approval never executes the approved action', async () => {
    const port = new ControlledPort('REQUIRE_APPROVAL');
    const h = orchestratorHarness(port);
    const first = await run(h);
    const approvalId = first.approvals[0]?.id as string;
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });

    port.rule.outcome = 'DENY';
    const resumed = await run(h, { conversationId: first.conversationId, approvalId });
    expect(resumed.status).toBe('failed');
    expect(resumed.steps[0]?.errorCode).toBe('POLICY_DENIED');
    expect(h.contexts).toHaveLength(0);
    expect((await h.approvals.byId(approvalId))?.status).toBe('approved');
  });
});

describe('orchestrator — the planner gate cannot be skipped by policy', () => {
  it('a policy that ALLOWs a consequential tool still opens an approval (gate holds)', async () => {
    const port = new ControlledPort('ALLOW');
    const h = orchestratorHarness(port);

    const blocked = await run(h);
    expect(blocked.status).toBe('blocked');
    expect(blocked.approvals[0]?.status).toBe('pending');
    expect(blocked.steps[0]?.status).toBe('blocked');
    expect(h.contexts).toHaveLength(0);
    // The policy that allowed it is recorded on the approval.
    const record = await h.approvals.byId(blocked.approvals[0]?.id as string);
    expect(record?.policy).toMatchObject({ outcome: 'ALLOW', policyId: 'POLICY_TEST_SCRIPTED' });

    // Positive control: a read_only tool with the same ALLOW policy has no gate and runs.
    const readOnly = orchestratorHarness(new ControlledPort('ALLOW'), 'read_only');
    const done = await run(readOnly);
    expect(done.status).toBe('completed');
    expect(done.approvals).toEqual([]);
    expect(readOnly.contexts).toHaveLength(1);
  });

  it('a policy REQUIRE_APPROVAL gates even a read_only tool the planner would not gate', async () => {
    const readOnly = orchestratorHarness(new ControlledPort('REQUIRE_APPROVAL'), 'read_only');
    const blocked = await run(readOnly);
    expect(blocked.status).toBe('blocked');
    expect(blocked.approvals[0]?.status).toBe('pending');
    expect(readOnly.contexts).toHaveLength(0);
  });

  it('with the default port a consequential tool needs approval and a read_only tool does not', async () => {
    const consequential = orchestratorHarness();
    const blocked = await run(consequential);
    expect(blocked.status).toBe('blocked');
    const record = await consequential.approvals.byId(blocked.approvals[0]?.id as string);
    expect(record?.policy).toMatchObject({
      outcome: 'REQUIRE_APPROVAL',
      policyId: POLICY_IDS.SIDE_EFFECT_APPROVAL,
    });
    expect(consequential.contexts).toHaveLength(0);

    const readOnly = orchestratorHarness(undefined, 'read_only');
    expect((await run(readOnly)).status).toBe('completed');
    expect(readOnly.contexts).toHaveLength(1);
  });
});
