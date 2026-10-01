/**
 * @nexora/ai-runtime — lineage event tests (Prompt 6, runtime side).
 *
 * The ToolExecutor reports ONE `executed` lineage event per invocation that
 * actually ran (attempts > 0); refusals before execution emit nothing. The
 * orchestrator reports a `planned` event per step. Reporting is best-effort:
 * a throwing sink never changes an outcome. Everything here runs the real
 * ToolExecutor, EnterpriseAIOrchestrator, InMemoryApprovalEngine and
 * PolicyEngine; the only fakes are the sinks that record events.
 */

import { describe, expect, it } from 'vitest';
import type { Tool, ToolExecutionContext } from '@nexora/agent-sdk/tools';
import type { AgentPrincipalContext } from '@nexora/contracts/agent';
import type { SideEffectClass } from '@nexora/contracts/ai';
import { fingerprintOf } from '@nexora/module-lineage';
import {
  PolicyEngine,
  type PolicyOutcome,
  type PolicyRule,
  type RuleVerdict,
} from '@nexora/module-policy';
import { nowIso } from '@nexora/shared/time';

import { EnterpriseAIOrchestrator } from '../src/orchestrator/orchestrator.js';
import { ConversationManager } from '../src/conversation/conversation-manager.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { ToolExecutor, type ToolInvocation } from '../src/execution/tool-executor.js';
import { defaultRetryPolicy } from '../src/execution/retry-policy.js';
import {
  DefaultPolicyPort,
  type PolicyInvocationRequest,
  type PolicyPort,
} from '../src/execution/policy-port.js';
import type { AgentAuthorityCheck, AgentAuthorityPort } from '../src/execution/agent-authority.js';
import type {
  ExecutionEvent,
  LineagePort,
  PlannedActionEvent,
} from '../src/execution/lineage-port.js';
import type { ExecutionVerifier } from '../src/verification/execution-verifier.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';
import { InMemoryApprovalEngine } from '../src/approval/engine.js';
import { SequentialPlanner } from '../src/planner/sequential-planner.js';

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

// --- Recording lineage sinks -------------------------------------------------

type Log = (({ kind: 'planned' } & PlannedActionEvent) | ({ kind: 'executed' } & ExecutionEvent))[];

class RecordingLineage implements LineagePort {
  readonly planned_: PlannedActionEvent[] = [];
  readonly executed_: ExecutionEvent[] = [];
  readonly order: Log = [];

  planned(event: PlannedActionEvent): Promise<void> {
    this.planned_.push(event);
    this.order.push({ kind: 'planned', ...event });
    return Promise.resolve();
  }

  executed(event: ExecutionEvent): Promise<void> {
    this.executed_.push(event);
    this.order.push({ kind: 'executed', ...event });
    return Promise.resolve();
  }
}

/** Records the attempt, then throws — proves the runtime swallows sink failures. */
class ThrowingLineage implements LineagePort {
  attempts = 0;

  planned(): Promise<void> {
    this.attempts += 1;
    return Promise.reject(new Error('lineage store down'));
  }

  executed(): Promise<void> {
    this.attempts += 1;
    return Promise.reject(new Error('lineage store down'));
  }
}

/** Throws SYNCHRONOUSLY (not a rejected promise) — the runtime must swallow this too. */
class SyncThrowingLineage implements LineagePort {
  attempts = 0;

  planned(): Promise<void> {
    this.attempts += 1;
    throw new Error('sync lineage failure');
  }

  executed(): Promise<void> {
    this.attempts += 1;
    throw new Error('sync lineage failure');
  }
}

class ScriptedRule implements PolicyRule {
  readonly id = 'POLICY_TEST_SCRIPTED';
  version = '1';
  outcome: PolicyOutcome;

  constructor(outcome: PolicyOutcome) {
    this.outcome = outcome;
  }

  evaluate(): RuleVerdict {
    return {
      outcome: this.outcome,
      reasonCode: `SCRIPTED_${this.outcome}`,
      reason: `scripted ${this.outcome}`,
    };
  }
}

class ControlledPort implements PolicyPort {
  throwing = false;
  readonly rule: ScriptedRule;
  readonly #inner: DefaultPolicyPort;

  constructor(outcome: PolicyOutcome) {
    this.rule = new ScriptedRule(outcome);
    this.#inner = new DefaultPolicyPort(new PolicyEngine([this.rule]));
  }

  evaluate(request: PolicyInvocationRequest): ReturnType<PolicyPort['evaluate']> {
    if (this.throwing) {
      return Promise.reject(new Error('policy store down'));
    }
    return this.#inner.evaluate(request);
  }
}

// --- ToolExecutor harness ----------------------------------------------------

type ToolMode = 'ok' | 'fail' | 'throw';

