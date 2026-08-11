/**
 * BaseAgent execution tests: lifecycle gating, approval, metrics, events,
 * and error paths.
 */

import { describe, expect, it } from 'vitest';
import type { Result } from '@nexora/shared/result';

import { BaseAgent, type AgentDependencies } from '../src/base/index.js';
import { InMemoryMetricsRecorder } from '../src/metrics/index.js';
import {
  FakeMemoryProvider,
  fakeExecutionContext,
  MockAgent,
  testManifest,
} from '../src/testing/index.js';
import type { ExecutionContext } from '../src/contexts/index.js';
import type { PolicyEvaluation } from '../src/policies/index.js';
import type { ExecutionFailure } from '../src/types/index.js';

/** A configurable approval-gated agent for tests. */
class ApprovalAgent extends BaseAgent<string, string> {
  private readonly requireApproval: boolean;
  private readonly approve: boolean;

  constructor(
    requireApproval: boolean,
    approve: boolean,
    dependencies: Partial<AgentDependencies> = {},
  ) {
    super({
      manifest: testManifest({ identity: { id: 'agt_appr', name: 'approval', displayName: 'A' } }),
      ...dependencies,
    });
    this.requireApproval = requireApproval;
    this.approve = approve;
  }

  protected override async shouldRequireApproval(): Promise<boolean> {
    return this.requireApproval;
  }

  protected override async requestApproval(): Promise<{ granted: boolean }> {
    return { granted: this.approve };
  }

  protected override async execute(input: string): Promise<Result<string, ExecutionFailure>> {
    return { ok: true, value: `approved:${input}` };
  }
}

/** A policy-gated agent for tests. */
class PolicyAgent extends BaseAgent<string, string> {
  private readonly deny: boolean;

  constructor(deny: boolean, dependencies: Partial<AgentDependencies> = {}) {
    super({
      manifest: testManifest({ identity: { id: 'agt_pol', name: 'policy', displayName: 'P' } }),
      ...dependencies,
    });
    this.deny = deny;
  }

  protected override async checkPolicy(): Promise<PolicyEvaluation> {
    if (this.deny) {
      return {
        allowed: false,
        decisions: [{ allowed: false, policyId: 'p1', reason: 'not allowed' }],
        deniedBy: 'p1',
      };
    }
    return { allowed: true, decisions: [] };
  }

  protected override async execute(input: string): Promise<Result<string, ExecutionFailure>> {
    return { ok: true, value: `policy:${input}` };
  }
}

/** An agent that throws during execution. */
class ThrowingAgent extends BaseAgent<string, string> {
  constructor() {
    super({ manifest: testManifest() });
  }

  protected override async execute(
    _input: string,
    _context: ExecutionContext,
  ): Promise<Result<string, ExecutionFailure>> {
    throw new Error('boom');
  }
}

