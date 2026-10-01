/**
 * @nexora/ai-runtime — approval state machine tests (Prompt 9, G3).
 *
 * The transition table is the single source of truth for the in-memory
 * engine and for the durable engine's `WHERE status IN (...)` guards: every
 * illegal transition is rejected, terminal states never move, and an
 * executed/verified approval is never silently mutated.
 */

import { describe, expect, it } from 'vitest';

import {
  APPROVAL_TRANSITIONS,
  EXECUTION_LIFECYCLE,
  InMemoryApprovalEngine,
  InvalidApprovalTransitionError,
  assertTransition,
  canTransition,
  sourcesOf,
  type ApprovalClock,
  type ApprovalLifecycle,
  type OpenApprovalInput,
} from '../src/approval/engine.js';

const ALL: readonly ApprovalLifecycle[] = [
  'proposed',
  'awaiting_approval',
  'approved',
  'rejected',
  'executing',
  'completed',
  'failed',
  'expired',
];

const LEGAL: readonly (readonly [ApprovalLifecycle, ApprovalLifecycle])[] = [
  ['proposed', 'awaiting_approval'],
  ['proposed', 'rejected'],
  ['proposed', 'expired'],
  ['awaiting_approval', 'approved'],
  ['awaiting_approval', 'rejected'],
  ['awaiting_approval', 'expired'],
  ['approved', 'executing'],
  ['approved', 'expired'],
  ['executing', 'completed'],
  ['executing', 'failed'],
];

const TERMINAL: readonly ApprovalLifecycle[] = ['rejected', 'expired', 'completed', 'failed'];

const baseInput: OpenApprovalInput = {
  conversationId: 'conv_1',
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_1',
  runId: 'run_1',
  stepId: 'step_1',
  toolId: 'workspaces.create_workspace',
  capabilityId: 'workspaces.create_workspace',
  sideEffectClass: 'consequential',
  reason: 'requires approval',
  intent: 'create a workspace',
  input: { name: 'Engineering' },
};

function clock(start = '2026-09-30T00:00:00.000Z'): ApprovalClock & { advance(ms: number): void } {
  let now = Date.parse(start);
  return { now: () => new Date(now), advance: (ms) => (now += ms) };
}

describe('APPROVAL_TRANSITIONS', () => {
  it('lists exactly the documented legal transitions', () => {
    const actual = ALL.flatMap((from) => APPROVAL_TRANSITIONS[from].map((to) => [from, to]));
    expect(actual).toEqual(LEGAL);
  });

  it('accepts every legal edge and rejects every other of the 8x8 pairs', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(legal);
        if (legal) {
          expect(() => assertTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertTransition(from, to)).toThrow(InvalidApprovalTransitionError);
        }
      }
    }
  });

  it('terminal states have no outgoing transition (never reopened or re-executed)', () => {
    for (const terminal of TERMINAL) {
      expect(APPROVAL_TRANSITIONS[terminal]).toEqual([]);
      for (const to of ALL) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it('EXPIRED / REJECTED / COMPLETED / FAILED can never reach EXECUTING', () => {
    for (const from of ['expired', 'rejected', 'completed', 'failed'] as const) {
      expect(canTransition(from, 'executing')).toBe(false);
    }
  });

  it('executing can never move back to approved (or any pre-execution state)', () => {
    for (const to of [
      'approved',
      'awaiting_approval',
      'proposed',
      'rejected',
      'expired',
    ] as const) {
      expect(canTransition('executing', to)).toBe(false);
    }
  });

  it('EXECUTING is reachable only from approved (no execution without approval)', () => {
    expect(sourcesOf('executing')).toEqual(['approved']);
    expect(canTransition('awaiting_approval', 'executing')).toBe(false);
    expect(canTransition('proposed', 'executing')).toBe(false);
  });

  it('derives the durable guards: sourcesOf(to)', () => {
    expect(sourcesOf('approved')).toEqual(['awaiting_approval']);
    expect(sourcesOf('rejected')).toEqual(['proposed', 'awaiting_approval']);
    expect(sourcesOf('expired')).toEqual(['proposed', 'awaiting_approval', 'approved']);
    expect(sourcesOf('completed')).toEqual(['executing']);
    expect(sourcesOf('failed')).toEqual(['executing']);
    expect(sourcesOf('awaiting_approval')).toEqual(['proposed']);
    expect(sourcesOf('proposed')).toEqual([]);
  });

  it('the error carries the offending edge', () => {
    try {
      assertTransition('completed', 'executing');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidApprovalTransitionError);
      expect((error as InvalidApprovalTransitionError).from).toBe('completed');
      expect((error as InvalidApprovalTransitionError).to).toBe('executing');
    }
  });

  it('the table is frozen', () => {
    expect(Object.isFrozen(APPROVAL_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(APPROVAL_TRANSITIONS.approved)).toBe(true);
  });
});

describe('EXECUTION_LIFECYCLE mapping', () => {
  it('maps every phase onto EXISTING approval statuses only', () => {
    for (const phase of Object.values(EXECUTION_LIFECYCLE)) {
      if (phase.approval !== undefined) {
        expect(ALL).toContain(phase.approval);
      }
    }
  });

  it('POLICY_DENIED never has an approval; APPROVAL_PENDING is awaiting_approval; VERIFIED is completed', () => {
    expect(EXECUTION_LIFECYCLE.POLICY_DENIED.approval).toBeUndefined();
    expect(EXECUTION_LIFECYCLE.POLICY_DENIED.errorCode).toBe('POLICY_DENIED');
    expect(EXECUTION_LIFECYCLE.APPROVAL_PENDING.approval).toBe('awaiting_approval');
    expect(EXECUTION_LIFECYCLE.APPROVED.approval).toBe('approved');
    expect(EXECUTION_LIFECYCLE.EXECUTING.approval).toBe('executing');
    expect(EXECUTION_LIFECYCLE.VERIFIED.approval).toBe('completed');
    expect(EXECUTION_LIFECYCLE.FAILED.approval).toBe('failed');
    expect(EXECUTION_LIFECYCLE.EXPIRED.errorCode).toBe('APPROVAL_EXPIRED');
  });

  it('a policy-denied phase has no path into an approval', () => {
    // The denied phase maps to NO approval status, so nothing can be opened
    // or transitioned for it: it is terminal by construction.
    expect(EXECUTION_LIFECYCLE.POLICY_DENIED.approval).toBeUndefined();
  });

  it('the approval statuses used by the phases follow the table order', () => {
    const chain: ApprovalLifecycle[] = ['awaiting_approval', 'approved', 'executing', 'completed'];
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(canTransition(chain[i] as ApprovalLifecycle, chain[i + 1] as ApprovalLifecycle)).toBe(
        true,
      );
    }
  });
});