interface Behaviour {
  mode: ToolMode;
  /** The output the tool returns on success; tests change it between calls. */
  output: unknown;
}

function makeTool(
  behaviour: Behaviour,
  sideEffectClass: SideEffectClass = 'consequential',
): { tool: Tool; contexts: ToolExecutionContext[] } {
  const contexts: ToolExecutionContext[] = [];
  const tool: Tool = {
    manifest: {
      id: TOOL_ID,
      name: 'Create workspace',
      description: 'creates',
      sideEffectClass,
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: SCHEMA,
    },
    execute: (_input, context) => {
      contexts.push(context);
      if (behaviour.mode === 'throw') {
        return Promise.reject(new Error('tool exploded'));
      }
      if (behaviour.mode === 'fail') {
        return Promise.resolve({ ok: false, error: 'downstream said no', completedAt: nowIso() });
      }
      return Promise.resolve({ ok: true, output: behaviour.output, completedAt: nowIso() });
    },
  };
  return { tool, contexts };
}

interface ExecutorHarness {
  executor: ToolExecutor;
  contexts: ToolExecutionContext[];
  behaviour: Behaviour;
}

function executorHarness(
  options: {
    lineage?: LineagePort;
    policy?: PolicyPort;
    agentAuthority?: AgentAuthorityPort;
    verifier?: ExecutionVerifier;
    sideEffectClass?: SideEffectClass;
  } = {},
): ExecutorHarness {
  const behaviour: Behaviour = { mode: 'ok', output: { workspace: { id: 'wsp_new', name: 'X' } } };
  const tools = new ExecutableToolRegistry();
  const { tool, contexts } = makeTool(behaviour, options.sideEffectClass);
  tools.register(tool);
  const executor = new ToolExecutor({
    tools,
    ...(options.lineage === undefined ? {} : { lineage: options.lineage }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.agentAuthority === undefined ? {} : { agentAuthority: options.agentAuthority }),
    ...(options.verifier === undefined ? {} : { verifier: options.verifier }),
  });
  return { executor, contexts, behaviour };
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

describe('ToolExecutor lineage — executed events for real executions', () => {
  it('emits exactly one event whose invocationId matches the result, with fingerprints and attribution', async () => {
    const lineage = new RecordingLineage();
    const { executor, contexts, behaviour } = executorHarness({ lineage });

    const result = await executor.execute(
      {
        ...invocation,
        approvalId: 'apr_1',
        origin: 'approval',
        lineage: { workflow: { stepId: 'step_9', purpose: 'compensation' } },
      },
      true,
    );
    expect(result.ok).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(result.invocationId).toMatch(/^inv_/);
    expect(lineage.executed_).toHaveLength(1);

    const event = lineage.executed_[0] as ExecutionEvent;
    expect(event).toMatchObject({
      invocationId: result.invocationId,
      status: 'succeeded',
      verified: true,
      attempts: 1,
      tenantId: 'org_acme',
      workspaceId: 'wsp_1',
      userId: 'usr_alice',
      approvalId: 'apr_1',
      origin: 'approval',
      runId: 'run_1',
      capabilityId: TOOL_ID,
      toolId: TOOL_ID,
      workflow: { stepId: 'step_9', purpose: 'compensation' },
    });
    expect(event.agent).toBeUndefined();
    expect(event.delegationId).toBeUndefined();
    expect(event.inputFingerprint).toBe(fingerprintOf({ name: 'Engineering' }));
    expect(event.outputFingerprint).toBe(fingerprintOf(behaviour.output));
    expect(event.startedAt <= event.completedAt).toBe(true);

    // Positive control on the counter: a second real run is a second event with a NEW id.
    const second = await executor.execute(invocation, true);
    expect(lineage.executed_).toHaveLength(2);
    expect(lineage.executed_[1]?.invocationId).toBe(second.invocationId);
    expect(second.invocationId).not.toBe(result.invocationId);
    // No workflow / approval attribution invented when absent.
    expect(lineage.executed_[1]?.workflow).toBeUndefined();
    expect(lineage.executed_[1]?.approvalId).toBeUndefined();
  });

  it('carries the agent principal and delegation of an agent execution', async () => {
    const lineage = new RecordingLineage();
    const authority: AgentAuthorityPort = {
      authorize: () => Promise.resolve({ ok: true, delegationId: 'dlg_7' }),
    };
    const { executor } = executorHarness({ lineage, agentAuthority: authority });

    const result = await executor.execute({ ...invocation, origin: 'agent', agent: AGENT_A }, true);
    expect(result.ok).toBe(true);
    expect(lineage.executed_).toHaveLength(1);
    expect(lineage.executed_[0]).toMatchObject({
      agent: AGENT_A,
      delegationId: 'dlg_7',
      origin: 'agent',
      invocationId: result.invocationId,
    });
  });

  it('records the policy ref (id/version/fingerprint) exactly as decided', async () => {
    const lineage = new RecordingLineage();
    const port = new ControlledPort('ALLOW');
    const { executor } = executorHarness({ lineage, policy: port });

    const result = await executor.execute(invocation, false);
    expect(result.policy?.outcome).toBe('ALLOW');
    const policy = lineage.executed_[0]?.policy;
    expect(policy).toMatchObject({
      outcome: 'ALLOW',
      policyId: 'POLICY_TEST_SCRIPTED',
      version: '1',
      fingerprint: result.policy?.fingerprint,
    });
    expect(policy?.fingerprint).toBe('ALLOW|POLICY_TEST_SCRIPTED@1=ALLOW');

    // Positive control: a changed policy version is reflected in the next event.
    port.rule.version = '2';
    await executor.execute(invocation, false);
    expect(lineage.executed_[1]?.policy?.version).toBe('2');
  });

  it('passes contextFingerprint through when the port provides one, and omits it otherwise', async () => {
    const withContext: PolicyPort = {
      evaluate: async (request) => {
        const base = await new DefaultPolicyPort(
          new PolicyEngine([new ScriptedRule('ALLOW')]),
        ).evaluate(request);
        return { ...base, contextFingerprint: 'ctx_abc123' };
      },
    };
    const lineageA = new RecordingLineage();
    await executorHarness({ lineage: lineageA, policy: withContext }).executor.execute(
      invocation,
      false,
    );
    expect(lineageA.executed_[0]?.policy?.contextFingerprint).toBe('ctx_abc123');

    const lineageB = new RecordingLineage();
    await executorHarness({
      lineage: lineageB,
      policy: new ControlledPort('ALLOW'),
    }).executor.execute(invocation, false);
    expect(lineageB.executed_[0]?.policy).toBeDefined();
    expect(lineageB.executed_[0]?.policy).not.toHaveProperty('contextFingerprint');
  });

  it('a tool that reports failure => status failed, verified false, attempts 1, no output fingerprint', async () => {
    const lineage = new RecordingLineage();
    const { executor, behaviour } = executorHarness({ lineage });

    behaviour.mode = 'fail';
    const failed = await executor.execute(invocation, true);
    expect(failed.ok).toBe(false);
    expect(lineage.executed_).toHaveLength(1);
    const event = lineage.executed_[0] as ExecutionEvent;
    expect(event).toMatchObject({
      status: 'failed',
      errorCode: 'EXECUTION_ERROR',
      verified: false,
      attempts: 1,
      invocationId: failed.invocationId,
      inputFingerprint: fingerprintOf({ name: 'Engineering' }),
    });
    expect(event.outputFingerprint).toBeUndefined();
    expect(event.output).toBeUndefined();

    // Positive control: same call, tool healthy => succeeded WITH an output fingerprint.
    behaviour.mode = 'ok';
    await executor.execute(invocation, true);
    expect(lineage.executed_[1]).toMatchObject({ status: 'succeeded', verified: true });
    expect(lineage.executed_[1]?.outputFingerprint).toBeDefined();
  });

  it('a tool that throws => status failed and the event is still emitted', async () => {
    const lineage = new RecordingLineage();
    const { executor, behaviour, contexts } = executorHarness({ lineage });
    behaviour.mode = 'throw';
    const result = await executor.execute(invocation, true);
    expect(result.ok).toBe(false);
    expect(contexts).toHaveLength(1);
    expect(lineage.executed_).toEqual([
      expect.objectContaining({ status: 'failed', attempts: 1, verified: false }),
    ]);
    // The raw thrown message is not part of the event.
    expect(JSON.stringify(lineage.executed_)).not.toContain('tool exploded');
  });

  it('attempts reflects real retries of an idempotent tool; a non-idempotent tool is attempted once', async () => {
    const build = (idempotent: boolean): { executor: ToolExecutor; lineage: RecordingLineage } => {
      let calls = 0;
      const tools = new ExecutableToolRegistry();
      tools.register({
        manifest: {
          id: TOOL_ID,
          name: 'Create workspace',
          description: 'creates',
          sideEffectClass: 'consequential',
          idempotent,
          timeoutMs: 1000,
          inputSchema: SCHEMA,
        },
        execute: () => {
          calls += 1;
          return calls < 3
            ? Promise.reject(new Error('transient'))
            : Promise.resolve({ ok: true, output: { calls }, completedAt: nowIso() });
        },
      });
      const lineage = new RecordingLineage();
      return {
        lineage,
        executor: new ToolExecutor({
          tools,
          lineage,
          retryPolicy: defaultRetryPolicy({ maxAttempts: 3, backoffMs: 1 }),
        }),
      };
    };

    const idem = build(true);
    const ok = await idem.executor.execute(invocation, true);
    expect(ok.ok).toBe(true);
    expect(ok.attempts).toBe(3);
    expect(idem.lineage.executed_).toHaveLength(1); // one event per invocation, not per attempt
    expect(idem.lineage.executed_[0]).toMatchObject({
      status: 'succeeded',
      attempts: 3,
      invocationId: ok.invocationId,
    });

    const single = build(false);
    const failed = await single.executor.execute(invocation, true);
    expect(failed.ok).toBe(false);
    expect(single.lineage.executed_).toHaveLength(1);
    expect(single.lineage.executed_[0]).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('an unverified result => status unverified, verified false, errorCode UNVERIFIED', async () => {
    const lineage = new RecordingLineage();
    const verifier: ExecutionVerifier = {
      verify: () => Promise.resolve({ verified: false, checks: [], confidence: 0, message: 'no' }),
    };
    const { executor, contexts } = executorHarness({ lineage, verifier });

    const result = await executor.execute(invocation, true);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNVERIFIED');
    expect(contexts).toHaveLength(1);
    expect(lineage.executed_).toHaveLength(1);
    expect(lineage.executed_[0]).toMatchObject({
      status: 'unverified',
      errorCode: 'UNVERIFIED',
      verified: false,
      attempts: 1,
      invocationId: result.invocationId,
    });

    // Positive control: the default verifier on the same tool => verified success.
    const control = new RecordingLineage();
    await executorHarness({ lineage: control }).executor.execute(invocation, true);
    expect(control.executed_[0]).toMatchObject({ status: 'succeeded', verified: true });
  });

  it('the raw output is only in the in-process event; the fingerprint tracks the output', async () => {
    const lineage = new RecordingLineage();
    const { executor, behaviour } = executorHarness({ lineage });

    behaviour.output = { workspace: { id: 'wsp_a', secret: 'RAW-SECRET-1' } };
    await executor.execute(invocation, true);
    behaviour.output = { workspace: { id: 'wsp_b', secret: 'RAW-SECRET-2' } };
    await executor.execute(invocation, true);

    const [first, second] = lineage.executed_ as [ExecutionEvent, ExecutionEvent];
    expect(first.output).toEqual({ workspace: { id: 'wsp_a', secret: 'RAW-SECRET-1' } });
    expect(second.output).toEqual({ workspace: { id: 'wsp_b', secret: 'RAW-SECRET-2' } });
    expect(first.outputFingerprint).toBe(fingerprintOf(first.output));
    expect(second.outputFingerprint).toBe(fingerprintOf(second.output));
    expect(first.outputFingerprint).not.toBe(second.outputFingerprint);
    // Same input both times => same input fingerprint (control for the differing output one).
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
    // The fingerprint itself does not embed the raw value.
    expect(first.outputFingerprint).not.toContain('RAW-SECRET-1');
    // The caller's result still carries the output (the runtime's own contract).
    const again = await executor.execute(invocation, true);
    expect(again.output).toEqual(behaviour.output);
  });

  it('the input fingerprint changes with the input', async () => {
    const lineage = new RecordingLineage();
    const { executor } = executorHarness({ lineage });
    await executor.execute(invocation, true);
    await executor.execute({ ...invocation, input: { name: 'Marketing' } }, true);
    expect(lineage.executed_[0]?.inputFingerprint).toBe(fingerprintOf({ name: 'Engineering' }));
    expect(lineage.executed_[1]?.inputFingerprint).toBe(fingerprintOf({ name: 'Marketing' }));
    expect(lineage.executed_[0]?.inputFingerprint).not.toBe(lineage.executed_[1]?.inputFingerprint);
  });
});

describe('ToolExecutor lineage — refusals before execution emit nothing', () => {
  it('RBAC ceiling FORBIDDEN', async () => {
    const lineage = new RecordingLineage();
    const { executor, contexts } = executorHarness({ lineage });

    const denied = await executor.execute(
      { ...invocation, allowedCapabilityIds: ['workspaces.something_else'] },
      true,
    );
    expect(denied.error?.code).toBe('FORBIDDEN');
    expect(contexts).toHaveLength(0);
    expect(lineage.executed_).toEqual([]);

    const allowed = await executor.execute(
      { ...invocation, allowedCapabilityIds: [TOOL_ID] },
      true,
    );
    expect(allowed.ok).toBe(true);
    expect(lineage.executed_).toHaveLength(1);
  });

  it('RESERVED_ARGUMENT', async () => {
    const lineage = new RecordingLineage();
    const { executor, contexts } = executorHarness({ lineage });

    const denied = await executor.execute(
      { ...invocation, input: { name: 'A', workspaceId: 'wsp_x' } },
      true,
    );
    expect(denied.error?.code).toBe('RESERVED_ARGUMENT');
    expect(contexts).toHaveLength(0);
    expect(lineage.executed_).toEqual([]);

    expect((await executor.execute(invocation, true)).ok).toBe(true);
    expect(lineage.executed_).toHaveLength(1);
  });

  it('agent authority denial (and fail-closed with no authority port)', async () => {
    const lineage = new RecordingLineage();
    let check: AgentAuthorityCheck = {
      ok: false,
      reasonCode: 'DELEGATION_REVOKED',
      reason: 'revoked',
    };
    const authority: AgentAuthorityPort = { authorize: () => Promise.resolve(check) };
    const { executor, contexts } = executorHarness({ lineage, agentAuthority: authority });
    const agentInvocation: ToolInvocation = { ...invocation, origin: 'agent', agent: AGENT_A };

    const denied = await executor.execute(agentInvocation, true);
    expect(denied.error?.code).toBe('AGENT_NOT_AUTHORIZED');
    expect(contexts).toHaveLength(0);
    expect(lineage.executed_).toEqual([]);

    const noAuthority = executorHarness({ lineage });
    const failClosed = await noAuthority.executor.execute(agentInvocation, true);
    expect(failClosed.error?.code).toBe('AGENT_NOT_AUTHORIZED');
    expect(lineage.executed_).toEqual([]);

    check = { ok: true, delegationId: 'dlg_1' };
    const allowed = await executor.execute(agentInvocation, true);
    expect(allowed.ok).toBe(true);
    expect(lineage.executed_).toHaveLength(1);
    expect(lineage.executed_[0]?.delegationId).toBe('dlg_1');
  });

  it('POLICY_DENIED (final even with an approval)', async () => {
    const lineage = new RecordingLineage();
    const port = new ControlledPort('DENY');
    const { executor, contexts } = executorHarness({ lineage, policy: port });

    const denied = await executor.execute({ ...invocation, approvalId: 'apr_1' }, true);
    expect(denied.error?.code).toBe('POLICY_DENIED');
    expect(contexts).toHaveLength(0);
    expect(lineage.executed_).toEqual([]);

    port.rule.outcome = 'ALLOW';
    expect((await executor.execute(invocation, true)).ok).toBe(true);
    expect(lineage.executed_).toHaveLength(1);
  });

  it('POLICY_CHANGED_AFTER_APPROVAL', async () => {
    const lineage = new RecordingLineage();
    const port = new ControlledPort('REQUIRE_APPROVAL');
    const { executor, contexts } = executorHarness({ lineage, policy: port });
    const approvedPolicy = (await executor.execute(invocation, false)).policy
      ?.fingerprint as string;

    port.rule.version = '2';
    const changed = await executor.execute({ ...invocation, approvedPolicy }, true);
    expect(changed.error?.code).toBe('POLICY_CHANGED_AFTER_APPROVAL');
    expect(contexts).toHaveLength(0);
    expect(lineage.executed_).toEqual([]);

    port.rule.version = '1';
    expect((await executor.execute({ ...invocation, approvedPolicy }, true)).ok).toBe(true);
    expect(lineage.executed_).toHaveLength(1);
  });

  it('APPROVAL_REQUIRED block (attempts 0) emits nothing; the approved run emits one', async () => {
    const lineage = new RecordingLineage();
    const { executor, contexts } = executorHarness({ lineage });

    const blocked = await executor.execute(invocation, false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.error?.code).toBe('APPROVAL_REQUIRED');
    expect(blocked.attempts).toBe(0);
    expect(contexts).toHaveLength(0);
    expect(lineage.executed_).toEqual([]);
    // Refusals still get an invocation id (audit correlation) but no lineage event.
    expect(blocked.invocationId).toMatch(/^inv_/);

    const granted = await executor.execute(invocation, true);
    expect(granted.ok).toBe(true);
    expect(lineage.executed_).toHaveLength(1);
    expect(lineage.executed_[0]?.invocationId).toBe(granted.invocationId);
  });

  it('POLICY_UNAVAILABLE (throwing port)', async () => {
    const lineage = new RecordingLineage();
    const port = new ControlledPort('ALLOW');
    port.throwing = true;
    const { executor, contexts } = executorHarness({ lineage, policy: port });

    const result = await executor.execute(invocation, true);
    expect(result.error?.code).toBe('POLICY_UNAVAILABLE');
    expect(contexts).toHaveLength(0);
    expect(lineage.executed_).toEqual([]);

    port.throwing = false;
    expect((await executor.execute(invocation, true)).ok).toBe(true);
    expect(lineage.executed_).toHaveLength(1);
  });

  it('unknown tool (NOT_FOUND) emits nothing', async () => {
    const lineage = new RecordingLineage();
    const { executor } = executorHarness({ lineage });
    const result = await executor.execute({ ...invocation, toolId: 'nope.missing' }, true);
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(lineage.executed_).toEqual([]);
    await executor.execute(invocation, true);
    expect(lineage.executed_).toHaveLength(1);
  });
});

describe('ToolExecutor lineage — a throwing sink never changes the outcome', () => {
  function strip(result: Awaited<ReturnType<ToolExecutor['execute']>>): unknown {
    const { invocationId, completedAt, ...rest } = result;
    expect(invocationId).toMatch(/^inv_/);
    expect(typeof completedAt).toBe('string');
    const policy =
      rest.policy === undefined ? undefined : { ...rest.policy, evaluatedAt: 'normalized' };
    return { ...rest, policy };
  }

  it('success outcome is identical with a throwing sink, a recording sink and no sink', async () => {
    const throwing = new ThrowingLineage();
    const withThrow = await executorHarness({ lineage: throwing }).executor.execute(
      invocation,
      true,
    );
    const withRecord = await executorHarness({ lineage: new RecordingLineage() }).executor.execute(
      invocation,
      true,
    );
    const without = await executorHarness().executor.execute(invocation, true);

    expect(throwing.attempts).toBe(1); // the sink WAS called and did throw
    expect(withThrow.ok).toBe(true);
    expect(strip(withThrow)).toEqual(strip(without));
    expect(strip(withRecord)).toEqual(strip(without));
  });

  it('failure and refusal outcomes are identical with a throwing sink', async () => {
    const throwing = new ThrowingLineage();
    const a = executorHarness({ lineage: throwing });
    const b = executorHarness();
    a.behaviour.mode = 'fail';
    b.behaviour.mode = 'fail';
    const failedA = await a.executor.execute(invocation, true);
    const failedB = await b.executor.execute(invocation, true);
    expect(throwing.attempts).toBe(1);
    expect(failedA.ok).toBe(false);
    expect(strip(failedA)).toEqual(strip(failedB));

    const blockedA = await a.executor.execute(invocation, false);
    const blockedB = await b.executor.execute(invocation, false);
    expect(blockedA.blocked).toBe(true);
    expect(strip(blockedA)).toEqual(strip(blockedB));
    // The refusal never reached the sink (only the earlier real run did).
    expect(throwing.attempts).toBe(1);
  });
  it('a synchronously-throwing sink is also swallowed and the outcome is unchanged', async () => {
    const sink = new SyncThrowingLineage();
    const withSink = await executorHarness({ lineage: sink }).executor.execute(invocation, true);
    const without = await executorHarness().executor.execute(invocation, true);
    expect(sink.attempts).toBe(1);
    expect(withSink.ok).toBe(true);
    expect(strip(withSink)).toEqual(strip(without));
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
  contexts: ToolExecutionContext[];
}

function orchestratorHarness(
  lineage: LineagePort | undefined,
  options: { port?: PolicyPort; sideEffectClass?: SideEffectClass; executorLineage?: boolean } = {},
): OrchestratorHarness {
  const sideEffectClass = options.sideEffectClass ?? 'consequential';
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  const tools = new ExecutableToolRegistry();
  const approvals = new InMemoryApprovalEngine();

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

  const { tool, contexts } = makeTool(
    { mode: 'ok', output: { workspace: { id: 'wsp_new' } } },
    sideEffectClass,
  );
  tools.register(tool);

  const shared = options.executorLineage === false ? undefined : lineage;
  const executor = new ToolExecutor({
    tools,
    ...(shared === undefined ? {} : { lineage: shared }),
    ...(options.port === undefined ? {} : { policy: options.port }),
  });
  const orchestrator = new EnterpriseAIOrchestrator({
    discovery: new CapabilityDiscovery(registry, skills),
    executor,
    conversations: new ConversationManager(new InMemoryConversationStore()),
    approvals,
    planner: new SequentialPlanner({ parameterExtractor: extractName }),
    ...(lineage === undefined ? {} : { lineage }),
  });
  return { orchestrator, approvals, contexts };
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
  steps: { status: string; errorCode?: string }[];
}

async function run(h: OrchestratorHarness, extra: Record<string, unknown> = {}): Promise<Run> {
  return (await h.orchestrator.run({ ...baseRequest, ...extra })) as unknown as Run;
}

describe('orchestrator lineage — planned events', () => {
  it('emits a planned event per step with requiresApproval, policy and input fingerprint', async () => {
    const lineage = new RecordingLineage();
    const h = orchestratorHarness(lineage, { port: new ControlledPort('REQUIRE_APPROVAL') });

    const blocked = await run(h);
    expect(blocked.status).toBe('blocked');
    expect(lineage.planned_).toHaveLength(1);
    const planned = lineage.planned_[0] as PlannedActionEvent;
    expect(planned).toMatchObject({
      tenantId: 'org_acme',
      workspaceId: 'wsp_1',
      userId: 'usr_alice',
      origin: 'orchestrator',
      stepId: 'step_1',
      capabilityId: TOOL_ID,
      toolId: TOOL_ID,
      requiresApproval: true,
      inputFingerprint: fingerprintOf({ name: 'Engineering' }),
      policy: {
        outcome: 'REQUIRE_APPROVAL',
        policyId: 'POLICY_TEST_SCRIPTED',
        version: '1',
        fingerprint: 'REQUIRE_APPROVAL|POLICY_TEST_SCRIPTED@1=REQUIRE_APPROVAL',
      },
    });
    expect(planned.runId).toEqual(expect.any(String));
    // Nothing ran, so nothing was reported as executed.
    expect(lineage.executed_).toEqual([]);
    expect(h.contexts).toHaveLength(0);

    // Positive control: a read_only tool is planned with requiresApproval=false.
    const readLineage = new RecordingLineage();
    const readOnly = orchestratorHarness(readLineage, {
      port: new ControlledPort('ALLOW'),
      sideEffectClass: 'read_only',
    });
    expect((await run(readOnly)).status).toBe('completed');
    expect(readLineage.planned_).toHaveLength(1);
    expect(readLineage.planned_[0]?.requiresApproval).toBe(false);
    expect(readLineage.planned_[0]?.approvalId).toBeUndefined();
  });

  it('approvalId is present when an approval is open and when it is resumed', async () => {
    const lineage = new RecordingLineage();
    const h = orchestratorHarness(lineage, { port: new ControlledPort('REQUIRE_APPROVAL') });

    const first = await run(h);
    const approvalId = first.approvals[0]?.id as string;
    expect(approvalId).toBeDefined();
    expect(lineage.planned_[0]?.approvalId).toBe(approvalId);

    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
    const resumed = await run(h, { conversationId: first.conversationId, approvalId });
    expect(resumed.status).toBe('completed');
    expect(lineage.planned_).toHaveLength(2);
    expect(lineage.planned_[1]?.approvalId).toBe(approvalId);
    expect(lineage.executed_).toHaveLength(1);
    expect(lineage.executed_[0]?.approvalId).toBe(approvalId);
  });

  it('on approve+resume the planned input fingerprint equals the executed one; planned precedes executed', async () => {
    const lineage = new RecordingLineage();
    const h = orchestratorHarness(lineage, { port: new ControlledPort('REQUIRE_APPROVAL') });

    const first = await run(h);
    const approvalId = first.approvals[0]?.id as string;
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
    await run(h, { conversationId: first.conversationId, approvalId });

    expect(h.contexts).toHaveLength(1);
    const resumedPlanned = lineage.planned_[1] as PlannedActionEvent;
    const executed = lineage.executed_[0] as ExecutionEvent;
    expect(executed.inputFingerprint).toBe(resumedPlanned.inputFingerprint);
    expect(executed.inputFingerprint).toBe(fingerprintOf({ name: 'Engineering' }));
    // Same run, same tool, same policy fingerprint.
    expect(executed.runId).toBe(resumedPlanned.runId);
    expect(executed.toolId).toBe(resumedPlanned.toolId);
    expect(executed.policy?.fingerprint).toBe(resumedPlanned.policy?.fingerprint);

    // Ordering: every planned event precedes the executed event of its run.
    expect(lineage.order.map((e) => e.kind)).toEqual(['planned', 'planned', 'executed']);
    expect(lineage.order.findIndex((e) => e.kind === 'executed')).toBeGreaterThan(
      lineage.order.map((e) => e.kind).lastIndexOf('planned'),
    );
    expect(executed.origin).toBe('orchestrator');
  });

  it('a re-planned input that differs from the approved one: planned fingerprint DIFFERS from the approved one and nothing executes', async () => {
    const lineage = new RecordingLineage();
    const h = orchestratorHarness(lineage, { port: new ControlledPort('REQUIRE_APPROVAL') });

    const first = await run(h);
    const approvalId = first.approvals[0]?.id as string;
    const approved = await h.approvals.byId(approvalId);
    expect(approved?.input).toEqual({ name: 'Engineering' });
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });

    // The plan is rebuilt on resume; a changed utterance re-plans different arguments.
    const resumed = await run(h, {
      conversationId: first.conversationId,
      approvalId,
      utterance: 'create a workspace called Marketing',
    });
    expect(resumed.status).toBe('failed');
    expect(resumed.steps[0]).toMatchObject({
      status: 'failed',
      errorCode: 'APPROVAL_ARGUMENTS_MISMATCH',
    });
    expect(h.contexts).toHaveLength(0);
    expect(lineage.executed_).toEqual([]);

    const replanned = lineage.planned_[1] as PlannedActionEvent;
    expect(replanned.inputFingerprint).toBe(fingerprintOf({ name: 'Marketing' }));
    expect(replanned.inputFingerprint).not.toBe(fingerprintOf(approved?.input));
    // The re-plan is still bound to the open approval, and no execution follows either plan.
    expect(replanned.approvalId).toBe(approvalId);
    expect(lineage.order.map((e) => e.kind)).toEqual(['planned', 'planned']);
    // The first (approved) plan is unchanged history.
    expect(lineage.planned_[0]?.inputFingerprint).toBe(fingerprintOf(approved?.input));

    // Positive control: the unchanged utterance resumes and executes the approved input.
    const restored = await run(h, { conversationId: first.conversationId, approvalId });
    expect(restored.status).toBe('completed');
    expect(h.contexts).toHaveLength(1);
    expect(lineage.executed_).toHaveLength(1);
    expect(lineage.executed_[0]?.inputFingerprint).toBe(fingerprintOf(approved?.input));
  });

  it('planned and executed events carry the port contextFingerprint when provided', async () => {
    const withContext: PolicyPort = {
      evaluate: async (request) => ({
        ...(await new DefaultPolicyPort(
          new PolicyEngine([new ScriptedRule('REQUIRE_APPROVAL')]),
        ).evaluate(request)),
        contextFingerprint: 'ctx_xyz',
      }),
    };
    const lineage = new RecordingLineage();
    const h = orchestratorHarness(lineage, { port: withContext });
    const first = await run(h);
    const approvalId = first.approvals[0]?.id as string;
    expect(lineage.planned_[0]?.policy?.contextFingerprint).toBe('ctx_xyz');
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
    await run(h, { conversationId: first.conversationId, approvalId });
    expect(lineage.executed_[0]?.policy?.contextFingerprint).toBe('ctx_xyz');

    // Control: a port without one yields none.
    const plain = new RecordingLineage();
    await run(orchestratorHarness(plain, { port: new ControlledPort('REQUIRE_APPROVAL') }));
    expect(plain.planned_[0]?.policy).not.toHaveProperty('contextFingerprint');
  });

  it('a policy DENY before approval opens plans nothing and executes nothing', async () => {
    const lineage = new RecordingLineage();
    const port = new ControlledPort('DENY');
    const h = orchestratorHarness(lineage, { port });

    const denied = await run(h);
    expect(denied.status).toBe('failed');
    expect(lineage.planned_).toEqual([]);
    expect(lineage.executed_).toEqual([]);

    port.rule.outcome = 'REQUIRE_APPROVAL';
    await run(h);
    expect(lineage.planned_).toHaveLength(1);
  });
});

describe('orchestrator lineage — a throwing sink does not break the run', () => {
  it('a blocked run has the same shape with a throwing sink as with none', async () => {
    const throwing = new ThrowingLineage();
    const withThrow = orchestratorHarness(throwing, {
      port: new ControlledPort('REQUIRE_APPROVAL'),
    });
    const without = orchestratorHarness(undefined, {
      port: new ControlledPort('REQUIRE_APPROVAL'),
    });

    const a = await run(withThrow);
    const b = await run(without);
    expect(throwing.attempts).toBeGreaterThan(0);
    expect(a.status).toBe('blocked');
    expect(a.status).toBe(b.status);
    expect(a.steps.map((s) => s.status)).toEqual(b.steps.map((s) => s.status));
    expect(a.approvals.map((x) => x.status)).toEqual(b.approvals.map((x) => x.status));
  });

  it('a synchronously-throwing sink does not break a full approve+resume run', async () => {
    const sink = new SyncThrowingLineage();
    const h = orchestratorHarness(sink, { port: new ControlledPort('REQUIRE_APPROVAL') });
    const first = await run(h);
    expect(first.status).toBe('blocked');
    const approvalId = first.approvals[0]?.id as string;
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });
    const resumed = await run(h, { conversationId: first.conversationId, approvalId });
    expect(resumed.status).toBe('completed');
    expect(h.contexts).toHaveLength(1);
    expect(sink.attempts).toBe(3);
  });

  it('an approved run still executes and completes with a throwing sink', async () => {
    const throwing = new ThrowingLineage();
    const h = orchestratorHarness(throwing, { port: new ControlledPort('REQUIRE_APPROVAL') });
    const first = await run(h);
    const approvalId = first.approvals[0]?.id as string;
    h.approvals.decide(approvalId, { decision: 'grant', decidedBy: 'usr_alice' });

    const resumed = await run(h, { conversationId: first.conversationId, approvalId });
    expect(resumed.status).toBe('completed');
    expect(h.contexts).toHaveLength(1);
    // planned x2 + executed x1 all reached the (throwing) sink.
    expect(throwing.attempts).toBe(3);
    expect((await h.approvals.byId(approvalId))?.status).toBe('completed');
  });
});
