/**
 * S24 Phase 5 — governed MCP write adapter tests.
 *
 * Verifies that MCP-originated writes reuse the EXACT governed execution
 * path: the existing ToolExecutor gates the consequential tool, the
 * existing ApprovalEngine records the lifecycle (open → grant → claim →
 * outcome), execution verifies, and a replayed delivery can never execute
 * twice. There is no second execution path and no second approval engine.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemoryApprovalEngine } from '@nexora/ai-runtime';
import type { ToolExecutionResult, ToolExecutor } from '@nexora/ai-runtime/execution';
import type { NexoraMCPContext } from '@nexora/mcp';

import { GovernedWriteAdapter } from '../src/ai/mcp/governed-write-adapter.js';

const TRUSTED_CONTEXT: NexoraMCPContext = {
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_eng',
  capabilityIds: ['calendar.create_event'],
  correlationId: 'run_mcp_1',
};

/** A fake executor: gated writes block unless approvalGranted is true. */
function fakeExecutor(): { execute: ReturnType<typeof vi.fn> } & Pick<ToolExecutor, 'execute'> {
  return {
    execute: vi.fn(
      async (_invocation: unknown, approvalGranted: boolean): Promise<ToolExecutionResult> => {
        if (!approvalGranted) {
          return {
            ok: false,
            toolId: 'calendar.create_event',
            error: { code: 'APPROVAL_REQUIRED', message: 'Approval required' },
            attempts: 0,
            verified: false,
            blocked: true,
            completedAt: new Date().toISOString(),
          };
        }
        return {
          ok: true,
          toolId: 'calendar.create_event',
          output: { event: { id: 'evt_1', title: 'Payments Review' } },
          attempts: 1,
          verified: true,
          blocked: false,
          completedAt: new Date().toISOString(),
        };
      },
    ),
  } as unknown as { execute: ReturnType<typeof vi.fn> } & Pick<ToolExecutor, 'execute'>;
}

function buildAdapter() {
  const approvals = new InMemoryApprovalEngine();
  const executor = fakeExecutor();
  const adapter = new GovernedWriteAdapter({
    executor: executor as unknown as ToolExecutor,
    approvals,
    toolId: 'calendar.create_event',
    capabilityId: 'calendar.create_event',
    intent: 'Create a calendar event',
  });
  return { adapter, approvals, executor };
}

const ARGS = {
  title: 'Payments Review',
  startsAt: '2026-08-16T10:00:00Z',
  endsAt: '2026-08-16T11:00:00Z',
};

describe('GovernedWriteAdapter — approval lifecycle', () => {
  it('opens a recorded approval when the executor gates the write', async () => {
    const { adapter, approvals, executor } = buildAdapter();
    const result = await adapter.invoke(ARGS, TRUSTED_CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('APPROVAL_REQUIRED');
    expect(result.error?.details?.approvalId).toBeTypeOf('string');

    const approval = approvals.byId(result.error?.details?.approvalId as string);
    expect(approval).toBeDefined();
    expect(approval?.userId).toBe(TRUSTED_CONTEXT.userId);
    expect(approval?.tenantId).toBe(TRUSTED_CONTEXT.tenantId);
    expect(approval?.toolId).toBe('calendar.create_event');
    expect(approval?.status).toBe('awaiting_approval');
    // The write never reached the tool before the grant.
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.calls[0]?.[1]).toBe(false);
  });

  it('executes exactly once after a grant (single-flight claim)', async () => {
    const { adapter, approvals, executor } = buildAdapter();
    const first = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    const approvalId = first.error?.details?.approvalId as string;

    // Grant server-side (the parent decides through the existing engine).
    expect(
      approvals.decide(approvalId, { decision: 'grant', decidedBy: TRUSTED_CONTEXT.userId }).ok,
    ).toBe(true);

    // Resume with the SAME correlation id + arguments → executes once.
    const resumed = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    expect(resumed.ok).toBe(true);
    expect(resumed.output).toEqual({ event: { id: 'evt_1', title: 'Payments Review' } });
    expect(executor.execute.mock.calls.map((call) => call[1])).toEqual([false, true]);

    const approval = approvals.byId(approvalId);
    expect(approval?.status).toBe('completed');
    expect(approval?.result).toEqual(resumed.output);
  });

  it('a replayed delivery replays the stored result — never executes twice', async () => {
    const { adapter, approvals, executor } = buildAdapter();
    const first = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    const approvalId = first.error?.details?.approvalId as string;
    approvals.decide(approvalId, { decision: 'grant', decidedBy: TRUSTED_CONTEXT.userId });

    await adapter.invoke(ARGS, TRUSTED_CONTEXT); // executes
    const replayed = await adapter.invoke(ARGS, TRUSTED_CONTEXT); // must NOT execute again

    expect(replayed.ok).toBe(true);
    expect(replayed.output).toEqual({ event: { id: 'evt_1', title: 'Payments Review' } });
    // Exactly two calls total: the gated first attempt + ONE execution.
    expect(executor.execute).toHaveBeenCalledTimes(2);
    const grantedCalls = executor.execute.mock.calls.filter((call) => call[1] === true);
    expect(grantedCalls).toHaveLength(1);
  });

  it('a rejected approval denies execution with no mutation', async () => {
    const { adapter, approvals, executor } = buildAdapter();
    const first = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    const approvalId = first.error?.details?.approvalId as string;
    approvals.decide(approvalId, { decision: 'reject', decidedBy: TRUSTED_CONTEXT.userId });

    const denied = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe('APPROVAL_DENIED');
    // Only the initial gated attempt ran — no execution.
    const grantedCalls = executor.execute.mock.calls.filter((call) => call[1] === true);
    expect(grantedCalls).toHaveLength(0);
  });

  it('a distinct action with the same correlation opens a separate approval', async () => {
    const { adapter, approvals } = buildAdapter();
    const first = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    const second = await adapter.invoke({ ...ARGS, title: 'Sprint Review' }, TRUSTED_CONTEXT);
    expect(first.error?.details?.approvalId).not.toBe(second.error?.details?.approvalId);
    expect(approvals.listByConversation('mcp:run_mcp_1')).toHaveLength(2);
  });
});