describe('InMemoryApprovalEngine enforces the state machine', () => {
  const open = (engine: InMemoryApprovalEngine): string => engine.open(baseInput).id;

  it('recordOutcome before claim (awaiting_approval) is ignored', () => {
    const engine = new InMemoryApprovalEngine();
    const id = open(engine);
    engine.recordOutcome(id, { status: 'completed', result: { forged: true } });
    expect(engine.byId(id)?.status).toBe('awaiting_approval');
    expect(engine.byId(id)?.result).toBeUndefined();
  });

  it('recordOutcome on an approved-but-unclaimed approval is ignored (no execution without claim)', () => {
    const engine = new InMemoryApprovalEngine();
    const id = open(engine);
    engine.decide(id, { decision: 'grant', decidedBy: 'usr_bob' });
    engine.recordOutcome(id, { status: 'completed', result: { forged: true } });
    expect(engine.byId(id)?.status).toBe('approved');
    expect(engine.byId(id)?.result).toBeUndefined();
    expect(engine.claim(id)).toBe(true);
  });

  it('recordOutcome on a rejected approval is ignored', () => {
    const engine = new InMemoryApprovalEngine();
    const id = open(engine);
    engine.decide(id, { decision: 'reject', decidedBy: 'usr_bob' });
    engine.recordOutcome(id, { status: 'completed' });
    engine.recordOutcome(id, { status: 'failed', error: 'x' });
    expect(engine.byId(id)?.status).toBe('rejected');
  });

  it('a completed approval is never silently mutated (result and status stay)', () => {
    const engine = new InMemoryApprovalEngine();
    const id = open(engine);
    engine.decide(id, { decision: 'grant', decidedBy: 'usr_bob' });
    expect(engine.claim(id)).toBe(true);
    engine.recordOutcome(id, { status: 'completed', result: { ok: 1 } });
    // A stale/duplicate outcome cannot rewrite history.
    engine.recordOutcome(id, { status: 'failed', error: 'late' });
    engine.recordOutcome(id, { status: 'completed', result: { ok: 2 } });
    const record = engine.byId(id);
    expect(record?.status).toBe('completed');
    expect(record?.result).toEqual({ ok: 1 });
    expect(record?.error).toBeUndefined();
  });

  it('a failed approval is never flipped to completed', () => {
    const engine = new InMemoryApprovalEngine();
    const id = open(engine);
    engine.decide(id, { decision: 'grant', decidedBy: 'usr_bob' });
    engine.claim(id);
    engine.recordOutcome(id, { status: 'failed', error: 'boom' });
    engine.recordOutcome(id, { status: 'completed', result: {} });
    expect(engine.byId(id)?.status).toBe('failed');
    expect(engine.byId(id)?.error).toBe('boom');
  });

  it('claim is possible only from approved: never from awaiting/rejected/expired/executing/completed/failed', () => {
    const c = clock();
    const engine = new InMemoryApprovalEngine({ clock: c });

    const awaiting = open(engine);
    expect(engine.claim(awaiting)).toBe(false);

    const rejected = open(engine);
    engine.decide(rejected, { decision: 'reject', decidedBy: 'usr_bob' });
    expect(engine.claim(rejected)).toBe(false);

    const executing = open(engine);
    engine.decide(executing, { decision: 'grant', decidedBy: 'usr_bob' });
    expect(engine.claim(executing)).toBe(true);
    expect(engine.claim(executing)).toBe(false);

    const completed = open(engine);
    engine.decide(completed, { decision: 'grant', decidedBy: 'usr_bob' });
    engine.claim(completed);
    engine.recordOutcome(completed, { status: 'completed' });
    expect(engine.claim(completed)).toBe(false);

    const failed = open(engine);
    engine.decide(failed, { decision: 'grant', decidedBy: 'usr_bob' });
    engine.claim(failed);
    engine.recordOutcome(failed, { status: 'failed', error: 'x' });
    expect(engine.claim(failed)).toBe(false);

    const expired = engine.open({ ...baseInput, ttlMs: 1000 });
    engine.decide(expired.id, { decision: 'grant', decidedBy: 'usr_bob' });
    c.advance(2000);
    expect(engine.claim(expired.id)).toBe(false);
  });

  it('decide only from awaiting_approval/proposed: a second decision, or any decision after execution, is refused', () => {
    const engine = new InMemoryApprovalEngine();
    const id = open(engine);
    expect(engine.decide(id, { decision: 'grant', decidedBy: 'usr_bob' }).ok).toBe(true);
    expect(engine.decide(id, { decision: 'reject', decidedBy: 'usr_bob' })).toEqual({
      ok: false,
      reason: 'already_decided',
    });
    engine.claim(id);
    expect(engine.decide(id, { decision: 'grant', decidedBy: 'usr_bob' })).toEqual({
      ok: false,
      reason: 'already_decided',
    });
    engine.recordOutcome(id, { status: 'completed', result: {} });
    expect(engine.decide(id, { decision: 'reject', decidedBy: 'usr_carol' })).toEqual({
      ok: false,
      reason: 'already_decided',
    });
    expect(engine.byId(id)?.status).toBe('completed');
    expect(engine.byId(id)?.decidedBy).toBe('usr_bob');
  });

  it('a rejected approval can never be granted afterwards', () => {
    const engine = new InMemoryApprovalEngine();
    const id = open(engine);
    engine.decide(id, { decision: 'reject', decidedBy: 'usr_bob' });
    expect(engine.decide(id, { decision: 'grant', decidedBy: 'usr_carol' })).toEqual({
      ok: false,
      reason: 'already_decided',
    });
    expect(engine.claim(id)).toBe(false);
    expect(engine.byId(id)?.status).toBe('rejected');
  });

  it('expire never touches executing / completed / failed / rejected records', () => {
    const c = clock();
    const engine = new InMemoryApprovalEngine({ clock: c });
    const ids = {
      executing: engine.open({ ...baseInput, ttlMs: 1000 }).id,
      completed: engine.open({ ...baseInput, ttlMs: 1000 }).id,
      failed: engine.open({ ...baseInput, ttlMs: 1000 }).id,
      rejected: engine.open({ ...baseInput, ttlMs: 1000 }).id,
    };
    for (const id of [ids.executing, ids.completed, ids.failed]) {
      engine.decide(id, { decision: 'grant', decidedBy: 'usr_bob' });
      engine.claim(id);
    }
    engine.recordOutcome(ids.completed, { status: 'completed' });
    engine.recordOutcome(ids.failed, { status: 'failed', error: 'x' });
    engine.decide(ids.rejected, { decision: 'reject', decidedBy: 'usr_bob' });
    c.advance(5000);
    expect(engine.expireDue()).toEqual([]);
    for (const [status, id] of Object.entries(ids)) {
      expect(engine.byId(id)?.status).toBe(status);
      expect(engine.expire(id).transitioned).toBe(false);
    }
  });

  it('an expired approval is terminal: it can be neither granted nor claimed nor completed', () => {
    const c = clock();
    const engine = new InMemoryApprovalEngine({ clock: c });
    const id = engine.open({ ...baseInput, ttlMs: 1000 }).id;
    c.advance(2000);
    expect(engine.expire(id).transitioned).toBe(true);
    expect(engine.decide(id, { decision: 'grant', decidedBy: 'usr_bob' }).ok).toBe(false);
    expect(engine.claim(id)).toBe(false);
    engine.recordOutcome(id, { status: 'completed' });
    expect(engine.byId(id)?.status).toBe('expired');
  });

  it('the full happy path walks exactly the legal chain', () => {
    const engine = new InMemoryApprovalEngine();
    const id = open(engine);
    const seen: ApprovalLifecycle[] = [engine.byId(id)?.status as ApprovalLifecycle];
    engine.decide(id, { decision: 'grant', decidedBy: 'usr_bob' });
    seen.push(engine.byId(id)?.status as ApprovalLifecycle);
    engine.claim(id);
    seen.push(engine.byId(id)?.status as ApprovalLifecycle);
    engine.recordOutcome(id, { status: 'completed', result: {} });
    seen.push(engine.byId(id)?.status as ApprovalLifecycle);
    expect(seen).toEqual(['awaiting_approval', 'approved', 'executing', 'completed']);
    for (let i = 0; i < seen.length - 1; i += 1) {
      assertTransition(seen[i] as ApprovalLifecycle, seen[i + 1] as ApprovalLifecycle);
    }
  });
});
