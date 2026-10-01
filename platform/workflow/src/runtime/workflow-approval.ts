/**
 * @nexora/module-workflow — approval port.
 *
 * The workflow runtime REUSES the platform approval engine (AIR.md §12) —
 * there is no second approval framework. This port is structurally
 * compatible with the AI Runtime's `ApprovalEngine` (and its in-memory
 * implementation), so the application composition root injects the same
 * engine that gates AI tool calls: decisions are trusted server-side state,
 * `claim` is the single-flight guard, and a decided request can never be
 * re-decided or re-executed.
 */

import type { SideEffectClass } from '@nexora/contracts/ai';

/** The lifecycle of an approval request (mirrors the platform engine). */
export type WorkflowApprovalStatus =
  | 'proposed'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'expired';

/** A recorded approval request (trusted server-side state). */
export interface WorkflowApprovalRecord {
  /** Request id (`apr_...`). */
  id: string;
  /** The requesting user (trusted identity). */
  userId: string;
  /** The tenant scope (trusted). */
  tenantId: string;
  /** The workspace scope, when workspace-scoped (trusted). */
  workspaceId?: string;
  /** The run that raised the request. */
  runId: string;
  /** The guarded workflow step. */
  stepId: string;
  /** The gated tool id. */
  toolId: string;
  /** The capability being executed. */
  capabilityId: string;
  /** The side-effect class that triggered the gate. */
  sideEffectClass: SideEffectClass;
  /** Why the step requires approval. */
  reason: string;
  /** The current lifecycle state. */
  status: WorkflowApprovalStatus;
  /** The user-controlled action input (never identity). */
  input: Record<string, unknown>;
}

/** Inputs to {@link WorkflowApprovalPort.open}. */
export interface OpenWorkflowApprovalInput {
  /** The requesting user (trusted). */
  userId: string;
  /** The tenant scope (trusted). */
  tenantId: string;
  /** The workspace scope, when known (trusted). */
  workspaceId?: string;
  /** The run id that raised the request. */
  runId: string;
  /** The guarded workflow step id. */
  stepId: string;
  /** The gated tool id. */
  toolId: string;
  /** The capability id being executed. */
  capabilityId: string;
  /** The side-effect class that triggered the gate. */
  sideEffectClass: SideEffectClass;
  /** Why the step requires approval. */
  reason: string;
  /** The user-controlled action input. */
  input: Record<string, unknown>;
}

/**
 * The workflow approval port: the subset of the platform ApprovalEngine the
 * workflow runtime uses. Implementations (including the AI Runtime's
 * `InMemoryApprovalEngine` and the durable `PgApprovalEngine`) must make
 * `claim` atomic (single-flight). Every method is async-capable
 * (`T | Promise<T>`) so the synchronous in-memory engine and the durable
 * PostgreSQL engine both satisfy the port; callers `await` the result.
 */
export interface WorkflowApprovalPort {
  /** Opens a new request (`proposed` → `awaiting_approval`). */
  open(input: OpenWorkflowApprovalInput): WorkflowApprovalRecord | Promise<WorkflowApprovalRecord>;
  /** The decision disposition of a request, when one exists. */
  decisionStatus(
    id: string,
  ):
    | 'pending'
    | 'granted'
    | 'rejected'
    | 'expired'
    | undefined
    | Promise<'pending' | 'granted' | 'rejected' | 'expired' | undefined>;
  /** The request by id, or `undefined`. */
  byId(
    id: string,
  ): WorkflowApprovalRecord | undefined | Promise<WorkflowApprovalRecord | undefined>;
  /** Atomically claims an approved request for execution. */
  claim(id: string): boolean | Promise<boolean>;
  /** Records the execution outcome (`executing` → `completed` | `failed`). */
  recordOutcome(
    id: string,
    outcome: { status: 'completed' | 'failed'; result?: unknown; error?: string },
  ): void | Promise<void>;
}
