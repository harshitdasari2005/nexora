/**
 * @nexora/app-web — hiring requests client.
 *
 * Typed wrappers over `/api/hiring/requisitions`. The browser only sends what
 * the requester fills in and the workspace it is acting from; who the
 * requester is, which stage a decision belongs to and what the caller may do
 * (`actions`) are all decided by the server.
 */

import { api } from './api.js';

export type RequisitionStatus =
  'pending_executive' | 'pending_finance' | 'approved' | 'changes_requested' | 'withdrawn';

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern';
export type RequisitionUrgency = 'low' | 'normal' | 'high';

/** What the requester fills in. */
export interface RequisitionDetails {
  jobTitle: string;
  department: string;
  projectId?: string;
  headcount: number;
  employmentType: EmploymentType;
  salaryMinMinorUnits: number;
  salaryMaxMinorUnits: number;
  currency: string;
  justification: string;
  urgency: RequisitionUrgency;
  targetStartDate?: string;
}

/** One step of a request's history. */
export interface RequisitionHistoryEntry {
  at: string;
  actorId: string;
  actorName?: string;
  action:
    'submitted' | 'executive_not_required' | 'approved' | 'rejected' | 'resubmitted' | 'withdrawn';
  stage?: 'executive' | 'finance';
  comment?: string;
  round: number;
}

/** A hiring request as the server returns it. */
export interface Requisition extends RequisitionDetails {
  id: string;
  organizationId: string;
  workspaceId: string;
  requestedBy: string;
  requestedByName?: string;
  status: RequisitionStatus;
  pendingStage?: 'executive' | 'finance';
  round: number;
  history: readonly RequisitionHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  /** HR's progress, once a position has been opened for an approved request. */
  recruiting?: { openingId: string; status: string; hiredCount: number; headcount: number };
  /** What the CURRENT caller may do right now (server-computed). */
  actions: {
    canDecide: boolean;
    decideBlockedReason?: string;
    canRevise: boolean;
    canWithdraw: boolean;
  };
}

export interface HiringScope {
  organizationId: string;
  workspaceId: string;
}

const query = (scope: HiringScope): string =>
  `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;

/** Lists the requests the caller may see, and whether they may raise one. */
export function listRequisitions(
  scope: HiringScope,
): Promise<{ requisitions: Requisition[]; canCreate: boolean }> {
  return api(`/hiring/requisitions?${query(scope)}`);
}

/** Raises a new hiring request. */
export async function submitRequisition(
  scope: HiringScope,
  details: RequisitionDetails,
): Promise<Requisition> {
  const result = await api<{ requisition: Requisition }>('/hiring/requisitions', {
    method: 'POST',
    body: JSON.stringify({ ...scope, ...details }),
  });
  return result.requisition;
}

/** Revises a returned request and resubmits it. */
export async function reviseRequisition(
  scope: HiringScope,
  id: string,
  details: RequisitionDetails,
): Promise<Requisition> {
  const result = await api<{ requisition: Requisition }>(
    `/hiring/requisitions/${encodeURIComponent(id)}`,
    { method: 'PUT', body: JSON.stringify({ ...scope, ...details }) },
  );
  return result.requisition;
}

/** Approves or rejects the stage the request is waiting at. */
export async function decideRequisition(
  scope: HiringScope,
  id: string,
  decision: 'approve' | 'reject',
  comment: string,
): Promise<Requisition> {
  const trimmed = comment.trim();
  const result = await api<{ requisition: Requisition }>(
    `/hiring/requisitions/${encodeURIComponent(id)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...scope,
        decision,
        ...(trimmed.length === 0 ? {} : { comment: trimmed }),
      }),
    },
  );
  return result.requisition;
}

/** Withdraws the caller's own request. */
export async function withdrawRequisition(scope: HiringScope, id: string): Promise<Requisition> {
  const result = await api<{ requisition: Requisition }>(
    `/hiring/requisitions/${encodeURIComponent(id)}/withdraw`,
    { method: 'POST', body: JSON.stringify(scope) },
  );
  return result.requisition;
}

/** The plain-language status of a request. */
export function statusLabel(status: RequisitionStatus): string {
  switch (status) {
    case 'pending_executive':
      return 'Waiting for the CEO';
    case 'pending_finance':
      return 'Waiting for Finance';
    case 'approved':
      return 'Approved — ready for HR';
    case 'changes_requested':
      return 'Returned to the requester';
    case 'withdrawn':
      return 'Withdrawn';
  }
}

/** The four steps of the chain, with how far a request has got. */
export function chainSteps(
  requisition: Pick<Requisition, 'status' | 'history' | 'round' | 'recruiting'>,
): { label: string; state: 'done' | 'current' | 'waiting' | 'skipped' | 'returned' }[] {
  const inRound = requisition.history.filter((entry) => entry.round === requisition.round);
  const executiveSkipped = inRound.some((entry) => entry.action === 'executive_not_required');
  const approved = (stage: 'executive' | 'finance'): boolean =>
    inRound.some((entry) => entry.action === 'approved' && entry.stage === stage);
  const rejectedAt = inRound.find((entry) => entry.action === 'rejected')?.stage;
  const stageState = (
    stage: 'executive' | 'finance',
  ): 'done' | 'current' | 'waiting' | 'skipped' | 'returned' => {
    if (stage === 'executive' && executiveSkipped) return 'skipped';
    if (approved(stage)) return 'done';
    if (rejectedAt === stage) return 'returned';
    if (requisition.status === `pending_${stage}`) return 'current';
    return 'waiting';
  };
  return [
    { label: 'Raised', state: 'done' },
    { label: 'CEO decision', state: stageState('executive') },
    { label: 'Finance decision', state: stageState('finance') },
    {
      label: 'HR hiring',
      state:
        requisition.status !== 'approved'
          ? 'waiting'
          : requisition.recruiting?.status === 'filled'
            ? 'done'
            : 'current',
    },
  ];
}

/** What HR is doing with an approved request, in plain words. */
export function recruitingProgress(
  requisition: Pick<Requisition, 'status' | 'recruiting'>,
): string | undefined {
  if (requisition.status !== 'approved') return undefined;
  const progress = requisition.recruiting;
  if (progress === undefined) return 'Waiting for HR to open the position';
  if (progress.status === 'filled')
    return `Hired — ${progress.hiredCount} of ${progress.headcount}`;
  if (progress.status === 'closed') return 'HR closed the position without filling it';
  if (progress.status === 'on_hold') return 'HR has put recruiting on hold';
  return `HR is recruiting — ${progress.hiredCount} of ${progress.headcount} hired`;
}
