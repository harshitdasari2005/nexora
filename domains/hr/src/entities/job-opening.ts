/**
 * @nexora/domain-hr — JobOpening aggregate root.
 *
 * The position HR opens once a hiring request has been approved by the chief
 * executive and by Finance. It carries what was approved (role, headcount,
 * salary range) and keeps the count that makes the approval binding:
 *
 *   offersOut + hiredCount ≤ headcount
 *
 * An offer RESERVES a seat (so two offers can never chase the last one), a
 * declined/withdrawn offer releases it, an accepted offer turns it into a
 * hire. When every approved seat is hired the opening is `filled`.
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
import { JobOpeningId } from '../value-objects/recruiting-ids.js';

export const JOB_OPENING_STATUSES = ['open', 'on_hold', 'filled', 'closed'] as const;
export type JobOpeningStatus = (typeof JOB_OPENING_STATUSES)[number];

/** What HR opens the position with (the approved request supplies the rest). */
export interface OpenJobInput {
  organizationId: TenantId;
  /** The approved hiring request this opening fulfils (one opening per request). */
  requisitionId: string;
  /** The team's workspace the request came from. */
  workspaceId: WorkspaceId;
  /** The person who raised the request — the hiring manager. */
  hiringManagerId: string;
  /** HR, who opens the position. */
  openedBy: string;
  title: string;
  department: string;
  headcount: number;
  employmentType: string;
  salaryMinMinorUnits: number;
  salaryMaxMinorUnits: number;
  currency: string;
  /** The posting text HR writes for candidates. */
  description: string;
}

/** A persistence snapshot of the {@link JobOpening}. */
export interface JobOpeningSnapshot extends OpenJobInput {
  id: JobOpeningId;
  status: JobOpeningStatus;
  /** Offers extended and not yet answered (each holds one seat). */
  offersOut: number;
  /** People hired into this opening. */
  hiredCount: number;
  /** Why the opening was closed, when it was. */
  closedReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** The {@link JobOpening} aggregate root. */
export class JobOpening {
  #state: JobOpeningSnapshot;
  readonly #events: EventEnvelope[] = [];

  private constructor(snapshot: JobOpeningSnapshot) {
    this.#state = { ...snapshot };
  }

