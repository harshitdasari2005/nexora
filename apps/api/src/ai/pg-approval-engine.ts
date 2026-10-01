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

import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { approvalRequests, type NexoraDatabase } from '@nexora/persistence';
import {
  APPROVAL_DEFAULT_TTL_MS,
  APPROVAL_RECOVERY_REQUIRED_ERROR,
  EXECUTING_LEASE_MS,
  SYSTEM_APPROVAL_CLOCK,
  isApprovalExpiredAt,
  sourcesOf,
  type ApprovalClock,
  type ApprovalDecisionStatus,
  type ApprovalEngine,
  type ApprovalPolicyRecord,
  type ApprovalRequestRecord,
  type DecideResult,
  type ExpireResult,
  type OpenApprovalInput,
} from '@nexora/ai-runtime';
import { prefixedId } from '@nexora/shared/ids';

/** Attempt keys a resume-key conflict walks before giving up. */
const MAX_RESUME_ATTEMPTS = 50;

/** Statuses after which a resume key may be re-requested (a new attempt key is used). */
const RESUME_TERMINAL: ReadonlySet<ApprovalRequestRecord['status']> = new Set([
  'rejected',
  'expired',
  'failed',
]);

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

type ApprovalRow = typeof approvalRequests.$inferSelect;

/** Options of the PostgreSQL approval engine. */
export interface PgApprovalEngineOptions {
  /** Injectable clock (default: real time); every timestamp and expiry comparison uses it. */
  clock?: ApprovalClock;
  /** The `executing` lease in ms (default `EXECUTING_LEASE_MS`). */
  executingLeaseMs?: number;
}

/**
 * Maps a persisted row to an {@link ApprovalRequestRecord}. A NULL
 * `expires_at` (a legacy row written before expiry existed) is treated as
 * `created_at + 24h`, so legacy rows expire deterministically.
 */
