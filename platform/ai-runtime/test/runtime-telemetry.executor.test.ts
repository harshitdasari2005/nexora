/**
 * @nexora/ai-runtime — ToolExecutor runtime telemetry (Prompt 7).
 *
 * Telemetry is descriptive only: it records per-invocation timing, retries and
 * the tool call, and can NEVER change an outcome or a refusal.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';
import type { AgentPrincipalContext } from '@nexora/contracts/agent';
import { PolicyEngine, type PolicyOutcome, type PolicyRule } from '@nexora/module-policy';
import {
  RunCollector,
  RunTelemetryHub,
  type RuntimeRun,
  type RunMeta,
} from '@nexora/module-observability';
import { NexoraError } from '@nexora/shared/errors';
import type { ErrorCode } from '@nexora/shared/constants';
import { nowIso } from '@nexora/shared/time';

import { ToolExecutor, type ToolInvocation } from '../src/execution/tool-executor.js';
import { DefaultPolicyPort } from '../src/execution/policy-port.js';
import type { RetryPolicy } from '../src/execution/retry-policy.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';

const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  additionalProperties: false,
};

const META: RunMeta = {
  runId: 'run_1',
  tenantId: 'org_1',
  actorId: 'usr_1',
  origin: 'orchestrator',
};

const invocation: ToolInvocation = {
  toolId: 'demo.read',
  capabilityId: 'demo.read',
  input: { name: 'x' },
  userId: 'usr_1',
  tenantId: 'org_1',
  runId: 'run_1',
  origin: 'orchestrator',
};

const AGENT: AgentPrincipalContext = { agentId: 'agt_a', definitionId: 'executive', name: 'A' };

function tool(
  id: string,
  opts: {
    idempotent?: boolean;
    sideEffectClass?: 'read_only' | 'consequential';
    execute?: Tool['execute'];
  } = {},
): Tool {
  return {
    manifest: {
      id,
      name: id,
      description: id,
      sideEffectClass: opts.sideEffectClass ?? 'read_only',
      idempotent: opts.idempotent ?? false,
      timeoutMs: 1000,
      inputSchema: SCHEMA,
    },
    execute:
      opts.execute ?? (async () => ({ ok: true, output: { done: true }, completedAt: nowIso() })),
  };
}

function registry(...tools: Tool[]): ExecutableToolRegistry {
  const r = new ExecutableToolRegistry();
  for (const t of tools) r.register(t);
  return r;
}

/** Retries `INTERNAL_ERROR`-style thrown faults quickly (1ms backoff). */
const fastRetry = (retryable: readonly string[], maxAttempts = 3): RetryPolicy => ({
  maxAttempts,
  backoffMs: 1,
  isRetryable: (error) => retryable.includes(error.code),
  delayForAttempt: () => 1,
});

/** A typed platform error carrying a real ErrorCode (untyped throws normalize to INTERNAL_ERROR). */
class CodedError extends NexoraError {
  constructor(code: string) {
    super('x', code as ErrorCode);
  }
}

function hubWithSink(): { hub: RunTelemetryHub; runs: RuntimeRun[] } {
  const runs: RuntimeRun[] = [];
  const hub = new RunTelemetryHub({ sink: (run) => void runs.push(run) });
  return { hub, runs };
}

async function finished(hub: RunTelemetryHub, key = 'run_1'): Promise<RuntimeRun> {
  const run = await hub.end(key, 'completed');
  if (run === undefined) throw new Error('run not active');
  return run;
}