  /** Opens a position for an approved hiring request. */
  static open(input: OpenJobInput, context: RecruitingEventContext, now = nowIso()): JobOpening {
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (description.length < 10 || description.length > 4000) {
      throw new InvalidEmployeeValueError('Invalid job posting', [
        { path: 'description', message: 'Describe the role in 10–4000 characters' },
      ]);
    }
    const opening = new JobOpening({
      ...input,
      description,
      id: JobOpeningId.create(),
      status: 'open',
      offersOut: 0,
      hiredCount: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    opening.#emit(RECRUITING_EVENT_TYPES.openingOpened, context);
    return opening;
  }

  static hydrate(snapshot: JobOpeningSnapshot): JobOpening {
    if (!JOB_OPENING_STATUSES.includes(snapshot.status)) {
      throw new InvalidEmployeeValueError('Invalid job opening status', [
        { path: 'status', message: `Must be one of: ${JOB_OPENING_STATUSES.join(', ')}` },
      ]);
    }
    return new JobOpening(snapshot);
  }

  static snapshot(opening: JobOpening): JobOpeningSnapshot {
    return { ...opening.#state };
  }

  get id(): JobOpeningId {
    return this.#state.id;
  }
  get organizationId(): TenantId {
    return this.#state.organizationId;
  }
  get workspaceId(): WorkspaceId {
    return this.#state.workspaceId;
  }
  get requisitionId(): string {
    return this.#state.requisitionId;
  }
  get hiringManagerId(): string {
    return this.#state.hiringManagerId;
  }
  get status(): JobOpeningStatus {
    return this.#state.status;
  }
  get version(): number {
    return this.#state.version;
  }
  /** Seats neither hired nor held by an open offer. */
  get seatsAvailable(): number {
    return this.#state.headcount - this.#state.hiredCount - this.#state.offersOut;
  }

  /** Whether new candidates can be added and moved along. */
  get isRecruiting(): boolean {
    return this.#state.status === 'open';
  }

  /** Pauses recruiting (`open` → `on_hold`). */
  hold(context: RecruitingEventContext, now = nowIso()): void {
    this.#require('open', 'put on hold');
    this.#state.status = 'on_hold';
    this.#touch(now);
    this.#emit(RECRUITING_EVENT_TYPES.openingStatusChanged, context);
  }

  /** Resumes recruiting (`on_hold` → `open`). */
  resume(context: RecruitingEventContext, now = nowIso()): void {
    this.#require('on_hold', 'resumed');
    this.#state.status = 'open';
    this.#touch(now);
    this.#emit(RECRUITING_EVENT_TYPES.openingStatusChanged, context);
  }

  /** Closes the opening without filling it (needs a reason; not while an offer is out). */
  close(reason: string, context: RecruitingEventContext, now = nowIso()): void {
    if (this.#state.status === 'filled' || this.#state.status === 'closed') {
      throw new RecruitingStateError('This job opening is already finished', {
        status: this.#state.status,
      });
    }
    if (this.#state.offersOut > 0) {
      throw new RecruitingStateError(
        'An offer is still waiting for an answer — resolve it before closing the opening',
      );
    }
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < 3 || trimmed.length > 500) {
      throw new InvalidEmployeeValueError('A reason is required to close an opening', [
        { path: 'reason', message: 'Say why the opening is being closed (3–500 characters)' },
      ]);
    }
    this.#state.status = 'closed';
    this.#state.closedReason = trimmed;
    this.#touch(now);
    this.#emit(RECRUITING_EVENT_TYPES.openingStatusChanged, context);
  }

  /** Holds one approved seat for an offer. */
  reserveOffer(now = nowIso()): void {
    this.#require('open', 'offered against');
    if (this.seatsAvailable < 1) {
      throw new RecruitingStateError(
        'Every approved position already has an offer out or a hire — no seat is left for another offer',
        { headcount: this.#state.headcount },
      );
    }
    this.#state.offersOut += 1;
    this.#touch(now);
  }

  /** Gives back a seat held by an offer that was declined, withdrawn or rescinded. */
  releaseOffer(now = nowIso()): void {
    if (this.#state.offersOut < 1) {
      throw new RecruitingStateError('No offer is holding a seat on this opening');
    }
    this.#state.offersOut -= 1;
    this.#touch(now);
  }

  /** Turns a held seat into a hire; fills the opening when the last seat is hired. */
  confirmHire(context: RecruitingEventContext, now = nowIso()): void {
    if (this.#state.offersOut < 1) {
      throw new RecruitingStateError('No offer is holding a seat on this opening');
    }
    this.#state.offersOut -= 1;
    this.#state.hiredCount += 1;
    if (this.#state.hiredCount >= this.#state.headcount) {
      this.#state.status = 'filled';
    }
    this.#touch(now);
    if (this.#state.status === 'filled') {
      this.#emit(RECRUITING_EVENT_TYPES.openingFilled, context);
    }
  }

  pullDomainEvents(): readonly EventEnvelope[] {
    return this.#events.splice(0);
  }

  #require(status: JobOpeningStatus, verb: string): void {
    if (this.#state.status !== status) {
      throw new RecruitingStateError(`This job opening cannot be ${verb} right now`, {
        status: this.#state.status,
      });
    }
  }

  #touch(now: string): void {
    this.#state.updatedAt = now;
    this.#state.version += 1;
  }

  #emit(type: string, context: RecruitingEventContext): void {
    this.#events.push(
      recruitingEvent(type, context, this.#state.workspaceId, {
        openingId: this.#state.id,
        requisitionId: this.#state.requisitionId,
        title: this.#state.title,
        status: this.#state.status,
        headcount: this.#state.headcount,
        hiredCount: this.#state.hiredCount,
      }),
    );
  }
}
