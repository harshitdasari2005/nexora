/**
 * @nexora/domain-hr — Candidate aggregate root.
 *
 * One person being considered for one job opening, moving through HR's
 * pipeline:
 *
 *   applied → screening → interview → offer → hired
 *        (rejected or withdrawn from any stage before `hired`)
 *
 * The rules a real recruiting process keeps:
 * - stages advance one step at a time, in order;
 * - interview feedback is recorded while the candidate is being screened or
 *   interviewed, once per interviewer per stage;
 * - an offer needs interview feedback first, and its salary must sit inside
 *   the range Finance approved on the hiring request;
 * - an offer is answered once: accepted (→ hired) or declined (→ withdrawn).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import { InvalidEmployeeValueError, RecruitingStateError } from '../errors/index.js';
import {
  recruitingEvent,
  RECRUITING_EVENT_TYPES,
  type RecruitingEventContext,
} from '../events/recruiting-events.js';
import { CandidateId } from '../value-objects/recruiting-ids.js';

export const CANDIDATE_STAGES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

/** The stages a candidate walks through in order (before an offer). */
const PIPELINE: readonly CandidateStage[] = ['applied', 'screening', 'interview'];
const TERMINAL: readonly CandidateStage[] = ['hired', 'rejected', 'withdrawn'];

