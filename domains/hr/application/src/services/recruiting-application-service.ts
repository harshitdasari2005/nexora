/**
 * @nexora/application-hr — RecruitingApplicationService.
 *
 * HR's side of hiring, after the request has been approved by the chief
 * executive and by Finance: open the position, run candidates through the
 * pipeline, make an offer inside the approved terms, and turn an accepted
 * offer into an employee record.
 *
 * Two aggregates take part in an offer — the candidate and the opening's
 * seat count — and they are written in an order that fails safe:
 *
 * - extend:  reserve a seat on the opening FIRST (the cap is decided there,
 *            atomically); if the candidate write then fails, the seat is
 *            given back.
 * - accept:  the candidate FIRST (one answer wins, exactly once), then the
 *            held seat becomes a hire and the employee record is created.
 * - decline / reject / withdraw: the candidate first, then the seat is released.
 *
 * Authority (who may do which step) is the caller's concern (RBAC at the API
 * boundary); this service never reads a role.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import {
  Candidate,
  CandidateId,
  CandidateNotFoundError,
  JobOpening,
  JobOpeningId,
  JobOpeningNotFoundError,
  RecruitingConflictError,
  RecruitingStateError,
  RequisitionId,
  RequisitionNotFoundError,
  type CandidateRepository,
  type CandidateSource,
  type Employee,
  type EmployeeDomainService,
  type HiringRequisitionRepository,
  type JobOpeningRepository,
  type Recommendation,
  type RecruitingEventContext,
} from '@nexora/domain-hr';

/** How many times a seat-count change is retried when another change wins the race. */
const SEAT_RETRIES = 5;

/** Dependencies of the {@link RecruitingApplicationService}. */
/**
 * Runs a step so that everything it writes is kept together or not at all
 * (a database transaction in production). Events are published only after it
 * succeeded.
 */
export type AtomicRunner = <T>(work: () => Promise<T>) => Promise<T>;

export interface RecruitingApplicationServiceDependencies {
  openings: JobOpeningRepository;
  candidates: CandidateRepository;
  requisitions: HiringRequisitionRepository;
  employeesService: EmployeeDomainService;
  publisher: EventPublisher;
  /**
   * Makes the multi-record steps (offer, acceptance, decline, rejection)
   * all-or-nothing. Without it each write stands on its own.
   */
  atomically?: AtomicRunner;
}

interface CommandBase {
  /** The trusted organization (tenant) scope. */
  organizationId: TenantId;
  /** The acting user. */
  actorId: string;
  correlationId: string;
}

export interface OpenPositionCommand extends CommandBase {
  requisitionId: string;
  /** The posting text HR writes for candidates. */
  description: string;
}

export interface ChangeOpeningCommand extends CommandBase {
  openingId: string;
  action: 'hold' | 'resume' | 'close';
  /** Required when closing. */
  reason?: string;
}

export interface AddCandidateCommand extends CommandBase {
  openingId: string;
  name: string;
  email: string;
  phone?: string;
  source: CandidateSource;
  resumeNotes?: string;
}

export interface CandidateCommand extends CommandBase {
  candidateId: string;
}

export interface RecordFeedbackCommand extends CandidateCommand {
  rating: number;
  recommendation: Recommendation;
  notes: string;
}

export interface ExtendOfferCommand extends CandidateCommand {
  salaryMinorUnits: number;
  startDate: string;
}

export interface CloseCandidateCommand extends CandidateCommand {
  outcome: 'reject' | 'withdraw';
  reason: string;
}

/** The outcome of accepting an offer: the hired candidate and their new employee record. */
export interface AcceptOfferResult {
  candidate: Candidate;
  employee: Employee;
  opening: JobOpening;
}

/** The recruiting application service. Every command returns a `Result`. */
export class RecruitingApplicationService {
  readonly #openings: JobOpeningRepository;
  readonly #candidates: CandidateRepository;
  readonly #requisitions: HiringRequisitionRepository;
  readonly #employees: EmployeeDomainService;
  readonly #publisher: EventPublisher;
  readonly #atomically: AtomicRunner;
  /** A failed step is undone by the runner, so no manual give-back is needed. */
  readonly #atomic: boolean;

  constructor(dependencies: RecruitingApplicationServiceDependencies) {
    this.#atomic = dependencies.atomically !== undefined;
    this.#atomically = dependencies.atomically ?? ((work) => work());
    this.#openings = dependencies.openings;
    this.#candidates = dependencies.candidates;
    this.#requisitions = dependencies.requisitions;
    this.#employees = dependencies.employeesService;
    this.#publisher = dependencies.publisher;
  }

  // --- Openings -------------------------------------------------------------

