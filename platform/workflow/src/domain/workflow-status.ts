/**
 * @nexora/module-workflow — workflow lifecycle.
 *
 * The workflow instance lifecycle (SAD.md §12.4) and its transition table.
 * The contract union (`@nexora/contracts/workflow`) is the canonical status
 * vocabulary; this module owns the *transitions* — the enforcement point for
 * the validate → mutate rule on instance status changes.
 *
 * Lifecycle:
 *
 *   created → planning → ready → running → awaiting_approval ⇄ running
 *                                 ├──→ succeeded
 *                                 ├──→ failed
 *                                 ├──→ cancelled
 *                                 └──→ compensated
 */

import type { WorkflowInstanceStatus } from '@nexora/contracts/workflow';

/** The workflow instance statuses. */
export type WorkflowStatus = WorkflowInstanceStatus;

/** Statuses from which a workflow may still make progress. */
export const ACTIVE_STATUSES: readonly WorkflowStatus[] = [
  'created',
  'planning',
  'ready',
  'running',
  'awaiting_approval',
];

/** Terminal statuses: no outgoing transitions. */
export const TERMINAL_STATUSES: readonly WorkflowStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'compensated',
];

/** The allowed transition table (from → allowed targets). */
export const WORKFLOW_TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  created: ['planning'],
  planning: ['ready'],
  ready: ['running'],
  running: ['awaiting_approval', 'succeeded', 'failed', 'cancelled', 'compensated'],
  awaiting_approval: ['running', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
  compensated: [],
};

/** Whether a status is terminal (no outgoing transitions). */
export function isTerminal(status: WorkflowStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Whether a transition is allowed by the table. */
export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return (WORKFLOW_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The step execution statuses (mirrors the contract `WorkflowStepStatus`).
 */
export type StepExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