describe('BaseAgent', () => {
  it('rejects executions before markReady', async () => {
    const agent = new MockAgent();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AGENT_NOT_READY');
    }
  });

  it('runs a successful execution after markReady', async () => {
    const agent = new MockAgent();
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('handled:hi');
    }
    expect(agent.executions).toBe(1);
  });

  it('rejects invalid execution contexts with validation errors', async () => {
    const agent = new MockAgent();
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext({ tenantId: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns typed failures from the handler', async () => {
    const agent = new MockAgent(testManifest(), () => ({
      ok: false as const,
      error: { code: 'BUSINESS_RULE_VIOLATION', message: 'nope' },
    }));
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BUSINESS_RULE_VIOLATION');
    }
  });

  it('converts thrown errors into INTERNAL_ERROR failures', async () => {
    const agent = new ThrowingAgent();
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INTERNAL_ERROR');
    }
  });

  it('requires approval when the agent asks for it', async () => {
    const agent = new ApprovalAgent(true, true);
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata.requiredApproval).toBe(true);
      expect(result.metadata.approvalGranted).toBe(true);
    }
  });

  it('rejects executions when approval is denied', async () => {
    const agent = new ApprovalAgent(true, false);
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('APPROVAL_REJECTED');
    }
  });

  it('runs without approval by default', async () => {
    const agent = new ApprovalAgent(false, false);
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(true);
  });

  it('records metrics for successful executions', async () => {
    const metrics = new InMemoryMetricsRecorder();
    const agent = new MockAgent(testManifest(), undefined, { metrics });
    agent.markReady();
    await agent.run('hi', fakeExecutionContext());
    expect(metrics.executions.executionsStarted).toBe(1);
    expect(metrics.executions.executionsSucceeded).toBe(1);
    expect(metrics.executions.executionsFailed).toBe(0);
    expect(metrics.latency.sampleCount).toBe(1);
  });

  it('records metrics for failed executions', async () => {
    const metrics = new InMemoryMetricsRecorder();
    const agent = new MockAgent(
      testManifest(),
      () => ({ ok: false as const, error: { code: 'X', message: 'x' } }),
      { metrics },
    );
    agent.markReady();
    await agent.run('hi', fakeExecutionContext());
    expect(metrics.executions.executionsFailed).toBe(1);
    expect(metrics.executions.executionsSucceeded).toBe(0);
  });

  it('emits execution lifecycle events', async () => {
    const agent = new MockAgent();
    agent.markReady();
    const types: string[] = [];
    agent.events.subscribe((event) => types.push(event.type));
    await agent.run('hi', fakeExecutionContext());
    expect(types).toContain('execution.started');
    expect(types).toContain('execution.completed');
  });

  it('emits execution.failed events on failure', async () => {
    const agent = new MockAgent(testManifest(), () => ({
      ok: false as const,
      error: { code: 'X', message: 'x' },
    }));
    agent.markReady();
    const types: string[] = [];
    agent.events.subscribe((event) => types.push(event.type));
    await agent.run('hi', fakeExecutionContext());
    expect(types).toContain('execution.failed');
  });

  it('emits agent.ready exactly once across repeated markReady calls', async () => {
    const agent = new MockAgent();
    const readyEvents = agent.events.history().filter((event) => event.type === 'agent.ready');
    expect(readyEvents).toHaveLength(0);
    agent.markReady();
    agent.markReady();
    expect(agent.events.history().filter((event) => event.type === 'agent.ready')).toHaveLength(1);
  });

  it('returns to ready after execution for reuse', async () => {
    const agent = new MockAgent();
    agent.markReady();
    await agent.run('first', fakeExecutionContext());
    expect(agent.lifecycle.isReady).toBe(true);
    const second = await agent.run('second', fakeExecutionContext());
    expect(second.ok).toBe(true);
  });

  it('exposes identity, version, and config defaults', () => {
    const agent = new MockAgent();
    expect(agent.identity.name).toBe('test');
    expect(agent.version).toBe('1.0.0');
    expect(agent.config.timeoutMs).toBe(30_000);
    expect(agent.config.memoryEnabled).toBe(true);
  });

  it('accepts injected memory and knowledge providers', async () => {
    const memory = new FakeMemoryProvider();
    const knowledge = {
      name: 'fake-knowledge',
      retrieve: async () => ({
        references: [
          { itemId: 'k1', source: { id: 'src_1', kind: 'kb', name: 'KB' }, snippet: 'x' },
        ],
        citations: [{ itemId: 'k1', sourceId: 'src_1', snippet: 'x' }],
        servedAt: new Date().toISOString(),
      }),
    };
    const agent = new MockAgent(testManifest(), undefined, { memory, knowledge });
    agent.markReady();
    await memory.store({ id: 'm1', content: 'v', createdAt: new Date().toISOString() });
    const snapshot = await memory.snapshot();
    expect(snapshot.items).toHaveLength(1);
    await agent.run('hi', fakeExecutionContext());
    expect(agent.executions).toBe(1);
  });

  it('rejects execution while the agent is busy', async () => {
    const agent = new MockAgent();
    agent.markReady();
    agent.lifecycle.transition('executing');
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AGENT_BUSY');
    }
  });

  it('denies executions when policy evaluation denies', async () => {
    const agent = new PolicyAgent(true);
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('POLICY_VIOLATION');
    }
  });

  it('runs executions when policy evaluation allows', async () => {
    const agent = new PolicyAgent(false);
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('policy:hi');
    }
  });

  it('honors the injected policy evaluator through checkPolicy', async () => {
    const agent = new MockAgent(testManifest(), () => ({ ok: true, value: 'ok' }), {
      policies: {
        name: 'deny-all',
        evaluate: async () => ({
          allowed: false,
          decisions: [{ allowed: false, policyId: 'p9' }],
          deniedBy: 'p9',
        }),
      },
    });
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('POLICY_VIOLATION');
    }
  });

  it('times out executions exceeding the configured budget', async () => {
    const agent = new MockAgent(
      testManifest(),
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { ok: true as const, value: 'late' };
      },
      { config: { timeoutMs: 50 } },
    );
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TIMEOUT');
    }
  });

  it('retries transient thrown failures up to maxAttempts', async () => {
    let calls = 0;
    const agent = new MockAgent(
      testManifest(),
      () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('transient');
        }
        return { ok: true, value: 'recovered' };
      },
      { config: { maxAttempts: 3 } },
    );
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('returns INTERNAL_ERROR when transient failures exhaust attempts', async () => {
    const agent = new MockAgent(
      testManifest(),
      () => {
        throw new Error('always down');
      },
      { config: { maxAttempts: 2 } },
    );
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INTERNAL_ERROR');
    }
  });

  it('does not retry typed failures', async () => {
    let calls = 0;
    const agent = new MockAgent(
      testManifest(),
      () => {
        calls += 1;
        return { ok: false as const, error: { code: 'BUSINESS_RULE_VIOLATION', message: 'nope' } };
      },
      { config: { maxAttempts: 5 } },
    );
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('merges injected config over the defaults', () => {
    const agent = new MockAgent(testManifest(), undefined, {
      config: { timeoutMs: 5000, memoryEnabled: false },
    });
    expect(agent.config.timeoutMs).toBe(5000);
    expect(agent.config.memoryEnabled).toBe(false);
    expect(agent.config.maxAttempts).toBe(1);
  });

  it('converts throwing policy evaluators into INTERNAL_ERROR failures', async () => {
    const agent = new MockAgent(testManifest(), () => ({ ok: true, value: 'never reached' }), {
      policies: {
        name: 'flaky',
        evaluate: async () => {
          throw new Error('policy engine down');
        },
      },
    });
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INTERNAL_ERROR');
    }
  });

  it('passes manifest policyIds into the policy evaluation', async () => {
    const seen: string[] = [];
    const agent = new MockAgent(
      testManifest({ policyIds: ['p-a', 'p-b'] }),
      () => ({ ok: true, value: 'ok' }),
      {
        policies: {
          name: 'recording',
          evaluate: async (context) => {
            seen.push(...context.requirements.map((requirement) => requirement.policyId));
            return { allowed: true, decisions: [] };
          },
        },
      },
    );
    agent.markReady();
    await agent.run('hi', fakeExecutionContext());
    expect(seen).toEqual(['p-a', 'p-b']);
  });

  it('does not retry a timed-out execution even with maxAttempts raised', async () => {
    let calls = 0;
    const agent = new MockAgent(
      testManifest(),
      async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { ok: true as const, value: 'late' };
      },
      { config: { timeoutMs: 50, maxAttempts: 3 } },
    );
    agent.markReady();
    const result = await agent.run('hi', fakeExecutionContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TIMEOUT');
    }
    expect(calls).toBe(1);
  });

  it('supports health checks', async () => {
    const agent = new MockAgent();
    agent.registerHealthCheck('memory', () => true);
    const snapshot = await agent.health();
    expect(snapshot.status).toBe('healthy');
    expect(snapshot.checks).toHaveLength(1);
  });

  it('reports degraded health when a check fails', async () => {
    const agent = new MockAgent();
    agent.registerHealthCheck('ok', () => true);
    agent.registerHealthCheck('bad', () => false);
    const snapshot = await agent.health();
    expect(snapshot.status).toBe('degraded');
  });

  it('treats throwing health checks as unhealthy', async () => {
    const agent = new MockAgent();
    agent.registerHealthCheck('throws', () => {
      throw new Error('down');
    });
    const snapshot = await agent.health();
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.checks[0]?.detail).toBe('down');
  });

  it('emits health.changed events on status transitions', async () => {
    const agent = new MockAgent();
    const types: string[] = [];
    agent.events.subscribe((event) => types.push(event.type));
    agent.registerHealthCheck('bad', () => false);
    await agent.health();
    expect(types).toContain('health.changed');
  });
});
