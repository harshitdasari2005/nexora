/**
 * @nexora/contracts — approval contracts.
 *
 * The approval engine contracts (AIR.md §12): requests, decisions, context,
 * and history. Approval is the human-control gate on consequential AI and
 * workflow actions (PSD.md §9.3, AIR.md §12.1).
 */

import type { Timestamp } from '../common/index.js';

/** Lifecycle state of an approval request (AIR.md §12.2). */
export type ApprovalStatus = 'pending' | 'granted' | 'rejected' | 'escalated' | 'expired';

/**
 * An approval request raised by a workflow or agent (AIR.md §12.1).
 */
export interface ApprovalRequest {
  /** Request id (`apr_...`). */
  id: string;
  /** Id of the workflow instance or agent execution that raised it. */
  sourceId: string;
  /** Human-readable summary of what needs approval. */
  summary: string;
  /** Full context payload for the approver (AIR.md §12.3). */
  context: Record<string, unknown>;
  /** Approver role(s) required. */
  approverRoles: readonly string[];
  /** Current state of the request. */
  status: ApprovalStatus;
  /** Id of the actor who decided, when decided. */
  decidedBy?: string;
  /** ISO-8601 UTC time the decision was made. */
  decidedAt?: Timestamp;
  /** ISO-8601 UTC time the request was created. */
  createdAt: Timestamp;
  /** Timeout after which the request escalates/expires, in milliseconds. */
  timeoutMs: number;
  /** Whether the request may be delegated (AIR.md §12.6). */
  delegatable: boolean;
}

/**
 * The context an approver sees when deciding (AIR.md §12.3): the action
 * being approved, its side effects, and the explainability record.
 */
export interface ApprovalContext {
  /** The action to approve, e.g. `projects.close_sprint`. */
  action: string;
  /** The actor (user or agent) requesting the action. */
  requester: string;
  /** Side-effect class of the action. */
  sideEffectClass: 'read_only' | 'state_change' | 'consequential';
  /** The pending plan/execution being approved. */
  plan?: Record<string, unknown>;
  /** Explainability record attached to the request (AIR.md §14). */
  explanation?: Record<string, unknown>;
  /** ISO-8601 UTC time the request was created. */
  requestedAt: Timestamp;
}

/**
 * The decision an approver submits for a request.
 */
export interface ApprovalDecision {
  /** The request id being decided. */
  requestId: string;
  /** The decision. */
  decision: 'grant' | 'reject';
  /** Optional reason, recorded for audit (AIR.md §12.4). */
  reason?: string;
  /** The actor who decided. */
  decidedBy: string;
  /** ISO-8601 UTC time of the decision. */
  decidedAt: Timestamp;
}

/**
 * A single entry in an approval's history (full audit trail, AIR.md §12.4).
 */
export interface ApprovalHistoryEntry {
  /** Event id of this history entry. */
  id: string;
  /** The request id. */
  requestId: string;
  /** What happened (created, granted, rejected, escalated, expired, delegated). */
  event: string;
  /** The actor responsible. */
  actor: string;
  /** ISO-8601 UTC time of the event. */
  occurredAt: Timestamp;
  /** Optional note/reason. */
  note?: string;
}