describe('ToolExecutor telemetry — successful call', () => {
  it('reports one verified ToolCall and attributes each segment stage once', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(tool('demo.read')),
    });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(true);

    const run = await finished(hub);
    expect(run.tools).toHaveLength(1);
    const call = run.tools[0]!;
    expect(call).toMatchObject({
      toolId: 'demo.read',
      capabilityId: 'demo.read',
      origin: 'orchestrator',
      status: 'succeeded',
      attempts: 1,
      verified: true,
      invocationId: result.invocationId,
    });
    expect(call.retries).toEqual([]);
    expect(typeof call.verificationMs).toBe('number');
    expect(call.verificationMs).toBeGreaterThanOrEqual(0);
    expect(call.errorCode).toBeUndefined();
    expect(call.policy).toMatchObject({ outcome: 'ALLOW' });
    expect(call.policy?.policyId).toBeTruthy();
    expect(run.verified).toBe(true);

    const stages = run.stages.map((s) => s.stage);
    expect(stages).toContain('POLICY');
    expect(stages).toContain('EXECUTION');
    expect(stages).not.toContain('RETRIEVAL');
    expect(stages).not.toContain('APPROVAL');
    for (const s of run.stages) {
      // Every segment was attributed exactly once (no double counting).
      expect(s.count).toBe(1);
    }
    expect(run.policies).toHaveLength(1);
    expect(run.policies[0]).toMatchObject({ phase: 'execute', outcome: 'ALLOW' });
  });

  it('attributes AUTHORIZATION (agent delegation) and VERIFICATION once each', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(tool('demo.read')),
      agentAuthority: {
        authorize: async () => {
          await new Promise((r) => setTimeout(r, 3));
          return { ok: true, delegationId: 'dlg_1' };
        },
      },
      verifier: {
        verify: async (r) => {
          await new Promise((res) => setTimeout(res, 3));
          return { verified: r.ok, checks: [], confidence: 1, message: 'ok' };
        },
      },
    });
    const result = await executor.execute({ ...invocation, agent: AGENT });
    expect(result.ok).toBe(true);
    const run = await finished(hub);
    const byStage = new Map(run.stages.map((s) => [s.stage, s]));
    for (const stage of ['AUTHORIZATION', 'POLICY', 'EXECUTION', 'VERIFICATION'] as const) {
      expect(byStage.get(stage)?.count, stage).toBe(1);
    }
    expect(byStage.get('AUTHORIZATION')!.durationMs).toBeGreaterThan(0);
    expect(byStage.get('VERIFICATION')!.durationMs).toBeGreaterThan(0);
    expect(run.tools[0]).toMatchObject({ delegationId: 'dlg_1' });
    expect(run.tools[0]!.verificationMs).toBeGreaterThan(0);
  });

  it('a search tool is attributed to RETRIEVAL (not EXECUTION) and recorded as a retrieval', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(
        tool('knowledge.search', {
          execute: async () => ({
            ok: true,
            output: { references: [{ id: 'a' }, { id: 'b' }] },
            completedAt: nowIso(),
          }),
        }),
      ),
    });
    await executor.execute({ ...invocation, toolId: 'knowledge.search', capabilityId: undefined });
    const run = await finished(hub);
    const stages = run.stages.map((s) => s.stage);
    expect(stages).toContain('RETRIEVAL');
    expect(stages).not.toContain('EXECUTION');
    expect(run.retrievals).toEqual([
      expect.objectContaining({ toolId: 'knowledge.search', resultCount: 2, status: 'succeeded' }),
    ]);
  });
});

describe('ToolExecutor telemetry — failures', () => {
  it('a tool that reports failure => failed ToolCall, errorCode, noted error', async () => {
    const { hub } = hubWithSink();
    const collector = hub.begin(META);
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(
        tool('demo.read', {
          execute: async () => ({ ok: false, error: 'nope', completedAt: nowIso() }),
        }),
      ),
    });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(false);
    expect(collector.firstError).toEqual({
      code: 'EXECUTION_ERROR',
      toolId: 'demo.read',
      invocationId: result.invocationId,
    });
    const run = await finished(hub);
    expect(run.tools[0]).toMatchObject({
      status: 'failed',
      errorCode: 'EXECUTION_ERROR',
      attempts: 1,
      verified: false,
    });
    expect(run.verified).toBe(false);
  });

  it('an unverified result is reported as unverified', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(tool('demo.read')),
      verifier: {
        verify: async () => ({ verified: false, checks: [], confidence: 0, message: 'bad' }),
      },
    });
    const result = await executor.execute(invocation);
    expect(result.error?.code).toBe('UNVERIFIED');
    const run = await finished(hub);
    expect(run.tools[0]).toMatchObject({ status: 'unverified', errorCode: 'UNVERIFIED' });
  });
});

