/**
 * @nexora/ai-runtime — approval engine.
 *
 * The human-control gate for state-changing AI actions (AIR.md §12, PSD.md
 * §9.3): a state machine that records approval requests, decisions, and
 * execution outcomes. This is the runtime's **minimal approval lifecycle**
 * (Proposed → AwaitingApproval → Approved/Rejected → Executing →
 * Completed/Failed) — it is a seam, not a framework: the platform plugs its
 * durable approval store in behind the same interface (S24 Phase 6: the
 * PostgreSQL `PgApprovalEngine` implements this same contract, so an
 * approval opened by a remote MCP call survives process restarts and is
 * decidable through the existing `/api/ai/approvals/:id/decision` route).
 *
 * Async-capable contract: every method returns `T | Promise<T>` — the
 * in-memory implementation stays synchronous (tests and single-process
 * development), and the durable implementation returns promises. Callers
 * `await` the result, which works for both.
 *
 * Security contract:
 * - Decisions are server-side state, recorded by an authenticated actor;
 *   the caller can never approve by modifying the prompt, tool arguments, or
 *   request body.
 * - `claim` is the single-flight guard: an approved request transitions
 *   `approved → executing` exactly once, so a duplicate delivery of the same
 *   approved execution can never run the tool twice. Durable stores make
 *   the claim an atomic conditional transition (S24 Phase 6: concurrent
 *   resume attempts across processes — only ONE executes).
 * - `resumeKey` (when supplied) is the deterministic cross-process resume
 *   handle: a durable store enforces at most one pending approval per
 *   (tenant, resumeKey), so a re-invocation of the same governed action
 *   (even after a restart) resumes the SAME approval instead of opening a
 *   second one.
 */

import { prefixedId } from '@nexora/shared/ids';

/** The lifecycle of an approval request (task contract, AIR.md §12.2). */
export type ApprovalLifecycle =
  | 'proposed'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'expired';

/**
 * The approval state machine (Prompt 9, G3): the ONLY legal transitions of
 * an approval record. Terminal states (`rejected`, `expired`, `completed`,
 * `failed`) have no outgoing edge, so an approval that ended can never be
 * reopened, re-executed or silently mutated. Durable stores derive their
 * conditional-update guards (`WHERE status IN (sourcesOf(to))`) from this
 * table via {@link sourcesOf}, so the in-memory and durable engines cannot
 * drift apart.
 */
export const APPROVAL_TRANSITIONS: Readonly<
  Record<ApprovalLifecycle, readonly ApprovalLifecycle[]>
> = Object.freeze({
  proposed: Object.freeze(['awaiting_approval', 'rejected', 'expired'] as const),
  awaiting_approval: Object.freeze(['approved', 'rejected', 'expired'] as const),
  approved: Object.freeze(['executing', 'expired'] as const),
  executing: Object.freeze(['completed', 'failed'] as const),
  rejected: Object.freeze([] as const),
  expired: Object.freeze([] as const),
  completed: Object.freeze([] as const),
  failed: Object.freeze([] as const),
});

/** Whether `from → to` is a legal approval transition. Pure. */
export function canTransition(from: ApprovalLifecycle, to: ApprovalLifecycle): boolean {
  return APPROVAL_TRANSITIONS[from]?.includes(to) === true;
}

/** Thrown by {@link assertTransition} for an illegal approval transition. */
export class InvalidApprovalTransitionError extends Error {
  constructor(
    readonly from: ApprovalLifecycle,
    readonly to: ApprovalLifecycle,
  ) {
    super(`illegal approval transition: ${from} -> ${to}`);
    this.name = 'InvalidApprovalTransitionError';
  }
}

/** Throws {@link InvalidApprovalTransitionError} unless `from → to` is legal. */
export function assertTransition(from: ApprovalLifecycle, to: ApprovalLifecycle): void {
  if (!canTransition(from, to)) {
    throw new InvalidApprovalTransitionError(from, to);
  }
}

/**
 * Every status that may legally move to `to` — the source set of a
 * conditional durable update (`UPDATE ... WHERE status IN (...)`).
 */
export function sourcesOf(to: ApprovalLifecycle): readonly ApprovalLifecycle[] {
  return (Object.keys(APPROVAL_TRANSITIONS) as ApprovalLifecycle[]).filter((from) =>
    canTransition(from, to),
  );
}