function rowToRecord(row: ApprovalRow): ApprovalRequestRecord {
  const createdAt = toIso(row.createdAt) as string;
  const expiresAt =
    toIso(row.expiresAt) ?? new Date(Date.parse(createdAt) + APPROVAL_DEFAULT_TTL_MS).toISOString();
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
    ...(row.agentId === null ? {} : { agentId: row.agentId }),
    ...(row.delegationId === null ? {} : { delegationId: row.delegationId }),
    ...(row.policy === null || row.policy === undefined
      ? {}
      : { policy: row.policy as ApprovalPolicyRecord }),
    status: row.status as ApprovalRequestRecord['status'],
    createdAt,
    expiresAt,
    separationOfDuties: row.separationOfDuties,
    ...(row.requiredApproverRoleId === null
      ? {}
      : { requiredApproverRoleId: row.requiredApproverRoleId }),
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
  readonly #clock: ApprovalClock;
  readonly #executingLeaseMs: number;

  constructor(db: NexoraDatabase, options: PgApprovalEngineOptions = {}) {
    this.#db = db;
    this.#clock = options.clock ?? SYSTEM_APPROVAL_CLOCK;
    this.#executingLeaseMs = options.executingLeaseMs ?? EXECUTING_LEASE_MS;
  }

  async open(input: OpenApprovalInput): Promise<ApprovalRequestRecord> {
    const { ttlMs, expiresAt, requiredApproverRoleId, separationOfDuties, ...rest } = input;
    const now = this.#clock.now();
    const ttl =
      ttlMs !== undefined && Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : APPROVAL_DEFAULT_TTL_MS;
    const request: ApprovalRequestRecord = {
      id: prefixedId('apr'),
      ...rest,
      status: 'awaiting_approval',
      createdAt: now.toISOString(),
      expiresAt: expiresAt ?? new Date(now.getTime() + ttl).toISOString(),
      separationOfDuties: separationOfDuties === true,
      ...(requiredApproverRoleId === undefined ? {} : { requiredApproverRoleId }),
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
      agentId: request.agentId ?? null,
      delegationId: request.delegationId ?? null,
      policy: request.policy ?? null,
      status: request.status,
      decision: null,
      decisionReason: null,
      decidedBy: null,
      createdAt: new Date(request.createdAt),
      expiresAt: new Date(request.expiresAt),
      requiredApproverRoleId: request.requiredApproverRoleId ?? null,
      separationOfDuties: request.separationOfDuties,
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
    // Cross-process resume dedupe: at most one LIVE approval per (tenant,
    // resumeKey). A concurrent first-invocation that inserts the same key
    // wins; this one returns the existing approval (never a second).
    //
    // A TERMINAL approval (rejected / expired / failed) on the key never
    // blocks a new request and is never re-used or resurrected: the new
    // approval is opened under the next attempt key (`<key>:2`, `:3`, …).
    // `completed` is not terminal here — it replays its stored result.
    const baseKey = request.resumeKey;
    for (let attempt = 1; attempt <= MAX_RESUME_ATTEMPTS; attempt += 1) {
      const candidateKey = attempt === 1 ? baseKey : `${baseKey}:${attempt}`;
      const inserted = await this.#db
        .insert(approvalRequests)
        .values({ ...row, resumeKey: candidateKey })
        .onConflictDoNothing({ target: [approvalRequests.tenantId, approvalRequests.resumeKey] });
      if (inserted.rowCount !== 0) {
        return { ...request, resumeKey: candidateKey };
      }
      const existing = await this.#findByResumeKey(request.tenantId, candidateKey);
      if (existing === undefined) {
        // Raced with a delete/transition between the insert and the lookup —
        // the request is recorded as opened (the caller will observe the live
        // state on its next resume attempt).
        return request;
      }
      if (!RESUME_TERMINAL.has(existing.status)) {
        return existing;
      }
    }
    return request;
  }

  async decide(
    id: string,
    input: { decision: 'grant' | 'reject'; decidedBy: string; reason?: string },
  ): Promise<DecideResult> {
    const now = this.#clock.now();
    const target = input.decision === 'grant' ? 'approved' : 'rejected';
    // Conditional on NOT being expired: a due approval can never be decided.
    // A legacy row (NULL expires_at) is treated as created_at + 24h.
    const updated = await this.#db
      .update(approvalRequests)
      .set({
        status: target,
        decision: input.decision,
        decidedBy: input.decidedBy,
        decidedAt: now,
        decisionReason: input.reason ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(approvalRequests.id, id),
          inArray(approvalRequests.status, [...sourcesOf(target)]),
          gt(effectiveExpiry(), now),
        ),
      )
      .returning();
    const row = updated[0];
    if (row !== undefined) {
      return { ok: true, request: rowToRecord(row) };
    }
    // Distinguish a missing request, an expired one, and an already-decided one.
    const found = await this.#select(id);
    if (found === undefined) {
      return { ok: false, reason: 'not_found' };
    }
    if (isApprovalExpiredAt(found, now)) {
      const expired = await this.expire(id);
      return {
        ok: false,
        reason: 'expired',
        transitioned: expired.transitioned,
        ...(expired.record === undefined ? {} : { request: expired.record }),
      };
    }
    return { ok: false, reason: 'already_decided' };
  }

  async expire(id: string): Promise<ExpireResult> {
    const now = this.#clock.now();
    const updated = await this.#db
      .update(approvalRequests)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(approvalRequests.id, id),
          inArray(approvalRequests.status, [...sourcesOf('expired')]),
          lte(effectiveExpiry(), now),
        ),
      )
      .returning();
    if (updated[0] !== undefined) {
      return { transitioned: true, record: rowToRecord(updated[0]) };
    }
    const record = await this.#select(id);
    return record === undefined ? { transitioned: false } : { transitioned: false, record };
  }

  async expireDue(): Promise<readonly ApprovalRequestRecord[]> {
    const now = this.#clock.now();
    const updated = await this.#db
      .update(approvalRequests)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          inArray(approvalRequests.status, [...sourcesOf('expired')]),
          lte(effectiveExpiry(), now),
        ),
      )
      .returning();
    return updated.map(rowToRecord);
  }

  async claim(id: string): Promise<boolean> {
    // The atomic exactly-once guard: only an `approved`, NON-EXPIRED request
    // transitions to `executing`, and only one worker's UPDATE can match.
    const now = this.#clock.now();
    const updated = await this.#db
      .update(approvalRequests)
      .set({ status: 'executing', executedAt: now, updatedAt: now })
      .where(
        and(
          eq(approvalRequests.id, id),
          inArray(approvalRequests.status, [...sourcesOf('executing')]),
          gt(effectiveExpiry(), now),
        ),
      )
      .returning();
    return updated.length === 1;
  }

  async recoverStale(): Promise<readonly ApprovalRequestRecord[]> {
    // Conditional UPDATE: only a still-`executing` row whose lease elapsed
    // transitions (executing -> failed). Concurrent sweepers cannot both win a
    // row, so each recovery is reported (and audited) exactly once. Never a
    // re-execution; a late `recordOutcome` from the abandoned process finds
    // the row terminal and is ignored.
    const now = this.#clock.now();
    const cutoff = new Date(now.getTime() - this.#executingLeaseMs);
    const updated = await this.#db
      .update(approvalRequests)
      .set({ status: 'failed', error: APPROVAL_RECOVERY_REQUIRED_ERROR, updatedAt: now })
      .where(
        and(
          eq(approvalRequests.status, 'executing'),
          lte(
            sql<Date>`coalesce(${approvalRequests.executedAt}, ${approvalRequests.createdAt})`,
            cutoff,
          ),
        ),
      )
      .returning();
    return updated.map(rowToRecord);
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
        updatedAt: this.#clock.now(),
      })
      .where(
        and(
          eq(approvalRequests.id, id),
          inArray(approvalRequests.status, [...sourcesOf(outcome.status)]),
        ),
      );
  }

  async decisionStatus(id: string): Promise<ApprovalDecisionStatus | undefined> {
    const record = await this.#select(id);
    if (record === undefined) {
      return undefined;
    }
    const status = record.status;
    if (status === 'expired') {
      return 'expired';
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
    return this.#select(id);
  }

  async listByConversation(conversationId: string): Promise<readonly ApprovalRequestRecord[]> {
    const rows = await this.#db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.conversationId, conversationId))
      .orderBy(asc(approvalRequests.createdAt));
    return rows.map((row) => this.#view(row));
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
    return rows.map((row) => this.#view(row));
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
    return row === undefined ? undefined : this.#view(row);
  }

  async #select(id: string): Promise<ApprovalRequestRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : this.#view(row);
  }

  /**
   * The record as a reader sees it: a due record reads as `expired` even
   * before the transition is persisted. Pure — reads never mutate, so the
   * transition (and its audit event) belongs to exactly one of
   * `expire` / `expireDue` / `decide`.
   */
  #view(row: ApprovalRow): ApprovalRequestRecord {
    const record = rowToRecord(row);
    return record.status !== 'expired' && isApprovalExpiredAt(record, this.#clock.now())
      ? { ...record, status: 'expired' }
      : record;
  }
}

/** `expires_at`, falling back to `created_at + 24h` for legacy rows. */
function effectiveExpiry() {
  return sql<Date>`coalesce(${approvalRequests.expiresAt}, ${approvalRequests.createdAt} + interval '24 hours')`;
}
