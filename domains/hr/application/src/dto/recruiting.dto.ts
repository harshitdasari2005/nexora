/**
 * @nexora/application-hr — recruiting DTOs.
 */

import {
  Candidate,
  JobOpening,
  type CandidateHistoryEntry,
  type CandidateOffer,
  type InterviewFeedback,
} from '@nexora/domain-hr';

/** A job opening as exposed outside the domain. */
export interface JobOpeningDto {
  id: string;
  organizationId: string;
  requisitionId: string;
  workspaceId: string;
  hiringManagerId: string;
  openedBy: string;
  title: string;
  department: string;
  headcount: number;
  employmentType: string;
  salaryMinMinorUnits: number;
  salaryMaxMinorUnits: number;
  currency: string;
  description: string;
  status: string;
  offersOut: number;
  hiredCount: number;
  /** Approved seats neither hired nor held by an open offer. */
  seatsAvailable: number;
  closedReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** Maps the aggregate to its DTO. */
export function toJobOpeningDto(opening: JobOpening): JobOpeningDto {
  const { version: _version, ...snapshot } = JobOpening.snapshot(opening);
  void _version;
  return { ...snapshot, seatsAvailable: opening.seatsAvailable };
}

/** A candidate as exposed outside the domain. */
export interface CandidateDto {
  id: string;
  organizationId: string;
  openingId: string;
  name: string;
  email: string;
  phone?: string;
  source: string;
  resumeNotes?: string;
  stage: string;
  /** The next pipeline stage the candidate can be moved to, when there is one. */
  nextStage?: string;
  feedback: readonly InterviewFeedback[];
  /** The offer — present only for callers allowed to see compensation. */
  offer?: CandidateOffer;
  /** Whether an offer exists at all (never the amount), for callers who cannot see it. */
  offerStatus?: CandidateOffer['status'];
  closedReason?: string;
  employeeId?: string;
  history: readonly CandidateHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Maps the aggregate to its DTO. `includeCompensation: false` withholds the
 * offer's amount and start date (only its status is shown) — for interviewers
 * who take part in the process but do not handle pay.
 */
export function toCandidateDto(
  candidate: Candidate,
  options: { includeCompensation: boolean },
): CandidateDto {
  const {
    version: _version,
    workspaceId: _workspaceId,
    offer,
    ...snapshot
  } = Candidate.snapshot(candidate);
  void _version;
  void _workspaceId;
  const nextStage = candidate.nextStage;
  return {
    ...snapshot,
    feedback: [...snapshot.feedback],
    history: [...snapshot.history],
    ...(nextStage === undefined ? {} : { nextStage }),
    ...(offer === undefined
      ? {}
      : options.includeCompensation
        ? { offer, offerStatus: offer.status }
        : { offerStatus: offer.status }),
  };
}