/**
 * The governed-execution lifecycle (Prompt 9) mapped onto the EXISTING
 * approval statuses and plan-step/run statuses. It is documentation-as-data:
 * no new persisted state exists. Server-authoritative — nothing a caller,
 * prompt or model says can move a step along it.
 *
 * - PROPOSED: a plan step exists (planner output; nothing authorized yet).
 * - AUTHORIZED: RBAC ceiling, delegation and the argument guard passed.
 * - POLICY_DENIED: terminal; policy said DENY; NO approval is ever opened.
 * - APPROVAL_REQUIRED: policy/gate requires a human; an approval opens.
 * - APPROVAL_PENDING: approval `awaiting_approval`; step status `blocked`.
 * - APPROVED / REJECTED / EXPIRED: the recorded decision (rejected, expired terminal).
 * - EXECUTING: single-flight `claim` succeeded (`approved -> executing`).
 * - VERIFIED: approval `completed`; step `succeeded` with `verified: true`.
 * - FAILED: approval `failed`, or step `failed` (also the end of denied steps).
 */
export const EXECUTION_LIFECYCLE = Object.freeze({
  PROPOSED: { approval: undefined, step: 'planned' },
  AUTHORIZED: { approval: undefined, step: 'planned' },
  POLICY_DENIED: { approval: undefined, step: 'failed', errorCode: 'POLICY_DENIED' },
  APPROVAL_REQUIRED: { approval: 'proposed', step: 'blocked' },
  APPROVAL_PENDING: { approval: 'awaiting_approval', step: 'blocked' },
  APPROVED: { approval: 'approved', step: 'blocked' },
  REJECTED: { approval: 'rejected', step: 'blocked' },
  EXPIRED: { approval: 'expired', step: 'failed', errorCode: 'APPROVAL_EXPIRED' },
  EXECUTING: { approval: 'executing', step: 'running' },
  VERIFIED: { approval: 'completed', step: 'succeeded' },
  FAILED: { approval: 'failed', step: 'failed' },
} as const);

/** A phase of {@link EXECUTION_LIFECYCLE}. */
export type ExecutionLifecyclePhase = keyof typeof EXECUTION_LIFECYCLE;

/**
 * The default approval time-to-live: 24 hours. An approval that is not
 * decided AND executed before `expiresAt` can never authorize anything. A
 * policy requirement (POLICY_APPROVAL_AUTHORITY `ttlMinutes`) may shorten or
 * lengthen it per capability.
 */
export const APPROVAL_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * An injectable clock. Every timestamp the engine records (createdAt,
 * decidedAt, executedAt) and every expiry comparison uses it, so expiry is
 * deterministic in tests. The default is the real clock.
 */
export interface ApprovalClock {
  now(): Date;
}

/** The real-time clock (the default). */
export const SYSTEM_APPROVAL_CLOCK: ApprovalClock = { now: () => new Date() };

/** Statuses that can still expire (a claimed/finished/rejected approval cannot). */
export function isExpirableStatus(status: ApprovalLifecycle): boolean {
  return status === 'proposed' || status === 'awaiting_approval' || status === 'approved';
}

/**
 * Whether the record is past its expiry at `now`: `now >= expiresAt`, for a
 * status that can still expire (or already is `expired`). Pure.
 */
export function isApprovalExpiredAt(
  record: Pick<ApprovalRequestRecord, 'status' | 'expiresAt'>,
  now: Date,
): boolean {
  if (record.status === 'expired') {
    return true;
  }
  return isExpirableStatus(record.status) && now.getTime() >= Date.parse(record.expiresAt);
}

/**
 * The `executing` lease: how long a claimed approval may stay `executing`
 * before it is considered abandoned (the process died between `claim` and
 * `recordOutcome`). Measured from `executedAt` (set by the claim) on the
 * approval clock. 15 minutes by default; injectable per engine.
 */
export const EXECUTING_LEASE_MS = 15 * 60 * 1000;

/**
 * The `error` recorded by {@link ApprovalEngine.recoverStale}. Recovery NEVER
 * re-executes: the outcome of the abandoned execution is unknown (the side
 * effect may or may not have happened), so the approval ends `failed` and a
 * human must verify the state before re-requesting a NEW approval.
 */
export const APPROVAL_RECOVERY_REQUIRED_ERROR =
  'RECOVERY_REQUIRED: execution outcome unknown; verify state before re-requesting';

/** Whether an approval record was failed by {@link ApprovalEngine.recoverStale}. */
export function isRecoveryRequired(
  record: Pick<ApprovalRequestRecord, 'status' | 'error'>,
): boolean {
  return record.status === 'failed' && record.error === APPROVAL_RECOVERY_REQUIRED_ERROR;
}

