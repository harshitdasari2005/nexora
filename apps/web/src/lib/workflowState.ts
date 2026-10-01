/**
 * Workflow state vocabulary for the browser.
 *
 * The server derives the truthful composite state (`state`) from the journal,
 * the rollback ledger, the approval and the lineage. This module only maps it
 * to a label + tone, and — for a legacy payload without `state` — derives the
 * MOST CONSERVATIVE state from the raw status: a succeeded instance is never
 * called "verified" without evidence, and failed / compensated / partial can
 * never be rendered as success (no green tone, no "completed").
 */

import type { WorkflowInstanceDto, WorkflowStateKey } from './types.js';

/** A Badge tone. */
export type StateTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'ai';

interface StateStyle {
  label: string;
  tone: StateTone;
  /** Marker used in the step timeline footer. */
  icon: string;
}

const STATES: Readonly<Record<WorkflowStateKey, StateStyle>> = {
  planned: { label: 'Planned', tone: 'neutral', icon: '○' },
  waiting_for_approval: { label: 'Waiting for approval', tone: 'warning', icon: '◔' },
  approved: { label: 'Approved', tone: 'primary', icon: '◑' },
  executing: { label: 'Executing', tone: 'primary', icon: '…' },
  failed: { label: 'Failed', tone: 'danger', icon: '✕' },
  compensated: { label: 'Compensated — rolled back', tone: 'warning', icon: '↺' },
  partial: { label: 'Partial — rollback incomplete', tone: 'danger', icon: '!' },
  verified: { label: 'Verified', tone: 'success', icon: '✓' },
  completed_unverified: {
    label: 'Completed — not independently verified',
    tone: 'warning',
    icon: '✓',
  },
  rejected: { label: 'Rejected — nothing ran', tone: 'danger', icon: '✕' },
  expired: { label: 'Expired — nothing ran', tone: 'warning', icon: '⌛' },
  cancelled: { label: 'Cancelled', tone: 'danger', icon: '✕' },
};

/** The label + tone of a state. */
export function stateStyle(state: WorkflowStateKey): StateStyle {
  return STATES[state];
}

/** The state to render for an instance: the server's, else a conservative derivation. */
export function resolveWorkflowState(
  instance: Pick<WorkflowInstanceDto, 'status' | 'state' | 'compensation'>,
): WorkflowStateKey {
  if (instance.state !== undefined && instance.state in STATES) {
    return instance.state;
  }
  switch (instance.status) {
    case 'succeeded':
      return 'completed_unverified';
    case 'compensated':
      return 'compensated';
    case 'failed':
      if (instance.compensation?.status === 'compensated') return 'compensated';
      if (instance.compensation?.status === 'partial' || instance.compensation?.status === 'failed')
        return 'partial';
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'awaiting_approval':
      return 'waiting_for_approval';
    case 'running':
      return 'executing';
    default:
      return 'planned';
  }
}

/** States whose outcome is NOT a success (never rendered green or "completed"). */
export const NON_SUCCESS_STATES: readonly WorkflowStateKey[] = [
  'failed',
  'compensated',
  'partial',
  'rejected',
  'expired',
  'cancelled',
];
