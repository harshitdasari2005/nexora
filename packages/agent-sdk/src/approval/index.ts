/**
 * @nexora/agent-sdk — approval.
 *
 * Human-approval contracts (AIR.md §12): the approval request an agent
 * raises before consequential actions, its metadata, and the result of the
 * approval round. The canonical `ApprovalRequest`/`ApprovalDecision`
 * contracts live in `@nexora/contracts/approval`; this module builds the
 * fluent request builder.
 */

import type { ApprovalRequest } from '@nexora/contracts/approval';

/** Metadata describing an approval round. */
export interface ApprovalMetadata {
  /** Whether approval was required. */
  required: boolean;
  /** Approver role(s) required. */
  approverRoles?: readonly string[];
  /** Whether the request may be delegated (AIR.md §12.6). */
  delegatable: boolean;
  /** Timeout before escalation, in milliseconds. */
  timeoutMs: number;
}

/** The result of an approval round. */
export interface ApprovalResult {
  /** Whether approval was granted. */
  granted: boolean;
  /** The approval request id, when a request was raised. */
  requestId?: string;
  /** The approver who decided, when decided. */
  decidedBy?: string;
  /** Optional reason from the approver. */
  reason?: string;
}

/**
 * A fluent builder for {@link ApprovalRequest} (AIR.md §12.1). Constructed
 * by agents before raising a request; the built request conforms to the
 * canonical contract.
 *
 * @example
 * ```ts
 * const request = new ApprovalRequestBuilder('wfi_1', 'Close sprint 12')
 *   .requiringRole('projects.admin')
 *   .withContext({ sprintId })
 *   .withTimeout(86_400_000)
 *   .delegatable()
 *   .build();
 * ```
 */
export class ApprovalRequestBuilder {
  #sourceId: string;
  #summary: string;
  #context: Record<string, unknown> = {};
  #approverRoles: string[] = [];
  #timeoutMs = 86_400_000;
  #delegatable = false;

  /**
   * @param sourceId - id of the workflow/agent execution raising the request.
   * @param summary  - human-readable summary of what needs approval.
   */
  constructor(sourceId: string, summary: string) {
    this.#sourceId = sourceId;
    this.#summary = summary;
  }

  /** Sets the full context payload for the approver. */
  withContext(context: Record<string, unknown>): this {
    this.#context = context;
    return this;
  }

  /** Adds an approver role. */
  requiringRole(role: string): this {
    this.#approverRoles.push(role);
    return this;
  }

  /** Sets the timeout before escalation, in milliseconds. */
  withTimeout(timeoutMs: number): this {
    this.#timeoutMs = timeoutMs;
    return this;
  }

  /** Marks the request as delegatable (AIR.md §12.6). */
  delegatable(): this {
    this.#delegatable = true;
    return this;
  }

  /** Builds the canonical approval request. */
  build(): ApprovalRequest {
    return {
      id: `apr_${this.#sourceId}`,
      sourceId: this.#sourceId,
      summary: this.#summary,
      context: this.#context,
      approverRoles: this.#approverRoles,
      status: 'pending',
      createdAt: new Date().toISOString(),
      timeoutMs: this.#timeoutMs,
      delegatable: this.#delegatable,
    };
  }

  /** Builds the approval metadata describing this round. */
  metadata(): ApprovalMetadata {
    return {
      required: true,
      approverRoles: this.#approverRoles,
      delegatable: this.#delegatable,
      timeoutMs: this.#timeoutMs,
    };
  }
}
