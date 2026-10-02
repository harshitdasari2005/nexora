/**
 * @nexora/app-web — recruiting client (HR's side of hiring).
 *
 * Typed wrappers over `/api/recruiting/*`. What the caller may do with each
 * candidate (`actions`) and whether they may manage an opening (`canManage`)
 * are computed by the server; offer amounts are simply absent for callers who
 * may not see pay.
 */

import { api } from './api.js';
import type { HiringScope } from './hiring.js';

export type OpeningStatus = 'open' | 'on_hold' | 'filled' | 'closed';
export type CandidateStage =
  'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';
export type CandidateSource = 'referral' | 'job_board' | 'agency' | 'internal' | 'other';
export type Recommendation = 'strong_yes' | 'yes' | 'no' | 'strong_no';

export interface Opening {
  id: string;
  requisitionId: string;
  title: string;
  department: string;
  headcount: number;
  employmentType: string;
  salaryMinMinorUnits: number;
  salaryMaxMinorUnits: number;
  currency: string;
  description: string;
  status: OpeningStatus;
  offersOut: number;
  hiredCount: number;
  seatsAvailable: number;
  closedReason?: string;
  hiringManagerName?: string;
  canManage: boolean;
  createdAt: string;
}

/** An approved hiring request HR has not opened a position for yet. */
export interface ReadyRequisition {
  id: string;
  jobTitle: string;
  department: string;
  headcount: number;
  employmentType: string;
  salaryMinMinorUnits: number;
  salaryMaxMinorUnits: number;
  currency: string;
  justification: string;
  requestedByName?: string;
}

export interface Candidate {
  id: string;
  openingId: string;
  name: string;
  email: string;
  phone?: string;
  source: CandidateSource;
  resumeNotes?: string;
  stage: CandidateStage;
  nextStage?: CandidateStage;
  feedback: readonly {
    by: string;
    byName?: string;
    at: string;
    stage: string;
    rating: number;
    recommendation: Recommendation;
    notes: string;
  }[];
  /** Present only for callers allowed to see pay. */
  offer?: {
    salaryMinorUnits: number;
    currency: string;
    startDate: string;
    status: 'extended' | 'accepted' | 'declined';
    responseNote?: string;
  };
  offerStatus?: 'extended' | 'accepted' | 'declined';
  closedReason?: string;
  employeeId?: string;
  history: readonly {
    at: string;
    actorName?: string;
    action: string;
    stage: string;
    note?: string;
  }[];
  actions: {
    canAdvance: boolean;
    canGiveFeedback: boolean;
    canOffer: boolean;
    canRecordResponse: boolean;
    canClose: boolean;
  };
}

const query = (scope: HiringScope): string =>
  `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;
const post = <T>(
  path: string,
  scope: HiringScope,
  body: Record<string, unknown> = {},
): Promise<T> => api<T>(path, { method: 'POST', body: JSON.stringify({ ...scope, ...body }) });

export function listOpenings(
  scope: HiringScope,
): Promise<{ openings: Opening[]; readyRequisitions: ReadyRequisition[]; canManage: boolean }> {
  return api(`/recruiting/openings?${query(scope)}`);
}

export function getOpening(
  scope: HiringScope,
  openingId: string,
): Promise<{ opening: Opening; candidates: Candidate[] }> {
  return api(`/recruiting/openings/${encodeURIComponent(openingId)}?${query(scope)}`);
}

export const openPosition = (scope: HiringScope, requisitionId: string, description: string) =>
  post<{ opening: Opening }>('/recruiting/openings', scope, { requisitionId, description });

export const changeOpening = (
  scope: HiringScope,
  openingId: string,
  action: 'hold' | 'resume' | 'close',
  reason?: string,
) =>
  post<{ opening: Opening }>(
    `/recruiting/openings/${encodeURIComponent(openingId)}/status`,
    scope,
    {
      action,
      ...(reason === undefined ? {} : { reason }),
    },
  );

export const addCandidate = (
  scope: HiringScope,
  openingId: string,
  input: {
    name: string;
    email: string;
    phone?: string;
    source: CandidateSource;
    resumeNotes?: string;
  },
) =>
  post<{ candidate: Candidate }>(
    `/recruiting/openings/${encodeURIComponent(openingId)}/candidates`,
    scope,
    input,
  );

const candidatePath = (id: string, action: string): string =>
  `/recruiting/candidates/${encodeURIComponent(id)}/${action}`;

export const advanceCandidate = (scope: HiringScope, id: string) =>
  post<{ candidate: Candidate }>(candidatePath(id, 'advance'), scope);

export const giveFeedback = (
  scope: HiringScope,
  id: string,
  input: { rating: number; recommendation: Recommendation; notes: string },
) => post<{ candidate: Candidate }>(candidatePath(id, 'feedback'), scope, input);

export const makeOffer = (
  scope: HiringScope,
  id: string,
  input: { salaryMinorUnits: number; startDate: string },
) => post<{ candidate: Candidate }>(candidatePath(id, 'offer'), scope, input);

export const recordOfferResponse = (
  scope: HiringScope,
  id: string,
  response: 'accept' | 'decline',
  note?: string,
) =>
  post<{ candidate: Candidate; employeeId?: string }>(candidatePath(id, 'offer/response'), scope, {
    response,
    ...(note === undefined || note.trim() === '' ? {} : { note: note.trim() }),
  });

export const closeCandidate = (
  scope: HiringScope,
  id: string,
  outcome: 'reject' | 'withdraw',
  reason: string,
) => post<{ candidate: Candidate }>(candidatePath(id, 'close'), scope, { outcome, reason });

export const STAGE_LABEL: Record<CandidateStage, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer made',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrew',
};

export const OPENING_STATUS_LABEL: Record<OpeningStatus, string> = {
  open: 'Recruiting',
  on_hold: 'On hold',
  filled: 'Filled',
  closed: 'Closed',
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  strong_yes: 'Strong yes',
  yes: 'Yes',
  no: 'No',
  strong_no: 'Strong no',
};

/** "1 of 2 hired · 1 offer out". */
export function seatSummary(
  opening: Pick<Opening, 'headcount' | 'hiredCount' | 'offersOut'>,
): string {
  const offers =
    opening.offersOut === 0
      ? ''
      : ` · ${opening.offersOut} offer${opening.offersOut === 1 ? '' : 's'} out`;
  return `${opening.hiredCount} of ${opening.headcount} hired${offers}`;
}