describe('ToolExecutor telemetry — retries', () => {
  function flaky(failures: number, code = 'UNAVAILABLE'): { tool: Tool; calls: () => number } {
    let calls = 0;
    const t = tool('demo.read', {
      idempotent: true,
      execute: async () => {
        calls += 1;
        if (calls <= failures) throw new CodedError(code);
        return { ok: true, output: { done: true }, completedAt: nowIso() };
      },
    });
    return { tool: t, calls: () => calls };
  }

  it('records RetryRecords for a retryable error on an idempotent tool, then succeeds', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const { tool: t, calls } = flaky(2);
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(t),
      retryPolicy: fastRetry(['UNAVAILABLE']),
    });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(calls()).toBe(3);
    const run = await finished(hub);
    const call = run.tools[0]!;
    expect(call.attempts).toBe(3);
    expect(call.status).toBe('succeeded');
    expect(call.retries).toEqual([
      { attempt: 1, errorCode: 'UNAVAILABLE', delayMs: 1, reason: 'TRANSIENT_INFRASTRUCTURE' },
      { attempt: 2, errorCode: 'UNAVAILABLE', delayMs: 1, reason: 'TRANSIENT_INFRASTRUCTURE' },
    ]);
  });

  it('exhausting retries reports attempts > 1 and a failed call', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const { tool: t, calls } = flaky(10);
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(t),
      retryPolicy: fastRetry(['UNAVAILABLE'], 2),
    });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(false);
    expect(calls()).toBe(2);
    const run = await finished(hub);
    expect(run.tools[0]).toMatchObject({ status: 'failed', errorCode: 'UNAVAILABLE', attempts: 2 });
    expect(run.tools[0]!.retries).toHaveLength(1);
  });

  it('a non-retryable error is never retried', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const { tool: t, calls } = flaky(10, 'VALIDATION_ERROR');
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(t),
      retryPolicy: fastRetry(['UNAVAILABLE']),
    });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(false);
    expect(calls()).toBe(1);
    const run = await finished(hub);
    expect(run.tools[0]).toMatchObject({ attempts: 1, errorCode: 'VALIDATION_ERROR' });
    expect(run.tools[0]!.retries).toEqual([]);
  });

  it('a NON-idempotent tool is never retried even for a retryable error', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const calls = { n: 0 };
    const t = tool('demo.read', {
      idempotent: false,
      execute: async () => {
        calls.n += 1;
        throw new CodedError('UNAVAILABLE');
      },
    });
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(t),
      retryPolicy: fastRetry(['UNAVAILABLE']),
    });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(false);
    expect(calls.n).toBe(1);
    const run = await finished(hub);
    expect(run.tools[0]).toMatchObject({ attempts: 1 });
    expect(run.tools[0]!.retries).toEqual([]);
  });
});

