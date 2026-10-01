/**
 * @nexora/module-workflow — rollback summary.
 *
 * A safe, human-readable statement of what a failed workflow left behind,
 * derived ONLY from the journaled rollback ledger — the honest counterpart of
 * "the workflow failed". It names step display names and recorded reasons
 * (already message-safe); it never includes ids, inputs, or stack traces.
 */

import type { WorkflowExecutionRecord } from '@nexora/contracts/workflow';

/**
 * Describes the rollback outcome of a failed workflow execution record, or
 * `''` when the workflow needed none (no state-changing step had completed).
 */
export function describeWorkflowRollback(record: WorkflowExecutionRecord): string {
  const ledger = record.instance.compensation;
  if (ledger === undefined || ledger.status === 'not_required') {
    return '';
  }
  const nameOf = (stepId: string): string =>
    record.steps.find((step) => step.stepId === stepId)?.name ?? stepId;
  const undone = ledger.compensatedSteps.map(nameOf);
  const remaining = ledger.outstanding.map((step) => `${step.name} (${step.reason})`);

  switch (ledger.status) {
    case 'compensated':
      return `Rolled back: ${undone.join(', ')}. Nothing was left behind.`;
    case 'partial':
      return (
        `Partially completed — NOT rolled back: ${remaining.join('; ')}.` +
        (undone.length > 0 ? ` Rolled back: ${undone.join(', ')}.` : '') +
        ' Manual recovery is required.'
      );
    case 'failed':
      return (
        `Rollback failed — NOT rolled back: ${remaining.join('; ')}.` +
        (undone.length > 0 ? ` Rolled back: ${undone.join(', ')}.` : '') +
        ' The rollback can be retried.'
      );
  }
}