describe('GovernedWriteAdapter — a terminal approval never blocks a new request', () => {
  const LATER_RUN: NexoraMCPContext = { ...TRUSTED_CONTEXT, correlationId: 'run_mcp_2' };

  /** A resume-by-key engine (the durable engine's contract) over the in-memory store. */
  function keyedEngine(clock?: () => Date) {
    return new InMemoryApprovalEngine(clock === undefined ? {} : { clock: { now: clock } });
  }
  function adapterOver(approvals: InMemoryApprovalEngine) {
    const executor = fakeExecutor();
    const adapter = new GovernedWriteAdapter({
      executor: executor as unknown as ToolExecutor,
      approvals,
      toolId: 'calendar.create_event',
      capabilityId: 'calendar.create_event',
      intent: 'Create a calendar event',
    });
    return { adapter, executor };
  }
  const grantedCalls = (executor: { execute: ReturnType<typeof vi.fn> }) =>
    executor.execute.mock.calls.filter((call) => call[1] === true);

  it('rejected: the run that was refused hears it; a LATER run re-requests with a NEW approval (attempt :2)', async () => {
    const approvals = keyedEngine();
    const { adapter, executor } = adapterOver(approvals);
    const first = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    const firstId = first.error?.details?.approvalId as string;
    approvals.decide(firstId, { decision: 'reject', decidedBy: 'usr_bob' });

    // Same run: the outcome is reported (control — the rejection is real).
    const sameRun = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    expect(sameRun.error?.code).toBe('APPROVAL_DENIED');
    expect(sameRun.error?.details?.approvalId).toBe(firstId);

    // A later run of the same action opens a fresh approval — never the rejected one.
    const later = await adapter.invoke(ARGS, LATER_RUN);
    expect(later.error?.code).toBe('APPROVAL_REQUIRED');
    const secondId = later.error?.details?.approvalId as string;
    expect(secondId).not.toBe(firstId);
    expect(approvals.byId(firstId)?.status).toBe('rejected');
    expect(approvals.byId(secondId)?.resumeKey).toMatch(/:2$/);
    expect(grantedCalls(executor)).toHaveLength(0);

    // The new attempt is a normal approval: grant it and it executes exactly once.
    approvals.decide(secondId, { decision: 'grant', decidedBy: 'usr_bob' });
    const executed = await adapter.invoke(ARGS, LATER_RUN);
    expect(executed.ok).toBe(true);
    expect(grantedCalls(executor)).toHaveLength(1);
    expect(approvals.byId(secondId)?.status).toBe('completed');
  });

  it('expired: the same run is told to request again; a later run gets a NEW approval', async () => {
    let now = Date.parse('2026-09-01T09:00:00.000Z');
    const approvals = keyedEngine(() => new Date(now));
    const { adapter } = adapterOver(approvals);
    const first = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    const firstId = first.error?.details?.approvalId as string;
    now += 25 * 60 * 60 * 1000;
    const sameRun = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    expect(sameRun.error?.code).toBe('APPROVAL_EXPIRED');
    const later = await adapter.invoke(ARGS, LATER_RUN);
    expect(later.error?.code).toBe('APPROVAL_REQUIRED');
    expect(later.error?.details?.approvalId).not.toBe(firstId);
    expect(approvals.byId(later.error?.details?.approvalId as string)?.status).toBe(
      'awaiting_approval',
    );
  });

  it('completed: a later run REPLAYS the stored result (never a second approval or execution)', async () => {
    const approvals = keyedEngine();
    const { adapter, executor } = adapterOver(approvals);
    const first = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    approvals.decide(first.error?.details?.approvalId as string, {
      decision: 'grant',
      decidedBy: 'usr_bob',
    });
    const executed = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    expect(executed.ok).toBe(true);
    const replayed = await adapter.invoke(ARGS, LATER_RUN);
    expect(replayed.ok).toBe(true);
    expect(replayed.output).toEqual(executed.output);
    expect(grantedCalls(executor)).toHaveLength(1);
    expect(approvals.listByConversation('mcp:run_mcp_2')).toHaveLength(0);
  });

  it('a live (awaiting) approval is reused by a later run — no duplicate gate', async () => {
    const approvals = keyedEngine();
    const { adapter } = adapterOver(approvals);
    const first = await adapter.invoke(ARGS, TRUSTED_CONTEXT);
    const again = await adapter.invoke(ARGS, LATER_RUN);
    expect(again.error?.code).toBe('APPROVAL_REQUIRED');
    expect(again.error?.details?.approvalId).toBe(first.error?.details?.approvalId);
  });
});