describe('ToolExecutor telemetry — refusals are never retried and never a ToolCall', () => {
  function scriptedPolicy(outcome: PolicyOutcome, version = '1'): DefaultPolicyPort {
    const rule: PolicyRule = {
      id: 'POLICY_TEST_SCRIPTED',
      version,
      evaluate: () => ({ outcome, reasonCode: `S_${outcome}`, reason: outcome }),
    };
    return new DefaultPolicyPort(new PolicyEngine([rule]));
  }

  async function refused(
    setup: {
      executorOptions?: Partial<ConstructorParameters<typeof ToolExecutor>[0]>;
      invocation?: Partial<ToolInvocation>;
      approvalGranted?: boolean;
    },
    expectedCode: string,
  ): Promise<{ run: RuntimeRun; ran: number }> {
    const { hub } = hubWithSink();
    const collector = hub.begin(META);
    let ran = 0;
    const t = tool('demo.read', {
      // Idempotent + a retry policy that would retry anything: refusals must still not retry.
      idempotent: true,
      execute: async () => {
        ran += 1;
        return { ok: true, output: {}, completedAt: nowIso() };
      },
    });
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(t),
      retryPolicy: {
        maxAttempts: 5,
        backoffMs: 1,
        isRetryable: () => true,
        delayForAttempt: () => 1,
      },
      ...setup.executorOptions,
    });
    const result = await executor.execute(
      { ...invocation, ...setup.invocation },
      setup.approvalGranted ?? false,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(expectedCode);
    expect(result.attempts).toBe(0);
    expect(collector.firstError?.code).toBe(expectedCode);
    const run = await finished(hub);
    expect(run.tools).toEqual([]);
    expect(run.retrievals).toEqual([]);
    return { run, ran };
  }

  it('POLICY_DENIED', async () => {
    const { run, ran } = await refused(
      { executorOptions: { policy: scriptedPolicy('DENY') } },
      'POLICY_DENIED',
    );
    expect(ran).toBe(0);
    expect(run.policies[0]).toMatchObject({ outcome: 'DENY', phase: 'execute' });
  });

  it('FORBIDDEN (capability outside the RBAC ceiling)', async () => {
    const { ran } = await refused(
      { invocation: { allowedCapabilityIds: ['other.capability'] } },
      'FORBIDDEN',
    );
    expect(ran).toBe(0);
  });

  it('delegation denial (AGENT_NOT_AUTHORIZED) — attributes AUTHORIZATION time, no tool call', async () => {
    const { run, ran } = await refused(
      {
        executorOptions: {
          agentAuthority: {
            authorize: async () => {
              await new Promise((r) => setTimeout(r, 3));
              return {
                ok: false,
                reasonCode: 'DELEGATION_REVOKED',
                reason: 'revoked',
              };
            },
          },
        },
        invocation: { agent: AGENT },
      },
      'AGENT_NOT_AUTHORIZED',
    );
    expect(ran).toBe(0);
    expect(run.stages.find((s) => s.stage === 'AUTHORIZATION')?.count).toBe(1);
    expect(run.stages.map((s) => s.stage)).not.toContain('EXECUTION');
  });

  it('agent with no authority port fails closed', async () => {
    const { ran } = await refused({ invocation: { agent: AGENT } }, 'AGENT_NOT_AUTHORIZED');
    expect(ran).toBe(0);
  });

  it('RESERVED_ARGUMENT (forged scope)', async () => {
    const { ran } = await refused(
      { invocation: { input: { name: 'x', organizationId: 'org_attacker' } } },
      'RESERVED_ARGUMENT',
    );
    expect(ran).toBe(0);
  });

  it('POLICY_UNAVAILABLE (throwing port)', async () => {
    const { ran } = await refused(
      {
        executorOptions: {
          policy: {
            evaluate: () => Promise.reject(new Error('down')),
          },
        },
      },
      'POLICY_UNAVAILABLE',
    );
    expect(ran).toBe(0);
  });

  it('approval mismatch: policy changed after approval (POLICY_CHANGED_AFTER_APPROVAL)', async () => {
    const { ran } = await refused(
      {
        executorOptions: { policy: scriptedPolicy('REQUIRE_APPROVAL', '2') },
        invocation: { approvalId: 'apr_1', approvedPolicy: 'stale|fingerprint' },
        approvalGranted: true,
      },
      'POLICY_CHANGED_AFTER_APPROVAL',
    );
    expect(ran).toBe(0);
  });

  it('APPROVAL_REQUIRED (gate not granted) is a block, not a ToolCall, and does not run the tool', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    let ran = 0;
    const executor = new ToolExecutor({
      telemetry: hub,
      tools: registry(
        tool('demo.read', {
          execute: async () => {
            ran += 1;
            return { ok: true, output: {}, completedAt: nowIso() };
          },
        }),
      ),
      policy: scriptedPolicy('REQUIRE_APPROVAL'),
    });
    const result = await executor.execute(invocation, false);
    expect(result.blocked).toBe(true);
    expect(result.attempts).toBe(0);
    expect(ran).toBe(0);
    const run = await finished(hub);
    expect(run.tools).toEqual([]);
  });
});

