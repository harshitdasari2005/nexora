/**
 * @nexora/app-api — PostgreSQL approval engine (S24 Phase 6).
 *
 * The DURABLE implementation of the AI Runtime `ApprovalEngine` port. An
 * approval opened by a governed action (AI chat OR remote MCP) is persisted
 * in PostgreSQL, so it survives process restarts and can be decided through
 * the existing `/api/ai/approvals/:id/decision` route by a DIFFERENT
 * process than the one that opened it (the cross-process governance proof).
 *
 * State machine (enforced by atomic conditional transitions):
 *
 *   awaiting_approval ──decide(grant)──▶ approved ──claim──▶ executing
 *        │                                    │                │
 *        │                                   (atomic)      recordOutcome
 *        ▼                                    ▼                ▼
 *   rejected (no execution)              executing      completed | failed
 *
 * Exactly-once: `claim` is `UPDATE … WHERE status = 'approved'` — a
 * concurrent resume attempt from another worker sees zero affected rows and
 * never executes the business mutation a second time. `decide` is likewise
 * conditional (`awaiting_approval`/`proposed` only), so a duplicate
 * decision resolves to `already_decided` instead of re-granting.
 *
 * Cross-process resume dedupe: the `(tenant_id, resume_key)` unique index
 * guarantees at most ONE pending approval per deterministic resume key — a
 * re-invocation of the same governed action (same user + tool + validated
 * arguments) resolves to the SAME approval even after a restart, instead of
 * opening a second one.
 *
 * The engine stores only trusted business state: identity/scope live in the
 * relational columns (never in `input`), and `input` holds the validated
 * user-controlled arguments that define the action to resume.
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { approvalRequests, type NexoraDatabase } from '@nexora/persistence';
import {
  type ApprovalEngine,
  type ApprovalRequestRecord,
  type DecideResult,
  type OpenApprovalInput,
} from '@nexora/ai-runtime';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

type ApprovalRow = typeof approvalRequests.$inferSelect;

/** Maps a persisted row to an {@link ApprovalRequestRecord}. */
function rowToRecord(row: ApprovalRow): ApprovalRequestRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    userId: row.userId,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId ?? undefined,
    runId: row.runId,
    stepId: row.stepId,
    toolId: row.toolId,
    capabilityId: row.capabilityId,
    sideEffectClass: row.sideEffectClass as ApprovalRequestRecord['sideEffectClass'],
    reason: row.reason,
    intent: row.intent,
    input: row.input as Record<string, unknown>,
    resumeKey: row.resumeKey ?? undefined,
    status: row.status as ApprovalRequestRecord['status'],
    createdAt: toIso(row.createdAt) as string,
    decidedBy: row.decidedBy ?? undefined,
    decidedAt: toIso(row.decidedAt),
    decision: (row.decision ?? undefined) as 'grant' | 'reject' | undefined,
    decisionReason: row.decisionReason ?? undefined,
    executedAt: toIso(row.executedAt),
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  };
}

/**
 * The PostgreSQL {@link ApprovalEngine}. All transitions are atomic
 * conditional updates — the durable exactly-once guarantee.
 */
export class PgApprovalEngine implements ApprovalEngine {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async open(input: OpenApprovalInput): Promise<ApprovalRequestRecord> {
    const request: ApprovalRequestRecord = {
      id: prefixedId('apr'),
      ...input,
      status: 'awaiting_approval',
      createdAt: nowIso(),
    };
    const row = {
      id: request.id,
      tenantId: request.tenantId,
      userId: request.userId,
      workspaceId: request.workspaceId ?? null,
      conversationId: request.conversationId,
      runId: request.runId,
      stepId: request.stepId,
      toolId: request.toolId,
      capabilityId: request.capabilityId,
      sideEffectClass: request.sideEffectClass,
      reason: request.reason,
      intent: request.intent,
      input: request.input,
      resumeKey: request.resumeKey ?? null,
      status: request.status,
      decision: null,
      decisionReason: null,
      decidedBy: null,
      createdAt: new Date(request.createdAt),
      decidedAt: null,
      executedAt: null,
      result: null,
      error: null,
      updatedAt: new Date(request.createdAt),
    };
    if (request.resumeKey === undefined) {
      await this.#db.insert(approvalRequests).values(row);
      return request;
    }
    // Cross-process resume dedupe: at most one approval per (tenant,
    // resumeKey). A concurrent first-invocation that inserts the same key
    // wins; this one returns the existing pending approval (never a second).
    const inserted = await this.#db
      .insert(approvalRequests)
      .values(row)
      .onConflictDoNothing({ target: [approvalRequests.tenantId, approvalRequests.resumeKey] });
    if (inserted.rowCount !== 0) {
      return request;
    }
    const existing = await this.#findByResumeKey(request.tenantId, request.resumeKey);
    if (existing !== undefined) {
      return existing;
    }
    // Raced with a delete/transition between the insert and the lookup —
    // the request is recorded as opened (the caller will observe the live
    // state on its next resume attempt).
    return request;
  }