/** The result of {@link ApprovalEngine.expire}. */
export interface ExpireResult {
  /** True only for the call that performed the transition (exactly once per approval). */
  transitioned: boolean;
  /** The record as it is after the call, when it exists. */
  record?: ApprovalRequestRecord;
}

/**
 * The policy decision an approval was opened under (Prompt 5). Recorded, not
 * recomputed, so history stays true after policy changes: the approval keeps
 * the policy id, version and rules that required it. A resumed run compares
 * its CURRENT decision's fingerprint with this one.
 */
export interface ApprovalPolicyRecord {
  outcome: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  policyId: string;
  version: string;
  reasonCode: string;
  reason: string;
  /** The decision fingerprint (matched rules @ versions = outcomes). */
  fingerprint: string;
  /** Every matched rule as `policyId@version=OUTCOME`. */
  rules: readonly string[];
}

/** A recorded approval request (trusted server-side state). */
export interface ApprovalRequestRecord {
  /** Request id (`apr_...`). */
  id: string;
  /** The conversation the request belongs to. */
  conversationId: string;
  /** The requesting user (trusted identity). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The workspace scope, when workspace-scoped (trusted). */
  workspaceId?: string;
  /** The run that raised the request. */
  runId: string;
  /** The guarded plan step. */
  stepId: string;
  /** The tool whose invocation is gated. */
  toolId: string;
  /** The capability the step executes. */
  capabilityId: string;
  /** The side-effect class that triggered the gate. */
  sideEffectClass: 'read_only' | 'state_change' | 'consequential';
  /** Why the action requires approval. */
  reason: string;
  /** The user intent that produced the plan. */
  intent: string;
  /** The user-controlled action input (e.g. `{ name }` — never identity). */
  input: Record<string, unknown>;
  /**
   * The deterministic cross-process resume handle (durable stores enforce
   * uniqueness per tenant; absent for one-shot AI approvals).
   */
  /**
   * The agent principal whose run opened the approval (Prompt 4). A resumed
   * approval executes AS this agent, and is re-authorized against its
   * delegations at execution time. Absent for human (chat/MCP) runs.
   */
  agentId?: string;
  /** The delegation that authorized the gated capability when it was opened. */
  delegationId?: string;
  /** The policy decision the approval was opened under (Prompt 5). */
  policy?: ApprovalPolicyRecord;
  resumeKey?: string;
  /** The current lifecycle state. */
  status: ApprovalLifecycle;
  /** ISO-8601 UTC time the request was created. */
  createdAt: string;
  /**
   * ISO-8601 UTC time after which the approval can no longer be decided,
   * claimed or executed (`now >= expiresAt` ⇒ expired).
   */
  expiresAt: string;
  /**
   * When set, only an approver whose resolved role in the approval's
   * workspace equals this role id may decide (enforced by the decision
   * route, `authorizeApprovalDecision`; recorded here as trusted state).
   */
  requiredApproverRoleId?: string;
  /** When true the decider must differ from the requester. */
  separationOfDuties: boolean;
  /** The actor who decided, when decided. */
  decidedBy?: string;
  /** ISO-8601 UTC time of the decision. */
  decidedAt?: string;
  /** The recorded decision. */
  decision?: 'grant' | 'reject';
  /** Optional reason recorded with the decision (audit). */
  decisionReason?: string;
  /** ISO-8601 UTC time execution started (claim). */
  executedAt?: string;
  /** The tool result stored after completion (idempotent re-delivery). */
  result?: unknown;
  /** The failure message when execution failed. */
  error?: string;
}

