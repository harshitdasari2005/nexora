/**
 * @nexora/ai-runtime — approval engine tests.
 *
 * The minimal approval lifecycle (Proposed → AwaitingApproval →
 * Approved/Rejected → Executing → Completed/Failed) and its security
 * contract: decisions are server-side state decided exactly once; `claim`
 * is the single-flight guard that makes duplicate delivery of an approved
 * execution safe (AIR.md §12).
 */

import { describe, expect, it } from 'vitest';

import { InMemoryApprovalEngine, type OpenApprovalInput } from '../src/approval/engine.js';

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
  reason: 'consequential action under supervised tier requires approval',
  intent: 'create a workspace called Engineering',
  input: { name: 'Engineering' },
};

describe('InMemoryApprovalEngine', () => {
  it('opens a request as awaiting_approval with the trusted fields', () => {
    const engine = new InMemoryApprovalEngine();
    const request = engine.open(baseInput);

    expect(request.id).toMatch(/^apr_/);
    expect(request.status).toBe('awaiting_approval');
    expect(request.conversationId).toBe('conv_1');
    expect(request.userId).toBe('usr_alice');
    expect(request.tenantId).toBe('org_acme');
    expect(request.workspaceId).toBe('wsp_1');
    expect(request.input).toEqual({ name: 'Engineering' });
    expect(engine.decisionStatus(request.id)).toBe('pending');
  });

  it('records a grant decision and moves the request to approved', () => {
    const engine = new InMemoryApprovalEngine();
    const request = engine.open(baseInput);
    const result = engine.decide(request.id, {
      decision: 'grant',
      decidedBy: 'usr_alice',
      reason: 'looks good',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe('approved');
    expect(result.request.decision).toBe('grant');
    expect(result.request.decidedBy).toBe('usr_alice');
    expect(result.request.decisionReason).toBe('looks good');
    expect(engine.decisionStatus(request.id)).toBe('granted');
  });

  it('records a rejection and never reaches approved', () => {
    const engine = new InMemoryApprovalEngine();
    const request = engine.open(baseInput);
    const result = engine.decide(request.id, {
      decision: 'reject',
      decidedBy: 'usr_alice',
    });

    expect(result.ok).toBe(true);
    expect(engine.decisionStatus(request.id)).toBe('rejected');
    expect(engine.byId(request.id)?.status).toBe('rejected');
  });

  it('decides a request exactly once', () => {
    const engine = new InMemoryApprovalEngine();
    const request = engine.open(baseInput);
    const first = engine.decide(request.id, { decision: 'grant', decidedBy: 'usr_alice' });
    expect(first.ok).toBe(true);

    // A second decision (double approve, or approve-after-reject) is refused.
    const second = engine.decide(request.id, { decision: 'reject', decidedBy: 'usr_alice' });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('already_decided');
    }
    expect(engine.byId(request.id)?.status).toBe('approved');
  });

  it('refuses a decision for an unknown request', () => {
    const engine = new InMemoryApprovalEngine();
    const result = engine.decide('apr_unknown', { decision: 'grant', decidedBy: 'usr_alice' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_found');
    }
  });

  it('claims an approved request exactly once (single flight)', () => {
    const engine = new InMemoryApprovalEngine();
    const request = engine.open(baseInput);
    engine.decide(request.id, { decision: 'grant', decidedBy: 'usr_alice' });

    expect(engine.claim(request.id)).toBe(true);
    expect(engine.byId(request.id)?.status).toBe('executing');
    // Duplicate delivery of the same approved execution cannot claim again.
    expect(engine.claim(request.id)).toBe(false);
  });

  it('never claims a pending, rejected, completed, or failed request', () => {
    const engine = new InMemoryApprovalEngine();

    const pending = engine.open(baseInput);
    expect(engine.claim(pending.id)).toBe(false);

    const rejected = engine.open({ ...baseInput, intent: 'create a workspace called Rejected' });
    engine.decide(rejected.id, { decision: 'reject', decidedBy: 'usr_alice' });
    expect(engine.claim(rejected.id)).toBe(false);

    const approved = engine.open({ ...baseInput, intent: 'create a workspace called Done' });
    engine.decide(approved.id, { decision: 'grant', decidedBy: 'usr_alice' });
    engine.claim(approved.id);
    engine.recordOutcome(approved.id, { status: 'completed', result: { id: 'wsp_9' } });
    // Completed requests are terminal: never claimable, never re-runnable.
    expect(engine.claim(approved.id)).toBe(false);

    // A FAILED execution is also terminal: the approval covers one attempt;
    // a re-delivery reports granted (so the runtime replays/skips instead of
    // re-executing) but can never claim or re-run.
    const failed = engine.open({ ...baseInput, intent: 'create a workspace called Fail' });
    engine.decide(failed.id, { decision: 'grant', decidedBy: 'usr_alice' });
    engine.claim(failed.id);
    engine.recordOutcome(failed.id, { status: 'failed', error: 'boom' });
    expect(engine.claim(failed.id)).toBe(false);
    // decisionStatus stays 'granted' for failed: the decision WAS granted.
    expect(engine.decisionStatus(failed.id)).toBe('granted');
  });

  it('records completion and failure outcomes', () => {
    const engine = new InMemoryApprovalEngine();

    const completed = engine.open(baseInput);
    engine.decide(completed.id, { decision: 'grant', decidedBy: 'usr_alice' });
    engine.claim(completed.id);
    engine.recordOutcome(completed.id, { status: 'completed', result: { id: 'wsp_1' } });
    expect(engine.byId(completed.id)).toMatchObject({
      status: 'completed',
      result: { id: 'wsp_1' },
    });

    const failed = engine.open({ ...baseInput, intent: 'create a workspace called Fail' });
    engine.decide(failed.id, { decision: 'grant', decidedBy: 'usr_alice' });
    engine.claim(failed.id);
    engine.recordOutcome(failed.id, { status: 'failed', error: 'boom' });
    expect(engine.byId(failed.id)).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('replays the stored result when a completed approval is re-delivered', () => {
    const engine = new InMemoryApprovalEngine();
    const request = engine.open(baseInput);
    engine.decide(request.id, { decision: 'grant', decidedBy: 'usr_alice' });
    engine.claim(request.id);
    engine.recordOutcome(request.id, { status: 'completed', result: { id: 'wsp_replayed' } });

    // A duplicate delivery sees the completed state (claim refuses, but the
    // caller can read the authoritative result instead of re-executing).
    expect(engine.claim(request.id)).toBe(false);
    expect(engine.byId(request.id)?.status).toBe('completed');
    expect(engine.byId(request.id)?.result).toEqual({ id: 'wsp_replayed' });
  });

  it('lists the requests of a conversation (audit trail)', () => {
    const engine = new InMemoryApprovalEngine();
    engine.open(baseInput);
    engine.open({ ...baseInput, intent: 'create a workspace called Second' });
    engine.open({
      ...baseInput,
      conversationId: 'conv_other',
      intent: 'create a workspace called Other',
    });

    expect(engine.listByConversation('conv_1')).toHaveLength(2);
    expect(engine.listByConversation('conv_other')).toHaveLength(1);
  });

  it('byId returns undefined for an unknown request', () => {
    const engine = new InMemoryApprovalEngine();
    expect(engine.byId('apr_nope')).toBeUndefined();
    expect(engine.decisionStatus('apr_nope')).toBeUndefined();
  });

  it('keeps the requested input and trusted identity immutable across decisions', () => {
    const engine = new InMemoryApprovalEngine();
    const request = engine.open(baseInput);
    engine.decide(request.id, { decision: 'grant', decidedBy: 'usr_alice' });
    const decided = engine.byId(request.id);

    // The decision never mutates who requested or what was requested — a
    // caller cannot rewrite identity or scope after the fact.
    expect(decided?.userId).toBe('usr_alice');
    expect(decided?.tenantId).toBe('org_acme');
    expect(decided?.workspaceId).toBe('wsp_1');
    expect(decided?.input).toEqual({ name: 'Engineering' });
    expect(decided?.intent).toBe('create a workspace called Engineering');
  });
});
