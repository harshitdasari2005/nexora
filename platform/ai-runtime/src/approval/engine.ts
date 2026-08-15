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
import { nowIso } from '@nexora/shared/time';

/** The lifecycle of an approval request (task contract, AIR.md §12.2). */
export type ApprovalLifecycle =
  'proposed' | 'awaiting_approval' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';

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
  resumeKey?: string;
  /** The current lifecycle state. */
  status: ApprovalLifecycle;
  /** ISO-8601 UTC time the request was created. */
  createdAt: string;
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
  resumeKey?: string;
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
  | { ok: false; reason: 'not_found' | 'already_decided' };

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
   * Atomically claims an approved request for execution
   * (`approved` → `executing`). Returns false when the request is not in a
   * claimable state (already claimed, completed, failed, or not approved).
   */
  claim(id: string): boolean | Promise<boolean>;
  /** Records the execution outcome (`executing` → `completed` | `failed`). */
  recordOutcome(
    id: string,
    outcome: { status: 'completed' | 'failed'; result?: unknown; error?: string },
  ): void | Promise<void>;
  /** The decision disposition of a request, when one exists. */
  decisionStatus(
    id: string,
  ):
    | 'pending'
    | 'granted'
    | 'rejected'
    | undefined
    | Promise<'pending' | 'granted' | 'rejected' | undefined>;
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
}

/**
 * An in-memory {@link ApprovalEngine} (tests and local development; the
 * platform replaces it with a durable store behind the same contract). The
 * synchronous check-and-transition of `claim` is atomic within the event
 * loop — concurrent duplicate deliveries cannot both claim.
 */
export class InMemoryApprovalEngine implements ApprovalEngine {
  readonly #requests = new Map<string, ApprovalRequestRecord>();

  open(input: OpenApprovalInput): ApprovalRequestRecord {
    const request: ApprovalRequestRecord = {
      id: prefixedId('apr'),
      ...input,
      status: 'awaiting_approval',
      createdAt: nowIso(),
    };
    this.#requests.set(request.id, request);
    return request;
  }

  byResumeKey(tenantId: string, resumeKey: string): ApprovalRequestRecord | undefined {
    for (const request of this.#requests.values()) {
      if (request.tenantId === tenantId && request.resumeKey === resumeKey) {
        return request;
      }
    }
    return undefined;
  }

  decide(id: string, input: ApprovalDecisionInput): DecideResult {
    const request = this.#requests.get(id);
    if (request === undefined) {
      return { ok: false, reason: 'not_found' };
    }
    if (request.status !== 'awaiting_approval' && request.status !== 'proposed') {
      return { ok: false, reason: 'already_decided' };
    }
    const decided: ApprovalRequestRecord = {
      ...request,
      status: input.decision === 'grant' ? 'approved' : 'rejected',
      decision: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: nowIso(),
      decisionReason: input.reason,
    };
    this.#requests.set(id, decided);
    return { ok: true, request: decided };
  }

  claim(id: string): boolean {
    const request = this.#requests.get(id);
    // The check and transition are synchronous — atomic within the event
    // loop, so concurrent duplicate deliveries cannot both claim.
    if (request === undefined || request.status !== 'approved') {
      return false;
    }
    this.#requests.set(id, { ...request, status: 'executing', executedAt: nowIso() });
    return true;
  }

  recordOutcome(
    id: string,
    outcome: { status: 'completed' | 'failed'; result?: unknown; error?: string },
  ): void {
    const request = this.#requests.get(id);
    if (request === undefined) {
      return;
    }
    this.#requests.set(id, {
      ...request,
      status: outcome.status,
      result: outcome.result,
      error: outcome.error,
    });
  }

  decisionStatus(id: string): 'pending' | 'granted' | 'rejected' | undefined {
    const request = this.#requests.get(id);
    if (request === undefined) {
      return undefined;
    }
    // Post-grant states (approved, executing, completed, failed) all report
    // `granted`: the decision WAS granted — a replay of a completed approval
    // must still read as granted so the runtime replays the stored result
    // instead of re-blocking (idempotent re-delivery, AIR.md §12).
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
    return this.#requests.get(id);
  }

  listByConversation(conversationId: string): readonly ApprovalRequestRecord[] {
    return [...this.#requests.values()].filter(
      (request) => request.conversationId === conversationId,
    );
  }
}