/** Inputs to {@link ApprovalEngine.open}. */
export interface OpenApprovalInput {
  /** The conversation the request belongs to. */
  conversationId: string;
  /** The requesting user (trusted). */
  userId: string;
  /** The tenant scope (trusted). */
  tenantId: string;
  /** The workspace scope, when known (trusted). */
  workspaceId?: string;
  /** The run id that raised the request. */
  runId: string;
  /** The guarded plan step id. */
  stepId: string;
  /** The gated tool id. */
  toolId: string;
  /** The capability id being executed. */
  capabilityId: string;
  /** The side-effect class that triggered the gate. */
  sideEffectClass: 'read_only' | 'state_change' | 'consequential';
  /** Why the action requires approval. */
  reason: string;
  /** The user intent that produced the plan. */
  intent: string;
  /** The user-controlled action input. */
  input: Record<string, unknown>;
  /**
   * Optional deterministic resume handle (see {@link ApprovalRequestRecord}):
   * a re-invocation of the same governed action resolves to the same
   * approval, even across process restarts (S24 Phase 6).
   */
  /** The agent principal whose run opens the approval (Prompt 4). */
  agentId?: string;
  /** The delegation that authorized the gated capability. */
  delegationId?: string;
  /** The policy decision the approval is opened under (Prompt 5). */
  policy?: ApprovalPolicyRecord;
  resumeKey?: string;
  /** Time-to-live in ms (default {@link APPROVAL_DEFAULT_TTL_MS}); ignored when `expiresAt` is set. */
  ttlMs?: number;
  /** Absolute ISO-8601 expiry; takes precedence over `ttlMs`. */
  expiresAt?: string;
  /** Required approver role id (from the policy approval requirement). */
  requiredApproverRoleId?: string;
  /** Separation of duties (default false). */
  separationOfDuties?: boolean;
}

/** An approval decision submitted by an authenticated actor. */
export interface ApprovalDecisionInput {
  /** The decision. */
  decision: 'grant' | 'reject';
  /** The deciding actor (authenticated user id). */
  decidedBy: string;
  /** Optional reason, recorded for audit. */
  reason?: string;
}

/** The outcome of {@link ApprovalEngine.decide}. */
export type DecideResult =
  | { ok: true; request: ApprovalRequestRecord }
  | { ok: false; reason: 'not_found' | 'already_decided' }
  | {
      ok: false;
      reason: 'expired';
      /**
       * True only for the call that persisted the `expired` transition (so
       * exactly one caller publishes the `approval.expired` audit event).
       */
      transitioned: boolean;
      request?: ApprovalRequestRecord;
    };

/** The decision disposition reported by {@link ApprovalEngine.decisionStatus}. */
export type ApprovalDecisionStatus = 'pending' | 'granted' | 'rejected' | 'expired';

/** Options of the in-memory engine. */
export interface InMemoryApprovalEngineOptions {
  /** Injectable clock (default: real time). */
  clock?: ApprovalClock;
  /** The `executing` lease in ms (default {@link EXECUTING_LEASE_MS}). */
  executingLeaseMs?: number;
}

/**
 * The approval engine port. Implementations must make {@link claim} atomic
 * (single-flight) — the in-memory implementation relies on the synchronous
 * check-and-transition; durable stores use a conditional update (S24 Phase
 * 6: the atomic claim is what makes concurrent cross-process resume safe).
 *
 * Every method is async-capable (`T | Promise<T>`): callers `await` the
 * result, which works for both the synchronous in-memory engine and the
 * asynchronous durable engine.
 */
