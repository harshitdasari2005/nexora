/**
 * @nexora/ai-runtime — execution tests.
 */

import { describe, expect, it } from 'vitest';

import { ToolExecutor } from '../src/execution/tool-executor.js';
import { defaultRetryPolicy, noRetryPolicy } from '../src/execution/retry-policy.js';
import { FixedTimeoutPolicy } from '../src/execution/timeout-policy.js';
import { evaluateSideEffect, isMoreSevereThan } from '../src/execution/side-effect-guard.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { DefaultExecutionVerifier } from '../src/verification/execution-verifier.js';
import type { Tool, ToolExecutionContext, ToolResult } from '@nexora/agent-sdk/tools';
import { nowIso } from '@nexora/shared/time';

function makeTool(input: {
  id: string;
  sideEffectClass?: 'read_only' | 'state_change' | 'consequential';
  idempotent?: boolean;
  timeoutMs?: number;
  handler?: (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ) => ToolResult<unknown> | Promise<ToolResult<unknown>>;
  throwsOn?: (args: Record<string, unknown>) => boolean;
}): Tool {
  return {
    manifest: {
      id: input.id,
      name: input.id,
      description: `Tool ${input.id}`,
      sideEffectClass: input.sideEffectClass ?? 'read_only',
      idempotent: input.idempotent ?? false,
      timeoutMs: input.timeoutMs ?? 1000,
      inputSchema: {},
    },
    async execute(args, context) {
      if (input.throwsOn?.(args)) {
        throw new Error('boom');
      }
      return input.handler
        ? input.handler(args, context)
        : { ok: true, output: { done: true }, completedAt: nowIso() };
    },
  };
}

function registryWith(...tools: Tool[]): ExecutableToolRegistry {
  const registry = new ExecutableToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}