  async decide(
    id: string,
    input: { decision: 'grant' | 'reject'; decidedBy: string; reason?: string },
  ): Promise<DecideResult> {
    const decidedAt = nowIso();
    const updated = await this.#db
      .update(approvalRequests)
      .set({
        status: input.decision === 'grant' ? 'approved' : 'rejected',
        decision: input.decision,
        decidedBy: input.decidedBy,
        decidedAt: new Date(decidedAt),
        decisionReason: input.reason ?? null,
        updatedAt: new Date(decidedAt),
      })
      .where(
        and(
          eq(approvalRequests.id, id),
          inArray(approvalRequests.status, ['awaiting_approval', 'proposed']),
        ),
      )
      .returning();
    const row = updated[0];
    if (row === undefined) {
      // Distinguish a missing request from an already-decided one so the
      // caller can report the right stable error.
      const current = await this.#db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, id))
        .limit(1);
      if (current[0] === undefined) {
        return { ok: false, reason: 'not_found' };
      }
      return { ok: false, reason: 'already_decided' };
    }
    return { ok: true, request: rowToRecord(row) };
  }

  async claim(id: string): Promise<boolean> {
    // The atomic exactly-once guard: only an `approved` request transitions
    // to `executing`, and only one worker's UPDATE can match.
    const updated = await this.#db
      .update(approvalRequests)
      .set({ status: 'executing', executedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'approved')))
      .returning();
    return updated.length === 1;
  }

  async recordOutcome(
    id: string,
    outcome: { status: 'completed' | 'failed'; result?: unknown; error?: string },
  ): Promise<void> {
    await this.#db
      .update(approvalRequests)
      .set({
        status: outcome.status,
        result: outcome.result === undefined ? undefined : outcome.result,
        error: outcome.error ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'executing')));
  }

  async decisionStatus(id: string): Promise<'pending' | 'granted' | 'rejected' | undefined> {
    const rows = await this.#db
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    const status = rows[0]?.status;
    if (status === undefined) {
      return undefined;
    }
    if (status === 'rejected') {
      return 'rejected';
    }
    if (
      status === 'approved' ||
      status === 'executing' ||
      status === 'completed' ||
      status === 'failed'
    ) {
      // Post-grant states report `granted` so a replay of a completed
      // approval reads as granted and replays the stored result (exactly
      // once) instead of re-blocking.
      return 'granted';
    }
    return 'pending';
  }

  async byId(id: string): Promise<ApprovalRequestRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToRecord(row);
  }

  async listByConversation(conversationId: string): Promise<readonly ApprovalRequestRecord[]> {
    const rows = await this.#db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.conversationId, conversationId))
      .orderBy(asc(approvalRequests.createdAt));
    return rows.map(rowToRecord);
  }

  async byResumeKey(
    tenantId: string,
    resumeKey: string,
  ): Promise<ApprovalRequestRecord | undefined> {
    return this.#findByResumeKey(tenantId, resumeKey);
  }

  async listByTenant(
    tenantId: string,
    options: { workspaceId?: string; limit: number },
  ): Promise<readonly ApprovalRequestRecord[]> {
    const conditions = [eq(approvalRequests.tenantId, tenantId)];
    if (options.workspaceId !== undefined) {
      conditions.push(eq(approvalRequests.workspaceId, options.workspaceId));
    }
    const rows = await this.#db
      .select()
      .from(approvalRequests)
      .where(and(...conditions))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(options.limit);
    return rows.map(rowToRecord);
  }

  async #findByResumeKey(
    tenantId: string,
    resumeKey: string,
  ): Promise<ApprovalRequestRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(approvalRequests)
      .where(
        and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.resumeKey, resumeKey)),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToRecord(row);
  }
}