export const CANDIDATE_SOURCES = ['referral', 'job_board', 'agency', 'internal', 'other'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const RECOMMENDATIONS = ['strong_yes', 'yes', 'no', 'strong_no'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** One interviewer's feedback. */
export interface InterviewFeedback {
  /** The interviewer. */
  by: string;
  at: string;
  /** The stage the feedback was given at. */
  stage: 'screening' | 'interview';
  /** 1 (poor) – 5 (excellent). */
  rating: number;
  recommendation: Recommendation;
  notes: string;
}

/** The offer made to a candidate. */
export interface CandidateOffer {
  salaryMinorUnits: number;
  currency: string;
  /** The proposed start date (`YYYY-MM-DD`). */
  startDate: string;
  status: 'extended' | 'accepted' | 'declined';
  extendedBy: string;
  extendedAt: string;
  respondedAt?: string;
  /** A note recorded with the candidate's answer. */
  responseNote?: string;
}

/** One recorded step of the candidate's history (append-only). */
export interface CandidateHistoryEntry {
  at: string;
  actorId: string;
  action: string;
  stage: CandidateStage;
  note?: string;
}

/** Input for adding a candidate to an opening. */
export interface AddCandidateInput {
  organizationId: TenantId;
  openingId: string;
  /** The opening's workspace (event scope). */
  workspaceId: WorkspaceId;
  name: string;
  email: string;
  phone?: string;
  source: CandidateSource;
  resumeNotes?: string;
  addedBy: string;
}

/** A persistence snapshot of the {@link Candidate}. */
export interface CandidateSnapshot {
  id: CandidateId;
  organizationId: TenantId;
  openingId: string;
  workspaceId: WorkspaceId;
  name: string;
  email: string;
  phone?: string;
  source: CandidateSource;
  resumeNotes?: string;
  stage: CandidateStage;
  feedback: readonly InterviewFeedback[];
  offer?: CandidateOffer;
  /** Why the candidate was rejected or withdrew. */
  closedReason?: string;
  /** The employee record created when the offer was accepted. */
  employeeId?: string;
  history: readonly CandidateHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string, path: string, detail: string): never {
  throw new InvalidEmployeeValueError(message, [{ path, message: detail }]);
}

function optionalText(value: string | undefined, path: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) fail('Text too long', path, `Must be at most ${max} characters`);
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The {@link Candidate} aggregate root. */
export class Candidate {
  #state: CandidateSnapshot;
  readonly #events: EventEnvelope[] = [];

  private constructor(snapshot: CandidateSnapshot) {
    this.#state = {
      ...snapshot,
      feedback: [...snapshot.feedback],
      history: [...snapshot.history],
      ...(snapshot.offer === undefined ? {} : { offer: { ...snapshot.offer } }),
    };
  }

  /** Adds a candidate to an opening, at `applied`. */
  static add(input: AddCandidateInput, context: RecruitingEventContext, now = nowIso()): Candidate {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (name.length < 2 || name.length > 160) {
      fail('Invalid candidate', 'name', 'Must be 2–160 characters');
    }
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      fail('Invalid candidate', 'email', 'Must be a valid email address');
    }
    if (!CANDIDATE_SOURCES.includes(input.source)) {
      fail('Invalid candidate', 'source', `Must be one of: ${CANDIDATE_SOURCES.join(', ')}`);
    }
    const phone = optionalText(input.phone, 'phone', 40);
    const resumeNotes = optionalText(input.resumeNotes, 'resumeNotes', 4000);
    const candidate = new Candidate({
      id: CandidateId.create(),
      organizationId: input.organizationId,
      openingId: input.openingId,
      workspaceId: input.workspaceId,
      name,
      email,
      ...(phone === undefined ? {} : { phone }),
      source: input.source,
      ...(resumeNotes === undefined ? {} : { resumeNotes }),
      stage: 'applied',
      feedback: [],
      history: [{ at: now, actorId: input.addedBy, action: 'added', stage: 'applied' }],
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    candidate.#emit(RECRUITING_EVENT_TYPES.candidateAdded, context);
    return candidate;
  }

  static hydrate(snapshot: CandidateSnapshot): Candidate {
    if (!CANDIDATE_STAGES.includes(snapshot.stage)) {
      fail('Invalid candidate stage', 'stage', `Must be one of: ${CANDIDATE_STAGES.join(', ')}`);
    }
    return new Candidate(snapshot);
  }

  static snapshot(candidate: Candidate): CandidateSnapshot {
    const state = candidate.#state;
    return {
      ...state,
      feedback: [...state.feedback],
      history: [...state.history],
      ...(state.offer === undefined ? {} : { offer: { ...state.offer } }),
    };
  }

  get id(): CandidateId {
    return this.#state.id;
  }
  get organizationId(): TenantId {
    return this.#state.organizationId;
  }
  get openingId(): string {
    return this.#state.openingId;
  }
  get name(): string {
    return this.#state.name;
  }
  get email(): string {
    return this.#state.email;
  }
  get stage(): CandidateStage {
    return this.#state.stage;
  }
  get offer(): CandidateOffer | undefined {
    return this.#state.offer === undefined ? undefined : { ...this.#state.offer };
  }
  get version(): number {
    return this.#state.version;
  }
  /** Whether the candidate is still in play (not hired, rejected or withdrawn). */
  get isActive(): boolean {
    return !TERMINAL.includes(this.#state.stage);
  }
  /** Whether an extended offer is waiting for the candidate's answer. */
  get hasOpenOffer(): boolean {
    return this.#state.stage === 'offer' && this.#state.offer?.status === 'extended';
  }
  /** The next pipeline stage, when the candidate can simply be moved forward. */
  get nextStage(): CandidateStage | undefined {
    const index = PIPELINE.indexOf(this.#state.stage);
    return index === -1 ? undefined : PIPELINE[index + 1];
  }

  /** Moves the candidate one step forward (applied → screening → interview). */
  advance(actorId: string, context: RecruitingEventContext, now = nowIso()): void {
    const next = this.nextStage;
    if (next === undefined) {
      throw new RecruitingStateError(
        this.#state.stage === 'interview'
          ? 'After the interview the next step is an offer'
          : 'This candidate cannot be moved forward',
        { stage: this.#state.stage },
      );
    }
    this.#move(next, actorId, 'advanced', undefined, now);
    this.#emit(RECRUITING_EVENT_TYPES.candidateStageChanged, context);
  }

  /** Records one interviewer's feedback (during screening or interview; once per stage). */
  recordFeedback(
    input: { by: string; rating: number; recommendation: Recommendation; notes: string },
    context: RecruitingEventContext,
    now = nowIso(),
  ): void {
    const stage = this.#state.stage;
    if (stage !== 'screening' && stage !== 'interview') {
      throw new RecruitingStateError(
        'Feedback is recorded while a candidate is being screened or interviewed',
        { stage },
      );
    }
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      fail('Invalid feedback', 'rating', 'Must be a whole number from 1 to 5');
    }
    if (!RECOMMENDATIONS.includes(input.recommendation)) {
      fail('Invalid feedback', 'recommendation', `Must be one of: ${RECOMMENDATIONS.join(', ')}`);
    }
    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
    if (notes.length < 5 || notes.length > 2000) {
      fail('Invalid feedback', 'notes', 'Write 5–2000 characters about the candidate');
    }
    if (this.#state.feedback.some((entry) => entry.by === input.by && entry.stage === stage)) {
      throw new RecruitingStateError('You already gave feedback on this candidate at this stage');
    }
    this.#state.feedback = [
      ...this.#state.feedback,
      {
        by: input.by,
        at: now,
        stage,
        rating: input.rating,
        recommendation: input.recommendation,
        notes,
      },
    ];
    this.#log(now, input.by, 'feedback');
    this.#touch(now);
    this.#emit(RECRUITING_EVENT_TYPES.feedbackRecorded, context);
  }

  /**
   * Extends an offer: only after the interview, only with interview feedback
   * on record, and only inside the salary range Finance approved.
   */
  extendOffer(
    input: { salaryMinorUnits: number; startDate: string; by: string },
    approved: { salaryMinMinorUnits: number; salaryMaxMinorUnits: number; currency: string },
    context: RecruitingEventContext,
    now = nowIso(),
  ): void {
    if (this.#state.stage !== 'interview') {
      throw new RecruitingStateError('An offer can only be made after the interview', {
        stage: this.#state.stage,
      });
    }
    if (!this.#state.feedback.some((entry) => entry.stage === 'interview')) {
      throw new RecruitingStateError('Record interview feedback before making an offer');
    }
    if (!Number.isInteger(input.salaryMinorUnits) || input.salaryMinorUnits < 0) {
      fail('Invalid offer', 'salaryMinorUnits', 'Must be a non-negative whole amount');
    }
    if (
      input.salaryMinorUnits < approved.salaryMinMinorUnits ||
      input.salaryMinorUnits > approved.salaryMaxMinorUnits
    ) {
      throw new RecruitingStateError(
        'The offer is outside the salary range approved for this hiring request',
        {
          approvedMinMinorUnits: approved.salaryMinMinorUnits,
          approvedMaxMinorUnits: approved.salaryMaxMinorUnits,
        },
      );
    }
    if (
      !DATE_PATTERN.test(input.startDate) ||
      Number.isNaN(Date.parse(`${input.startDate}T00:00:00.000Z`))
    ) {
      fail('Invalid offer', 'startDate', 'Must be a date (YYYY-MM-DD)');
    }
    this.#state.offer = {
      salaryMinorUnits: input.salaryMinorUnits,
      currency: approved.currency,
      startDate: input.startDate,
      status: 'extended',
      extendedBy: input.by,
      extendedAt: now,
    };
    this.#move('offer', input.by, 'offer_extended', undefined, now);
    this.#emit(RECRUITING_EVENT_TYPES.offerExtended, context);
  }

  /** The candidate accepted: they are hired. */
  acceptOffer(actorId: string, context: RecruitingEventContext, now = nowIso()): void {
    const offer = this.#openOffer();
    this.#state.offer = { ...offer, status: 'accepted', respondedAt: now };
    this.#move('hired', actorId, 'offer_accepted', undefined, now);
    this.#emit(RECRUITING_EVENT_TYPES.offerAccepted, context);
  }

  /** The candidate declined: they leave the pipeline. */
  declineOffer(
    actorId: string,
    note: string | undefined,
    context: RecruitingEventContext,
    now = nowIso(),
  ): void {
    const offer = this.#openOffer();
    const responseNote = optionalText(note, 'note', 500);
    this.#state.offer = {
      ...offer,
      status: 'declined',
      respondedAt: now,
      ...(responseNote === undefined ? {} : { responseNote }),
    };
    this.#state.closedReason = responseNote ?? 'Offer declined';
    this.#move('withdrawn', actorId, 'offer_declined', responseNote, now);
    this.#emit(RECRUITING_EVENT_TYPES.offerDeclined, context);
  }

  /** HR rejects the candidate (needs a reason). An open offer is rescinded. */
  reject(actorId: string, reason: string, context: RecruitingEventContext, now = nowIso()): void {
    this.#close('rejected', actorId, reason, context, now);
  }

  /** The candidate withdrew from the process (needs a reason). */
  withdraw(actorId: string, reason: string, context: RecruitingEventContext, now = nowIso()): void {
    this.#close('withdrawn', actorId, reason, context, now);
  }

  /** Links the employee record created for the hire. */
  linkEmployee(employeeId: string, now = nowIso()): void {
    if (this.#state.stage !== 'hired') {
      throw new RecruitingStateError('Only a hired candidate becomes an employee');
    }
    this.#state.employeeId = employeeId;
    this.#touch(now);
  }

  pullDomainEvents(): readonly EventEnvelope[] {
    return this.#events.splice(0);
  }

  #close(
    stage: 'rejected' | 'withdrawn',
    actorId: string,
    reason: string,
    context: RecruitingEventContext,
    now: string,
  ): void {
    if (!this.isActive) {
      throw new RecruitingStateError('This candidate is no longer in the process', {
        stage: this.#state.stage,
      });
    }
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < 3 || trimmed.length > 500) {
      fail('A reason is required', 'reason', 'Say why (3–500 characters)');
    }
    if (this.#state.offer?.status === 'extended') {
      this.#state.offer = { ...this.#state.offer, status: 'declined', respondedAt: now };
    }
    this.#state.closedReason = trimmed;
    this.#move(stage, actorId, stage, trimmed, now);
    this.#emit(RECRUITING_EVENT_TYPES.candidateStageChanged, context);
  }

  #openOffer(): CandidateOffer {
    const offer = this.#state.offer;
    if (this.#state.stage !== 'offer' || offer === undefined || offer.status !== 'extended') {
      throw new RecruitingStateError('There is no open offer for this candidate', {
        stage: this.#state.stage,
      });
    }
    return offer;
  }

  #move(
    stage: CandidateStage,
    actorId: string,
    action: string,
    note: string | undefined,
    now: string,
  ): void {
    this.#state.stage = stage;
    this.#log(now, actorId, action, note);
    this.#touch(now);
  }

  #log(now: string, actorId: string, action: string, note?: string): void {
    this.#state.history = [
      ...this.#state.history,
      {
        at: now,
        actorId,
        action,
        stage: this.#state.stage,
        ...(note === undefined ? {} : { note }),
      },
    ];
  }

  #touch(now: string): void {
    this.#state.updatedAt = now;
    this.#state.version += 1;
  }

  #emit(type: string, context: RecruitingEventContext): void {
    // No contact details and no amounts: the activity trail is read more widely.
    this.#events.push(
      recruitingEvent(type, context, this.#state.workspaceId, {
        candidateId: this.#state.id,
        openingId: this.#state.openingId,
        candidateName: this.#state.name,
        stage: this.#state.stage,
      }),
    );
  }
}