export interface ApprovalEngine {
  /** Opens a new request (`proposed` → `awaiting_approval`). */
  open(input: OpenApprovalInput): ApprovalRequestRecord | Promise<ApprovalRequestRecord>;
  /** Records a decision; a request can be decided exactly once. */
  decide(id: string, input: ApprovalDecisionInput): DecideResult | Promise<DecideResult>;
  /**
   * Expires ONE approval: `awaiting_approval | proposed | approved → expired`
   * when `now >= expiresAt`, exactly once (`transitioned` is true only for
   * the call that performed it; repeats and not-yet-due approvals report
   * false). Never touches rejected / executing / completed / failed records.
   */
  expire(id: string): ExpireResult | Promise<ExpireResult>;
  /**
   * Sweeps every due approval and returns ONLY the records that transitioned
   * in this call (idempotent: a second sweep returns `[]`). The caller
   * publishes one `approval.expired` audit event per returned record.
   */
  expireDue(): readonly ApprovalRequestRecord[] | Promise<readonly ApprovalRequestRecord[]>;
  /**
   * Atomically claims an approved request for execution
   * (`approved` → `executing`). Returns false when the request is not in a
   * claimable state (already claimed, completed, failed, not approved, or
   * EXPIRED — an approved-but-unexecuted approval past `expiresAt` is never
   * claimable; reads report it as `expired`, and `expire`/`expireDue` persist
   * the transition).
   */
  claim(id: string): boolean | Promise<boolean>;
  /**
   * Recovers abandoned executions: every approval still `executing` whose
   * lease elapsed (`executedAt <= now - lease`) transitions `executing →
   * failed` with {@link APPROVAL_RECOVERY_REQUIRED_ERROR}, and ONLY the
   * records that transitioned in this call are returned (idempotent: a second
   * call returns `[]`). It NEVER re-executes and NEVER touches completed /
   * failed / rejected / expired / approved records; an `executing` approval
   * past its `expiresAt` still recovers as `failed` (never `expired`). The
   * caller publishes one `approval.recovery_required` audit event per record.
   */
  recoverStale(): readonly ApprovalRequestRecord[] | Promise<readonly ApprovalRequestRecord[]>;
  /** Records the execution outcome (`executing` → `completed` | `failed`). */
  recordOutcome(
    id: string,
    outcome: { status: 'completed' | 'failed'; result?: unknown; error?: string },
  ): void | Promise<void>;
  /** The decision disposition of a request, when one exists. */
  decisionStatus(
    id: string,
  ): ApprovalDecisionStatus | undefined | Promise<ApprovalDecisionStatus | undefined>;
  /** The request by id, or `undefined`. */
  byId(id: string): ApprovalRequestRecord | undefined | Promise<ApprovalRequestRecord | undefined>;
  /** The requests of a conversation (audit trail). */
  listByConversation(
    conversationId: string,
  ): readonly ApprovalRequestRecord[] | Promise<readonly ApprovalRequestRecord[]>;
  /**
   * Resolves the pending/recorded request for a deterministic resume key
   * within a tenant — the cross-process resume handle of a governed action
   * (S24 Phase 6). Optional: stores that cannot resume by key (one-shot
   * in-memory usage) omit it and callers fall back to their own tracking.
   */
  byResumeKey?(
    tenantId: string,
    resumeKey: string,
  ): ApprovalRequestRecord | undefined | Promise<ApprovalRequestRecord | undefined>;
  /**
   * Lists the most recent approval requests across the WHOLE tenant, newest
   * first — the read side for cross-conversation governance views (e.g. an
   * Audit Center). Purely additive to the engine's read surface; never
   * touches how a request is opened, decided, claimed, or resolved.
   */
  listByTenant(
    tenantId: string,
    options: { workspaceId?: string; limit: number },
  ): readonly ApprovalRequestRecord[] | Promise<readonly ApprovalRequestRecord[]>;
}

/**
 * An in-memory {@link ApprovalEngine} (tests and local development; the
 * platform replaces it with a durable store behind the same contract). The
 * synchronous check-and-transition of `claim` is atomic within the event
 * loop — concurrent duplicate deliveries cannot both claim.
 */
export class InMemoryApprovalEngine implements ApprovalEngine {
  readonly #requests = new Map<string, ApprovalRequestRecord>();
  readonly #clock: ApprovalClock;
  readonly #executingLeaseMs: number;

  constructor(options: InMemoryApprovalEngineOptions = {}) {
    this.#clock = options.clock ?? SYSTEM_APPROVAL_CLOCK;
    this.#executingLeaseMs = options.executingLeaseMs ?? EXECUTING_LEASE_MS;
  }

  open(input: OpenApprovalInput): ApprovalRequestRecord {
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
    this.#requests.set(request.id, request);
    return request;
  }

  byResumeKey(tenantId: string, resumeKey: string): ApprovalRequestRecord | undefined {
    for (const request of this.#requests.values()) {
      if (request.tenantId === tenantId && request.resumeKey === resumeKey) {
        return this.#view(request);
      }
    }
    return undefined;
  }

  /**
   * The record as a reader sees it: a due record reads as `expired` even
   * before the transition is persisted. Pure — reads never mutate, so the
   * transition (and its audit event) belongs to exactly one of
   * `expire` / `expireDue` / `decide`.
   */
  #view(request: ApprovalRequestRecord): ApprovalRequestRecord {
    return request.status !== 'expired' && isApprovalExpiredAt(request, this.#clock.now())
      ? { ...request, status: 'expired' }
      : request;
  }