describe('ToolExecutor', () => {
  it('executes a read-only tool successfully', async () => {
    const executor = new ToolExecutor({ tools: registryWith(makeTool({ id: 't1' })) });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
  });

  it('returns NOT_FOUND for unknown tools', async () => {
    const executor = new ToolExecutor({ tools: registryWith(makeTool({ id: 't1' })) });
    const result = await executor.execute({
      toolId: 'nope',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('S34 RBAC: rejects a tool outside the caller effective capability ceiling', async () => {
    const executor = new ToolExecutor({
      tools: registryWith(makeTool({ id: 'calendar.create_event' })),
    });
    const result = await executor.execute({
      toolId: 'calendar.create_event',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
      // The caller's RBAC set has NOTHING to do with calendars (e.g. a
      // Developer role) — the tool is rejected before it ever runs.
      allowedCapabilityIds: ['problems.investigate', 'knowledge.search'],
    });
    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.error?.code).toBe('FORBIDDEN');
  });

  it('S34 RBAC: allows a tool inside the caller effective capability ceiling', async () => {
    const executor = new ToolExecutor({
      tools: registryWith(makeTool({ id: 'calendar.create_event' })),
    });
    const result = await executor.execute({
      toolId: 'calendar.create_event',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
      allowedCapabilityIds: ['calendar.create_event'],
    });
    expect(result.ok).toBe(true);
  });

  it('S34 RBAC: checks the bound capabilityId, not the raw toolId, when they differ', async () => {
    const executor = new ToolExecutor({
      tools: registryWith(makeTool({ id: 'tool_close_sprint' })),
    });
    const result = await executor.execute({
      toolId: 'tool_close_sprint',
      capabilityId: 'projects.close_sprint',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
      allowedCapabilityIds: ['projects.close_sprint'],
    });
    expect(result.ok).toBe(true);
  });

  it('S34 RBAC: an ABSENT ceiling is explicitly unrestricted; an EMPTY ceiling is no authority; a non-empty one lists the permitted capabilities', async () => {
    const executor = new ToolExecutor({ tools: registryWith(makeTool({ id: 't1' })) });
    const withoutCeiling = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(withoutCeiling.ok).toBe(true);
    const withEmptyCeiling = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
      allowedCapabilityIds: [],
    });
    expect(withEmptyCeiling.ok).toBe(false);
    expect(withEmptyCeiling.error?.code).toBe('FORBIDDEN');
    expect(withEmptyCeiling.attempts).toBe(0);
    const permitted = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
      allowedCapabilityIds: ['t1'],
    });
    expect(permitted.ok).toBe(true);
    const otherCapability = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
      allowedCapabilityIds: ['other'],
    });
    expect(otherCapability.error?.code).toBe('FORBIDDEN');
  });

  it('blocks consequential tools without approval', async () => {
    const executor = new ToolExecutor({
      tools: registryWith(makeTool({ id: 't1', sideEffectClass: 'consequential' })),
    });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
      autonomyTier: 'supervised',
    });
    expect(result.blocked).toBe(true);
    expect(result.error?.code).toBe('APPROVAL_REQUIRED');
  });

  it('executes consequential tools when approval is granted', async () => {
    const executor = new ToolExecutor({
      tools: registryWith(makeTool({ id: 't1', sideEffectClass: 'consequential' })),
    });
    const result = await executor.execute(
      {
        toolId: 't1',
        input: {},
        userId: 'usr_1',
        tenantId: 't',
        runId: 'r',
        autonomyTier: 'supervised',
      },
      true,
    );
    expect(result.ok).toBe(true);
  });

  it('reports tool failures with the error message', async () => {
    const executor = new ToolExecutor({
      tools: registryWith(
        makeTool({
          id: 't1',
          handler: () => ({ ok: false, error: 'nope', completedAt: nowIso() }),
        }),
      ),
    });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });

  it('does not retry non-idempotent tools on transient failure', async () => {
    const tool = makeTool({ id: 't1', throwsOn: () => true });
    const executor = new ToolExecutor({
      tools: registryWith(tool),
      retryPolicy: defaultRetryPolicy({ maxAttempts: 3 }),
    });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.attempts).toBe(1);
  });

  it('retries idempotent tools on transient failure up to maxAttempts', async () => {
    let calls = 0;
    const tool = makeTool({
      id: 't1',
      idempotent: true,
      throwsOn: () => calls++ < 2,
    });
    const executor = new ToolExecutor({
      tools: registryWith(tool),
      retryPolicy: defaultRetryPolicy({ maxAttempts: 3, backoffMs: 1 }),
    });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('exhausts retries for idempotent tools that keep failing', async () => {
    const tool = makeTool({ id: 't1', idempotent: true, throwsOn: () => true });
    const executor = new ToolExecutor({
      tools: registryWith(tool),
      retryPolicy: defaultRetryPolicy({ maxAttempts: 3, backoffMs: 1 }),
    });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it('applies the timeout policy and reports TIMEOUT', async () => {
    const slow = makeTool({
      id: 't1',
      timeoutMs: 5000,
      handler: () =>
        new Promise<ToolResult<unknown>>((resolve) =>
          setTimeout(() => resolve({ ok: true, output: {}, completedAt: nowIso() }), 50),
        ),
    });
    const executor = new ToolExecutor({
      tools: registryWith(slow),
      timeoutPolicy: new FixedTimeoutPolicy(5),
    });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
  });

  it('forwards the trusted userId from the invocation into the tool context', async () => {
    // The authenticated identity must reach tools through the execution
    // context (trusted server-side channel) — never via tool arguments.
    const received: string[] = [];
    const capturing = makeTool({
      id: 't1',
      handler: async (_args, context) => {
        received.push(context.userId);
        return { ok: true, output: {}, completedAt: nowIso() };
      },
    });
    const executor = new ToolExecutor({ tools: registryWith(capturing) });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_trusted',
      tenantId: 'tenant_1',
      runId: 'r',
    });
    expect(result.ok).toBe(true);
    expect(received).toEqual(['usr_trusted']);
  });

  it('rejects model-supplied identity/tenant arguments instead of passing them through', async () => {
    const received: string[] = [];
    const capturing = makeTool({
      id: 't1',
      handler: async (_args, context) => {
        received.push(context.userId);
        return { ok: true, output: {}, completedAt: nowIso() };
      },
    });
    const executor = new ToolExecutor({ tools: registryWith(capturing) });
    const result = await executor.execute({
      toolId: 't1',
      input: { userId: 'usr_evil', tenantId: 'org_evil' },
      userId: 'usr_trusted',
      tenantId: 'tenant_1',
      runId: 'r',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('RESERVED_ARGUMENT');
    expect(received).toEqual([]); // the tool never ran
  });

  it('honors a custom verifier that rejects output', async () => {
    const executor = new ToolExecutor({
      tools: registryWith(makeTool({ id: 't1' })),
      verifier: new DefaultExecutionVerifier([
        {
          id: 'must-have-id',
          description: 'id',
          check: (r) => (r.output as { id?: number }).id !== undefined,
        },
      ]),
    });
    const result = await executor.execute({
      toolId: 't1',
      input: {},
      userId: 'usr_1',
      tenantId: 't',
      runId: 'r',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNVERIFIED');
  });
});

describe('evaluateSideEffect', () => {
  it('never gates read-only actions', () => {
    expect(evaluateSideEffect('read_only', 'human_only').requiresApproval).toBe(false);
  });

  it('always gates consequential actions', () => {
    expect(evaluateSideEffect('consequential', 'autonomous').requiresApproval).toBe(true);
  });

  it('gates state changes except under the autonomous tier', () => {
    expect(evaluateSideEffect('state_change', 'supervised').requiresApproval).toBe(true);
    expect(evaluateSideEffect('state_change', 'autonomous').requiresApproval).toBe(false);
  });
});

describe('isMoreSevereThan', () => {
  it('orders side-effect classes by severity', () => {
    expect(isMoreSevereThan('consequential', 'read_only')).toBe(true);
    expect(isMoreSevereThan('read_only', 'consequential')).toBe(false);
    expect(isMoreSevereThan('state_change', 'read_only')).toBe(true);
    expect(isMoreSevereThan('consequential', 'state_change')).toBe(true);
  });
});

describe('retry policies', () => {
  it('noRetryPolicy never retries', () => {
    expect(noRetryPolicy.maxAttempts).toBe(1);
    expect(noRetryPolicy.isRetryable({ code: 'UNAVAILABLE', message: 'x' })).toBe(false);
  });

  it('default retry policy retries transient codes', () => {
    const policy = defaultRetryPolicy();
    expect(policy.isRetryable({ code: 'UNAVAILABLE', message: 'x' })).toBe(true);
    expect(policy.isRetryable({ code: 'TIMEOUT', message: 'x' })).toBe(true);
    // Thrown tool failures normalize to INTERNAL_ERROR and retry (idempotent only).
    expect(policy.isRetryable({ code: 'INTERNAL_ERROR', message: 'x' })).toBe(true);
    // Intentional, typed failures never retry.
    expect(policy.isRetryable({ code: 'NOT_FOUND', message: 'x' })).toBe(false);
    expect(policy.isRetryable({ code: 'VALIDATION_ERROR', message: 'x' })).toBe(false);
  });

  it('default retry policy supports extra codes and grows backoff', () => {
    const policy = defaultRetryPolicy({ extraRetryableCodes: ['CUSTOM'], backoffMs: 10 });
    expect(policy.isRetryable({ code: 'CUSTOM', message: 'x' })).toBe(true);
    expect(policy.delayForAttempt(2)).toBeGreaterThan(policy.delayForAttempt(1));
  });
});

describe('ToolExecutor — tool-vetted failure detail', () => {
  it('carries a failed tool result’s detail through, beside the (hidden) error', async () => {
    const tools = new ExecutableToolRegistry();
    tools.register({
      manifest: {
        id: 'demo.fails_with_detail',
        name: 'Fails',
        description: 'fails with a vetted detail',
        sideEffectClass: 'read_only',
        idempotent: true,
        timeoutMs: 1000,
        inputSchema: {},
      },
      execute: async () => ({
        ok: false,
        error: 'raw internal message',
        detail: 'Rolled back: Hire employee.',
        completedAt: new Date().toISOString(),
      }),
    });
    const result = await new ToolExecutor({ tools }).execute({
      toolId: 'demo.fails_with_detail',
      input: {},
      userId: 'u1',
      tenantId: 't1',
      runId: 'r1',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('raw internal message');
    expect(result.detail).toBe('Rolled back: Hire employee.');
  });
});