describe('ToolExecutor telemetry never changes outcomes', () => {
  const scenarios: Array<{ name: string; tool: Tool; inv?: Partial<ToolInvocation> }> = [
    { name: 'success', tool: tool('demo.read') },
    {
      name: 'tool failure',
      tool: tool('demo.read', {
        execute: async () => ({ ok: false, error: 'bad', completedAt: nowIso() }),
      }),
    },
    {
      name: 'thrown error',
      tool: tool('demo.read', {
        execute: async () => {
          throw new CodedError('BOOM');
        },
      }),
    },
    { name: 'forged argument', tool: tool('demo.read'), inv: { input: { userId: 'u' } } },
    { name: 'forbidden', tool: tool('demo.read'), inv: { allowedCapabilityIds: ['z'] } },
  ];

  const strip = (r: Awaited<ReturnType<ToolExecutor['execute']>>) => {
    const { invocationId: _i, completedAt: _c, policy, ...rest } = r;
    void _i;
    void _c;
    const { evaluatedAt: _e, ...stable } = policy ?? ({} as Record<string, unknown>);
    void _e;
    return { ...rest, policy: stable };
  };

  for (const scenario of scenarios) {
    it(`identical result with and without a hub: ${scenario.name}`, async () => {
      const plain = new ToolExecutor({ tools: registry(scenario.tool) });
      const { hub } = hubWithSink();
      hub.begin(META);
      const observed = new ToolExecutor({ tools: registry(scenario.tool), telemetry: hub });
      const inv = { ...invocation, ...scenario.inv };
      const a = await plain.execute(inv);
      const b = await observed.execute(inv);
      expect(strip(b)).toEqual(strip(a));
    });
  }

  it('a hub whose sink throws does not affect the result (or ending the run)', async () => {
    const hub = new RunTelemetryHub({
      sink: () => {
        throw new Error('sink down');
      },
    });
    hub.begin(META);
    const executor = new ToolExecutor({ tools: registry(tool('demo.read')), telemetry: hub });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(true);
    await expect(hub.end('run_1', 'completed')).resolves.toMatchObject({ id: 'run_1' });
  });

  it('a collector that throws does not affect the result', async () => {
    const hub = new RunTelemetryHub();
    const collector = hub.begin(META);
    const boom = (): never => {
      throw new Error('collector broke');
    };
    collector.invocation = boom;
    collector.policy = boom;
    collector.noteError = boom;
    collector.addStage = boom;
    const executor = new ToolExecutor({
      tools: registry(
        tool('demo.read', {
          execute: async () => ({ ok: false, error: 'bad', completedAt: nowIso() }),
        }),
      ),
      telemetry: hub,
    });
    const failed = await executor.execute(invocation);
    expect(failed).toMatchObject({ ok: false, error: { code: 'EXECUTION_ERROR' }, attempts: 1 });

    const ok = new ToolExecutor({ tools: registry(tool('demo.read')), telemetry: hub });
    const result = await ok.execute(invocation);
    expect(result).toMatchObject({ ok: true, verified: true, attempts: 1 });
  });

  it('an invocation under an unknown runId records nothing', async () => {
    const { hub } = hubWithSink();
    hub.begin(META);
    const executor = new ToolExecutor({ tools: registry(tool('demo.read')), telemetry: hub });
    const result = await executor.execute({ ...invocation, runId: 'run_unknown' });
    expect(result.ok).toBe(true);
    const run = await finished(hub);
    expect(run.tools).toEqual([]);
    expect(hub.get('run_unknown')).toBeUndefined();
  });
});

describe('ToolExecutor telemetry — runKey', () => {
  it('files telemetry under runKey rather than runId', async () => {
    const { hub } = hubWithSink();
    hub.begin({ ...META, runId: 'run_session' });
    hub.begin({ ...META, runId: 'run_call' });
    const executor = new ToolExecutor({ tools: registry(tool('demo.read')), telemetry: hub });
    await executor.execute({ ...invocation, runId: 'run_session', runKey: 'run_call' });
    const call = await finished(hub, 'run_call');
    const session = await finished(hub, 'run_session');
    expect(call.tools).toHaveLength(1);
    expect(session.tools).toHaveLength(0);
  });

  it('an unknown run key is ignored and never fails the call', async () => {
    const { hub } = hubWithSink();
    const collector = hub.begin(META);
    const executor = new ToolExecutor({ tools: registry(tool('demo.read')), telemetry: hub });
    const result = await executor.execute({ ...invocation, runKey: 'run_nope' });
    expect(result.ok).toBe(true);
    expect(collector.firstError).toBeUndefined();
    const run = await finished(hub);
    expect(run.tools).toEqual([]);
  });

  it('RunCollector type is exported for hosts', () => {
    expect(typeof RunCollector).toBe('function');
  });
});
