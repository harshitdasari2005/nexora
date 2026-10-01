/**
 * @nexora/ai-runtime — `executing` recovery (lease reaper) tests.
 *
 * A process that dies between `claim` and `recordOutcome` leaves an approval
 * `executing`. Recovery transitions ONLY executing → failed
 * (RECOVERY_REQUIRED), never re-executes, is idempotent, and never touches any
 * other state.
 */

import { describe, expect, it } from 'vitest';

import {
  APPROVAL_RECOVERY_REQUIRED_ERROR,
  EXECUTING_LEASE_MS,
  InMemoryApprovalEngine,
  isRecoveryRequired,
  type OpenApprovalInput,
} from '../src/approval/engine.js';

const input: OpenApprovalInput = {
  conversationId: 'conv_1',
  userId: 'usr_alice',
  tenantId: 'org_acme',
  runId: 'run_1',
  stepId: 'step_1',
  toolId: 'finance.submit_expense',
  capabilityId: 'finance.submit_expense',
  sideEffectClass: 'consequential',
  reason: 'requires approval',
  intent: 'submit an expense',
  input: { amount: 10 },
};

function harness(options: { ttlMs?: number } = {}) {
  let now = new Date('2026-09-01T09:00:00.000Z');
  const engine = new InMemoryApprovalEngine({ clock: { now: () => now } });
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  const executing = () => {
    const request = engine.open({ ...input, ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}) });
    engine.decide(request.id, { decision: 'grant', decidedBy: 'usr_bob' });
    expect(engine.claim(request.id)).toBe(true);
    return request;
  };
  return { engine, advance, executing };
}

describe('InMemoryApprovalEngine.recoverStale', () => {
  it('does nothing before the lease elapses', () => {
    const h = harness();
    const request = h.executing();
    h.advance(EXECUTING_LEASE_MS - 1);
    expect(h.engine.recoverStale()).toEqual([]);
    expect(h.engine.byId(request.id)?.status).toBe('executing');
  });

  it('process failure: claim with no recordOutcome is failed RECOVERY_REQUIRED after the lease', () => {
    const h = harness();
    const request = h.executing();
    h.advance(EXECUTING_LEASE_MS);
    const recovered = h.engine.recoverStale();
    expect(recovered.map((r) => r.id)).toEqual([request.id]);
    const after = h.engine.byId(request.id);
    expect(after).toMatchObject({ status: 'failed', error: APPROVAL_RECOVERY_REQUIRED_ERROR });
    expect(after?.result).toBeUndefined();
    expect(isRecoveryRequired(after!)).toBe(true);
    // never re-claimable: recovery does not re-open execution
    expect(h.engine.claim(request.id)).toBe(false);
  });

  it('is idempotent: a second recovery returns nothing', () => {
    const h = harness();
    h.executing();
    h.advance(EXECUTING_LEASE_MS + 1);
    expect(h.engine.recoverStale()).toHaveLength(1);
    expect(h.engine.recoverStale()).toHaveLength(0);
  });

  it('a late outcome from the abandoned process is ignored (terminal)', () => {
    const h = harness();
    const request = h.executing();
    h.advance(EXECUTING_LEASE_MS + 1);
    h.engine.recoverStale();
    h.engine.recordOutcome(request.id, { status: 'completed', result: { late: true } });
    expect(h.engine.byId(request.id)).toMatchObject({
      status: 'failed',
      error: APPROVAL_RECOVERY_REQUIRED_ERROR,
    });
  });

  it('never touches completed, failed, rejected, expired, approved or awaiting approvals', () => {
    const h = harness();
    const completed = h.executing();
    h.engine.recordOutcome(completed.id, { status: 'completed', result: { ok: true } });
    const failed = h.executing();
    h.engine.recordOutcome(failed.id, { status: 'failed', error: 'boom' });
    const rejected = h.engine.open(input);
    h.engine.decide(rejected.id, { decision: 'reject', decidedBy: 'usr_bob' });
    const approved = h.engine.open(input);
    h.engine.decide(approved.id, { decision: 'grant', decidedBy: 'usr_bob' });
    const awaiting = h.engine.open(input);
    h.advance(EXECUTING_LEASE_MS * 2);
    expect(h.engine.recoverStale()).toEqual([]);
    expect(h.engine.byId(completed.id)?.status).toBe('completed');
    expect(h.engine.byId(failed.id)).toMatchObject({ status: 'failed', error: 'boom' });
    expect(h.engine.byId(rejected.id)?.status).toBe('rejected');
    expect(h.engine.byId(approved.id)?.status).toBe('approved');
    expect(h.engine.byId(awaiting.id)?.status).toBe('awaiting_approval');
  });

  it('an expired approval is not recovered (expired is not executing)', () => {
    const h = harness();
    const request = h.engine.open({ ...input, ttlMs: 60_000 });
    h.advance(120_000);
    expect(h.engine.expireDue()).toHaveLength(1);
    h.advance(EXECUTING_LEASE_MS * 2);
    expect(h.engine.recoverStale()).toEqual([]);
    expect(h.engine.byId(request.id)?.status).toBe('expired');
  });

  it('an executing approval past its expiry recovers as failed, not expired', () => {
    const h = harness({ ttlMs: 60_000 });
    const request = h.executing();
    h.advance(EXECUTING_LEASE_MS + 60_000);
    expect(h.engine.expireDue()).toEqual([]);
    expect(h.engine.recoverStale()).toHaveLength(1);
    expect(h.engine.byId(request.id)?.status).toBe('failed');
  });

  it('honors an injected lease', () => {
    let now = new Date('2026-09-01T09:00:00.000Z');
    const engine = new InMemoryApprovalEngine({
      clock: { now: () => now },
      executingLeaseMs: 1000,
    });
    const request = engine.open(input);
    engine.decide(request.id, { decision: 'grant', decidedBy: 'usr_bob' });
    engine.claim(request.id);
    now = new Date(now.getTime() + 1000);
    expect(engine.recoverStale()).toHaveLength(1);
  });
});