  /** Opens the position for an APPROVED hiring request (one opening per request). */
  async openPosition(command: OpenPositionCommand): Promise<Result<JobOpening, NexoraError>> {
    return this.#run(async () => {
      let requisitionId: RequisitionId;
      try {
        requisitionId = RequisitionId.from(command.requisitionId);
      } catch {
        throw new RequisitionNotFoundError({ requisitionId: command.requisitionId });
      }
      const requisition = await this.#requisitions.findById(requisitionId);
      if (requisition === undefined || requisition.organizationId !== command.organizationId) {
        throw new RequisitionNotFoundError({ requisitionId: command.requisitionId });
      }
      if (requisition.status !== 'approved') {
        throw new RecruitingStateError(
          'A position can only be opened for a hiring request approved by the CEO and by Finance',
          { status: requisition.status },
        );
      }
      const details = requisition.details;
      const opening = JobOpening.open(
        {
          organizationId: command.organizationId,
          requisitionId: requisition.id,
          workspaceId: requisition.workspaceId,
          hiringManagerId: requisition.requestedBy,
          openedBy: command.actorId,
          title: details.jobTitle,
          department: details.department,
          headcount: details.headcount,
          employmentType: details.employmentType,
          salaryMinMinorUnits: details.salaryMinMinorUnits,
          salaryMaxMinorUnits: details.salaryMaxMinorUnits,
          currency: details.currency,
          description: command.description,
        },
        context(command),
      );
      if (!(await this.#openings.insert(opening))) {
        throw new RecruitingConflictError('This hiring request already has an open position');
      }
      await this.#publisher.publish(opening.pullDomainEvents());
      return opening;
    });
  }

  /** Puts an opening on hold, resumes it, or closes it without filling it. */
  async changeOpening(command: ChangeOpeningCommand): Promise<Result<JobOpening, NexoraError>> {
    return this.#run(async () => {
      const opening = await this.#requireOpening(command.organizationId, command.openingId);
      const loaded = opening.version;
      if (command.action === 'hold') opening.hold(context(command));
      else if (command.action === 'resume') opening.resume(context(command));
      else opening.close(command.reason ?? '', context(command));
      if (!(await this.#openings.update(opening, loaded))) throw new RecruitingConflictError();
      await this.#publisher.publish(opening.pullDomainEvents());
      return opening;
    });
  }

  /** Lists the organization's openings, newest first. */
  listOpenings(organizationId: TenantId): Promise<readonly JobOpening[]> {
    return this.#openings.listByOrganization(organizationId);
  }

  /** Loads one opening inside the organization scope. */
  getOpening(
    organizationId: TenantId,
    openingId: string,
  ): Promise<Result<JobOpening, NexoraError>> {
    return this.#run(() => this.#requireOpening(organizationId, openingId));
  }

  /** The opening created for a hiring request, when there is one. */
  findOpeningForRequisition(
    organizationId: TenantId,
    requisitionId: string,
  ): Promise<JobOpening | undefined> {
    return this.#openings.findByRequisition(organizationId, requisitionId);
  }

  // --- Candidates -----------------------------------------------------------

  /** Adds a candidate to an opening that is recruiting. */
  async addCandidate(command: AddCandidateCommand): Promise<Result<Candidate, NexoraError>> {
    return this.#run(async () => {
      const opening = await this.#requireOpening(command.organizationId, command.openingId);
      requireRecruiting(opening);
      const candidate = Candidate.add(
        {
          organizationId: command.organizationId,
          openingId: opening.id,
          workspaceId: opening.workspaceId,
          name: command.name,
          email: command.email,
          ...(command.phone === undefined ? {} : { phone: command.phone }),
          source: command.source,
          ...(command.resumeNotes === undefined ? {} : { resumeNotes: command.resumeNotes }),
          addedBy: command.actorId,
        },
        context(command),
      );
      await this.#candidates.insert(candidate);
      await this.#publisher.publish(candidate.pullDomainEvents());
      return candidate;
    });
  }

  /** Lists the candidates of one opening (oldest first). */
  async listCandidates(organizationId: TenantId, openingId: string): Promise<readonly Candidate[]> {
    return this.#candidates.listByOpening(organizationId, openingId);
  }

  /** Loads a candidate together with their opening, inside the organization scope. */
  getCandidate(
    organizationId: TenantId,
    candidateId: string,
  ): Promise<Result<{ candidate: Candidate; opening: JobOpening }, NexoraError>> {
    return this.#run(async () => {
      const candidate = await this.#requireCandidate(organizationId, candidateId);
      const opening = await this.#requireOpening(organizationId, candidate.openingId);
      return { candidate, opening };
    });
  }

  /** Moves a candidate one stage forward (applied → screening → interview). */
  advanceCandidate(command: CandidateCommand): Promise<Result<Candidate, NexoraError>> {
    return this.#changeCandidate(command, (candidate) =>
      candidate.advance(command.actorId, context(command)),
    );
  }

  /** Records the acting user's interview feedback. */
  recordFeedback(command: RecordFeedbackCommand): Promise<Result<Candidate, NexoraError>> {
    return this.#changeCandidate(command, (candidate) =>
      candidate.recordFeedback(
        {
          by: command.actorId,
          rating: command.rating,
          recommendation: command.recommendation,
          notes: command.notes,
        },
        context(command),
      ),
    );
  }

  /** Extends an offer inside the approved salary range, holding one approved seat. */
  async extendOffer(command: ExtendOfferCommand): Promise<Result<Candidate, NexoraError>> {
    return this.#run(async () => {
      const candidate = await this.#atomically(async () => {
        const candidate = await this.#requireCandidate(command.organizationId, command.candidateId);
        const opening = await this.#requireOpening(command.organizationId, candidate.openingId);
        requireRecruiting(opening);
        const loaded = candidate.version;
        const terms = JobOpening.snapshot(opening);
        // Validate the candidate-side rules BEFORE holding a seat.
        candidate.extendOffer(
          {
            salaryMinorUnits: command.salaryMinorUnits,
            startDate: command.startDate,
            by: command.actorId,
          },
          {
            salaryMinMinorUnits: terms.salaryMinMinorUnits,
            salaryMaxMinorUnits: terms.salaryMaxMinorUnits,
            currency: terms.currency,
          },
          context(command),
        );
        // The cap is decided here, atomically: no seat, no offer.
        await this.#changeSeats(command.organizationId, opening.id, (current) =>
          current.reserveOffer(),
        );
        if (!(await this.#candidates.update(candidate, loaded))) {
          // Someone changed the candidate meanwhile: the seat goes back (the
          // atomic runner undoes the reservation itself).
          if (!this.#atomic) {
            await this.#changeSeats(command.organizationId, opening.id, (current) =>
              current.releaseOffer(),
            );
          }
          throw new RecruitingConflictError();
        }
        return candidate;
      });
      await this.#publisher.publish(candidate.pullDomainEvents());
      return candidate;
    });
  }

  /** Records that the candidate accepted: they are hired and get an employee record. */
  async acceptOffer(command: CandidateCommand): Promise<Result<AcceptOfferResult, NexoraError>> {
    return this.#run(async () => {
      // The candidate, the seat and the employee record are one fact: either
      // all three are written or none is.
      const { events, result } = await this.#atomically(async () => {
        const candidate = await this.#requireCandidate(command.organizationId, command.candidateId);
        const loaded = candidate.version;
        candidate.acceptOffer(command.actorId, context(command));
        // The candidate first: of two simultaneous answers exactly one is recorded.
        if (!(await this.#candidates.update(candidate, loaded)))
          throw new RecruitingConflictError();
        const events: EventEnvelope[] = [...candidate.pullDomainEvents()];

        const opening = await this.#changeSeats(
          command.organizationId,
          JobOpeningId.from(candidate.openingId),
          (current) => current.confirmHire(context(command)),
        );
        events.push(...opening.pullDomainEvents());

        const terms = JobOpening.snapshot(opening);
        const employeeContext = {
          actor: { kind: 'user' as const, id: command.actorId },
          correlationId: command.correlationId,
          organizationId: command.organizationId,
        };
        const created = await this.#employees.create(
          {
            organizationId: command.organizationId,
            name: candidate.name,
            profile: {
              email: candidate.email,
              jobTitle: terms.title,
              department: terms.department,
              employmentType: terms.employmentType,
              ...(candidate.offer === undefined ? {} : { startDate: candidate.offer.startDate }),
              requisitionId: terms.requisitionId,
            },
          },
          employeeContext,
        );
        if (!created.ok) throw created.error;
        // `hired`: the offer is accepted. Onboarding and activation come next.
        const hired = await this.#employees.hire(created.value.employee.id, employeeContext);
        if (!hired.ok) throw hired.error;
        events.push(...created.value.events, ...hired.value.events);

        const afterAccept = candidate.version;
        candidate.linkEmployee(hired.value.employee.id);
        if (!(await this.#candidates.update(candidate, afterAccept))) {
          throw new RecruitingConflictError();
        }
        return { events, result: { candidate, employee: hired.value.employee, opening } };
      });
      await this.#publisher.publish(events);
      return result;
    });
  }

  /** Records that the candidate declined; the seat they held is free again. */
  async declineOffer(
    command: CandidateCommand & { note?: string },
  ): Promise<Result<Candidate, NexoraError>> {
    return this.#run(async () => {
      const candidate = await this.#atomically(async () => {
        const candidate = await this.#requireCandidate(command.organizationId, command.candidateId);
        const loaded = candidate.version;
        candidate.declineOffer(command.actorId, command.note, context(command));
        if (!(await this.#candidates.update(candidate, loaded)))
          throw new RecruitingConflictError();
        await this.#changeSeats(
          command.organizationId,
          JobOpeningId.from(candidate.openingId),
          (current) => current.releaseOffer(),
        );
        return candidate;
      });
      await this.#publisher.publish(candidate.pullDomainEvents());
      return candidate;
    });
  }

  /** Rejects a candidate, or records that they withdrew (an open offer is rescinded). */
  async closeCandidate(command: CloseCandidateCommand): Promise<Result<Candidate, NexoraError>> {
    return this.#run(async () => {
      const candidate = await this.#atomically(async () => {
        const candidate = await this.#requireCandidate(command.organizationId, command.candidateId);
        const loaded = candidate.version;
        const heldSeat = candidate.hasOpenOffer;
        if (command.outcome === 'reject') {
          candidate.reject(command.actorId, command.reason, context(command));
        } else {
          candidate.withdraw(command.actorId, command.reason, context(command));
        }
        if (!(await this.#candidates.update(candidate, loaded)))
          throw new RecruitingConflictError();
        if (heldSeat) {
          await this.#changeSeats(
            command.organizationId,
            JobOpeningId.from(candidate.openingId),
            (current) => current.releaseOffer(),
          );
        }
        return candidate;
      });
      await this.#publisher.publish(candidate.pullDomainEvents());
      return candidate;
    });
  }

  // --- internals ------------------------------------------------------------

  /** A pipeline change on a candidate whose opening is still recruiting. */
  #changeCandidate(
    command: CandidateCommand,
    mutate: (candidate: Candidate) => void,
  ): Promise<Result<Candidate, NexoraError>> {
    return this.#run(async () => {
      const candidate = await this.#requireCandidate(command.organizationId, command.candidateId);
      requireRecruiting(await this.#requireOpening(command.organizationId, candidate.openingId));
      const loaded = candidate.version;
      mutate(candidate);
      if (!(await this.#candidates.update(candidate, loaded))) throw new RecruitingConflictError();
      await this.#publisher.publish(candidate.pullDomainEvents());
      return candidate;
    });
  }

  /**
   * Applies a seat-count change to the opening, re-reading and retrying when
   * another change won the race (the rule is re-evaluated on fresh state each time).
   */
  async #changeSeats(
    organizationId: TenantId,
    openingId: JobOpeningId,
    change: (opening: JobOpening) => void,
  ): Promise<JobOpening> {
    for (let attempt = 0; attempt < SEAT_RETRIES; attempt += 1) {
      const opening = await this.#requireOpening(organizationId, openingId);
      const loaded = opening.version;
      change(opening);
      if (await this.#openings.update(opening, loaded)) return opening;
    }
    throw new RecruitingConflictError();
  }

  async #requireOpening(organizationId: TenantId, openingId: string): Promise<JobOpening> {
    let id: JobOpeningId;
    try {
      id = JobOpeningId.from(openingId);
    } catch {
      throw new JobOpeningNotFoundError({ openingId });
    }
    const found = await this.#openings.findById(id);
    if (found === undefined || found.organizationId !== organizationId) {
      throw new JobOpeningNotFoundError({ openingId });
    }
    return found;
  }

  async #requireCandidate(organizationId: TenantId, candidateId: string): Promise<Candidate> {
    let id: CandidateId;
    try {
      id = CandidateId.from(candidateId);
    } catch {
      throw new CandidateNotFoundError({ candidateId });
    }
    const found = await this.#candidates.findById(id);
    if (found === undefined || found.organizationId !== organizationId) {
      throw new CandidateNotFoundError({ candidateId });
    }
    return found;
  }

  async #run<T>(work: () => Promise<T>): Promise<Result<T, NexoraError>> {
    try {
      return ok(await work());
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected recruiting error'));
    }
  }
}

function requireRecruiting(opening: JobOpening): void {
  if (!opening.isRecruiting) {
    throw new RecruitingStateError('This job opening is not recruiting right now', {
      status: opening.status,
    });
  }
}

function context(command: CommandBase): RecruitingEventContext {
  return {
    actor: { kind: 'user', id: command.actorId },
    correlationId: command.correlationId,
    organizationId: command.organizationId,
  };
}
