/**
 * @nexora/app-web — office requests client.
 *
 * Leave, purchases and IT access: each request goes to the requester's
 * manager first, then to the team that handles it. The server computes what
 * the caller may do with every request (`actions`); the page only shows it.
 */

import { api } from './api.js';
import type { HiringScope } from './hiring.js';

export type RequestType = 'leave' | 'purchase' | 'access';
export type RequestStage = 'manager' | 'hr' | 'finance' | 'it';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type LeaveKind = 'vacation' | 'sick' | 'personal';

export type RequestDetails =
  | { type: 'leave'; kind: LeaveKind; startDate: string; endDate: string; reason: string }
  | { type: 'purchase'; item: string; amountMinorUnits: number; currency: string; reason: string }
  | { type: 'access'; what: string; reason: string };

export interface OfficeRequest {
  id: string;
  type: RequestType;
  details: RequestDetails;
  status: RequestStatus;
  pendingStage?: RequestStage;
  stages: readonly {
    stage: RequestStage;
    state: 'done' | 'current' | 'waiting' | 'skipped' | 'returned';
  }[];
  requestedBy: string;
  requestedByName?: string;
  /** The caller raised this request. */
  mine: boolean;
  history: readonly {
    at: string;
    actorId: string;
    actorName?: string;
    action: 'submitted' | 'not_required' | 'approved' | 'rejected' | 'withdrawn';
    stage?: RequestStage;
    comment?: string;
  }[];
  createdAt: string;
  updatedAt: string;
  actions: { canDecide: boolean; decideBlockedReason?: string; canWithdraw: boolean };
}

const query = (scope: HiringScope): string =>
  `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;

export function listRequests(
  scope: HiringScope,
): Promise<{ requests: OfficeRequest[]; canCreate: boolean }> {
  return api(`/requests?${query(scope)}`);
}

export function raiseRequest(scope: HiringScope, details: RequestDetails): Promise<unknown> {
  return api('/requests', { method: 'POST', body: JSON.stringify({ ...scope, ...details }) });
}

export function decideRequest(
  scope: HiringScope,
  id: string,
  decision: 'approve' | 'reject',
  comment: string,
): Promise<unknown> {
  const trimmed = comment.trim();
  return api(`/requests/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: JSON.stringify({
      ...scope,
      decision,
      ...(trimmed.length === 0 ? {} : { comment: trimmed }),
    }),
  });
}

export function withdrawRequest(scope: HiringScope, id: string): Promise<unknown> {
  return api(`/requests/${encodeURIComponent(id)}/withdraw`, {
    method: 'POST',
    body: JSON.stringify(scope),
  });
}

export const TYPE_LABEL: Record<RequestType, string> = {
  leave: 'Leave',
  purchase: 'Purchase',
  access: 'IT access or equipment',
};

/** Who decides each stage, as the requester would say it. */
export const STAGE_LABEL: Record<RequestStage, string> = {
  manager: 'Manager',
  hr: 'HR',
  finance: 'Finance',
  it: 'IT',
};

/** The chain each kind of request travels (shown before it is raised). */
export const TYPE_CHAIN: Record<RequestType, readonly RequestStage[]> = {
  leave: ['manager', 'hr'],
  purchase: ['manager', 'finance'],
  access: ['manager', 'it'],
};

const LEAVE_KIND: Record<LeaveKind, string> = {
  vacation: 'vacation',
  sick: 'sick leave',
  personal: 'personal leave',
};

function day(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function money(minorUnits: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minorUnits / 100);
  } catch {
    return `${currency} ${(minorUnits / 100).toLocaleString('en-IN')}`;
  }
}

/** What a request asks for, in one line. */
export function requestSummary(details: RequestDetails): string {
  switch (details.type) {
    case 'leave':
      return details.startDate === details.endDate
        ? `${day(details.startDate)}, ${LEAVE_KIND[details.kind]}`
        : `${day(details.startDate)} to ${day(details.endDate)}, ${LEAVE_KIND[details.kind]}`;
    case 'purchase':
      return `${details.item}, ${money(details.amountMinorUnits, details.currency)}`;
    case 'access':
      return details.what;
  }
}

/** Where a request stands, in plain words. */
export function requestStatusLabel(
  request: Pick<OfficeRequest, 'status' | 'pendingStage'>,
): string {
  switch (request.status) {
    case 'pending':
      return request.pendingStage === undefined
        ? 'Pending'
        : `Waiting for ${STAGE_LABEL[request.pendingStage]}`;
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'withdrawn':
      return 'Withdrawn';
  }
}

/** The route of a request: raised, then each stage. */
export function requestRoute(
  request: Pick<OfficeRequest, 'stages'>,
): { label: string; state: 'done' | 'current' | 'waiting' | 'skipped' | 'returned' }[] {
  return [
    { label: 'Raised', state: 'done' },
    ...request.stages.map((entry) => ({ label: STAGE_LABEL[entry.stage], state: entry.state })),
  ];
}