  /** Persists the `expired` transition of a due record; true only when this call did it. */
  #persistExpiry(request: ApprovalRequestRecord): {
    transitioned: boolean;
    record: ApprovalRequestRecord;
  } {
    const view = this.#view(request);
    if (view.status === 'expired' && request.status !== 'expired') {
      this.#requests.set(request.id, view);
      return { transitioned: true, record: view };
    }
    return { transitioned: false, record: request };
  }

  decide(id: string, input: ApprovalDecisionInput): DecideResult {
    const found = this.#requests.get(id);
    if (found === undefined) {
      return { ok: false, reason: 'not_found' };
    }
    const { transitioned, record: request } = this.#persistExpiry(found);
    if (request.status === 'expired') {
      return { ok: false, reason: 'expired', transitioned, request };
    }
    const target = input.decision === 'grant' ? 'approved' : 'rejected';
    if (!canTransition(request.status, target)) {
      return { ok: false, reason: 'already_decided' };
    }
    const decided: ApprovalRequestRecord = {
      ...request,
      status: input.decision === 'grant' ? 'approved' : 'rejected',
      decision: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: this.#clock.now().toISOString(),
      decisionReason: input.reason,
    };
    this.#requests.set(id, decided);
    return { ok: true, request: decided };
  }

  expire(id: string): ExpireResult {
    const found = this.#requests.get(id);
    if (found === undefined) {
      return { transitioned: false };
    }
    return this.#persistExpiry(found);
  }

  expireDue(): readonly ApprovalRequestRecord[] {
    const transitioned: ApprovalRequestRecord[] = [];
    for (const request of [...this.#requests.values()]) {
      const result = this.#persistExpiry(request);
      if (result.transitioned) {
        transitioned.push(result.record);
      }
    }
    return transitioned;
  }

  claim(id: string): boolean {
    const found = this.#requests.get(id);
    if (found === undefined) {
      return false;
    }
    const request = this.#view(found);
    // The check and transition are synchronous — atomic within the event
    // loop, so concurrent duplicate deliveries cannot both claim.
    if (request.status !== 'approved' || !canTransition(request.status, 'executing')) {
      return false;
    }
    this.#requests.set(id, {
      ...request,
      status: 'executing',
      executedAt: this.#clock.now().toISOString(),
    });
    return true;
  }

  recoverStale(): readonly ApprovalRequestRecord[] {
    const cutoff = this.#clock.now().getTime() - this.#executingLeaseMs;
    const recovered: ApprovalRequestRecord[] = [];
    for (const request of [...this.#requests.values()]) {
      if (
        request.status !== 'executing' ||
        !canTransition('executing', 'failed') ||
        Date.parse(request.executedAt ?? request.createdAt) > cutoff
      ) {
        continue;
      }
      const failed: ApprovalRequestRecord = {
        ...request,
        status: 'failed',
        error: APPROVAL_RECOVERY_REQUIRED_ERROR,
      };
      this.#requests.set(request.id, failed);
      recovered.push(failed);
    }
    return recovered;
  }

  recordOutcome(
    id: string,
    outcome: { status: 'completed' | 'failed'; result?: unknown; error?: string },
  ): void {
    const request = this.#requests.get(id);
    if (request === undefined) {
      return;
    }
    // State machine (G3): an outcome is recorded ONLY from `executing`. A
    // terminal or never-claimed approval is never mutated (a stale or
    // duplicate outcome is ignored, not applied).
    if (!canTransition(request.status, outcome.status)) {
      return;
    }
    this.#requests.set(id, {
      ...request,
      status: outcome.status,
      result: outcome.result,
      error: outcome.error,
    });
  }

  decisionStatus(id: string): ApprovalDecisionStatus | undefined {
    const found = this.#requests.get(id);
    if (found === undefined) {
      return undefined;
    }
    const request = this.#view(found);
    // Post-grant states (approved, executing, completed, failed) all report
    // `granted`: the decision WAS granted — a replay of a completed approval
    // must still read as granted so the runtime replays the stored result
    // instead of re-blocking (idempotent re-delivery, AIR.md §12).
    if (request.status === 'expired') {
      return 'expired';
    }
    if (request.status === 'rejected') {
      return 'rejected';
    }
    if (
      request.status === 'approved' ||
      request.status === 'executing' ||
      request.status === 'completed' ||
      request.status === 'failed'
    ) {
      return 'granted';
    }
    return 'pending';
  }

  byId(id: string): ApprovalRequestRecord | undefined {
    const found = this.#requests.get(id);
    return found === undefined ? undefined : this.#view(found);
  }

  listByConversation(conversationId: string): readonly ApprovalRequestRecord[] {
    return [...this.#requests.values()]
      .filter((request) => request.conversationId === conversationId)
      .map((request) => this.#view(request));
  }

  listByTenant(
    tenantId: string,
    options: { workspaceId?: string; limit: number },
  ): readonly ApprovalRequestRecord[] {
    return [...this.#requests.values()]
      .filter(
        (request) =>
          request.tenantId === tenantId &&
          (options.workspaceId === undefined || request.workspaceId === options.workspaceId),
      )
      .map((request) => this.#view(request))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, options.limit);
  }
}
