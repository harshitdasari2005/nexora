/**
 * @nexora/application-hr — OnboardingApplicationService.
 *
 * Takes a hired person from "offer accepted" to "ready to work": HR starts the
 * onboarding (the employee becomes `onboarding`), each part of the office
 * completes its own checklist items, and when the last item is done the
 * employee becomes `active` — only then can they be assigned to a project.
 *
 * Who may act for which item owner is the caller's concern (RBAC at the API
 * boundary); this service never reads a role.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import {
  EmployeeId,
  EmployeeNotFoundError,
  Onboarding,
  OnboardingId,
  OnboardingNotFoundError,
  OnboardingStateError,
  RecruitingConflictError,
  RequisitionId,
  type Employee,
  type EmployeeDomainService,
  type HiringRequisitionRepository,
  type OnboardingRepository,
  type RecruitingEventContext,
} from '@nexora/domain-hr';
import type { AtomicRunner } from './recruiting-application-service.js';

/** Dependencies of the {@link OnboardingApplicationService}. */
export interface OnboardingApplicationServiceDependencies {
  onboardings: OnboardingRepository;
  employeesService: EmployeeDomainService;
  requisitions: HiringRequisitionRepository;
  publisher: EventPublisher;
  /** Makes "checklist + employee status" one all-or-nothing step. */
  atomically?: AtomicRunner;
}

interface CommandBase {
  organizationId: TenantId;
  actorId: string;
  correlationId: string;
}

export interface StartOnboardingCommand extends CommandBase {
  employeeId: string;
}

export interface CompleteOnboardingItemCommand extends CommandBase {
  onboardingId: string;
  /** The checklist item key. */
  item: string;
  note?: string;
}

/** The onboarding application service. Every command returns a `Result`. */
export class OnboardingApplicationService {
  readonly #onboardings: OnboardingRepository;
  readonly #employees: EmployeeDomainService;
  readonly #requisitions: HiringRequisitionRepository;
  readonly #publisher: EventPublisher;
  readonly #atomically: AtomicRunner;

  constructor(dependencies: OnboardingApplicationServiceDependencies) {
    this.#atomically = dependencies.atomically ?? ((work) => work());
    this.#onboardings = dependencies.onboardings;
    this.#employees = dependencies.employeesService;
    this.#requisitions = dependencies.requisitions;
    this.#publisher = dependencies.publisher;
  }

  /** Starts onboarding a hired employee (`hired` → `onboarding`), once. */
  async start(command: StartOnboardingCommand): Promise<Result<Onboarding, NexoraError>> {
    return this.#run(async () => {
      const { onboarding, events } = await this.#atomically(async () => {
        const employee = await this.#requireEmployee(command.organizationId, command.employeeId);
        if (employee.status.value !== 'hired') {
          throw new OnboardingStateError('Onboarding starts once a person has been hired', {
            status: employee.status.value,
          });
        }
        // The hire came from a hiring request: its requester is the hiring manager.
        const requisitionId = employee.profile?.requisitionId;
        const requisition =
          requisitionId === undefined
            ? undefined
            : await this.#requisitions.findById(RequisitionId.from(requisitionId));
        if (requisition === undefined || requisition.organizationId !== command.organizationId) {
          throw new OnboardingStateError(
            'This employee was not hired through a hiring request, so there is no team to onboard them into',
          );
        }
        const projectId = requisition.details.projectId;
        const onboarding = Onboarding.start(
          {
            organizationId: command.organizationId,
            employeeId: employee.id,
            employeeName: employee.name.value,
            workspaceId: requisition.workspaceId,
            hiringManagerId: requisition.requestedBy,
            ...(projectId === undefined ? {} : { projectId }),
            startedBy: command.actorId,
          },
          context(command),
        );
        if (!(await this.#onboardings.insert(onboarding))) {
          throw new RecruitingConflictError(
            'Onboarding has already been started for this employee',
          );
        }
        const onboarded = await this.#employees.onboard(employee.id, employeeContext(command));
        if (!onboarded.ok) throw onboarded.error;
        return {
          onboarding,
          events: [...onboarding.pullDomainEvents(), ...onboarded.value.events],
        };
      });
      await this.#publisher.publish(events);
      return onboarding;
    });
  }

  /**
   * Marks a checklist item done. Completing the last one activates the
   * employee (`onboarding` → `active`).
   */
  async completeItem(
    command: CompleteOnboardingItemCommand,
  ): Promise<Result<Onboarding, NexoraError>> {
    return this.#run(async () => {
      const { onboarding, events } = await this.#atomically(async () => {
        const onboarding = await this.#require(command.organizationId, command.onboardingId);
        const loaded = onboarding.version;
        const finished = onboarding.completeItem(
          {
            key: command.item,
            actorId: command.actorId,
            ...(command.note === undefined ? {} : { note: command.note }),
          },
          context(command),
        );
        if (!(await this.#onboardings.update(onboarding, loaded))) {
          throw new RecruitingConflictError();
        }
        const events: EventEnvelope[] = [...onboarding.pullDomainEvents()];
        if (finished) {
          const activated = await this.#employees.activate(
            EmployeeId.from(onboarding.employeeId),
            employeeContext(command),
          );
          if (!activated.ok) throw activated.error;
          events.push(...activated.value.events);
        }
        return { onboarding, events };
      });
      await this.#publisher.publish(events);
      return onboarding;
    });
  }

  /** Lists the organization's onboardings, newest first. */
  list(organizationId: TenantId): Promise<readonly Onboarding[]> {
    return this.#onboardings.listByOrganization(organizationId);
  }

  /** Loads one onboarding inside the organization scope. */
  get(organizationId: TenantId, onboardingId: string): Promise<Result<Onboarding, NexoraError>> {
    return this.#run(() => this.#require(organizationId, onboardingId));
  }

  /** The onboarding of an employee, when they have one (tenant-scoped). */
  findForEmployee(organizationId: TenantId, employeeId: string): Promise<Onboarding | undefined> {
    return this.#onboardings.findByEmployee(organizationId, employeeId);
  }

  /** Hired employees whose onboarding has not been started yet. */
  async listReadyToStart(organizationId: TenantId): Promise<readonly Employee[]> {
    const [employees, onboardings] = await Promise.all([
      this.#employees.listByOrganization(organizationId),
      this.#onboardings.listByOrganization(organizationId),
    ]);
    const started = new Set(onboardings.map((onboarding) => onboarding.employeeId));
    return (employees.ok ? employees.value : []).filter(
      (employee) => employee.status.value === 'hired' && !started.has(employee.id),
    );
  }

  async #require(organizationId: TenantId, onboardingId: string): Promise<Onboarding> {
    let id: OnboardingId;
    try {
      id = OnboardingId.from(onboardingId);
    } catch {
      throw new OnboardingNotFoundError({ onboardingId });
    }
    const found = await this.#onboardings.findById(id);
    if (found === undefined || found.organizationId !== organizationId) {
      throw new OnboardingNotFoundError({ onboardingId });
    }
    return found;
  }

  async #requireEmployee(organizationId: TenantId, employeeId: string): Promise<Employee> {
    let id: EmployeeId;
    try {
      id = EmployeeId.from(employeeId);
    } catch {
      throw new EmployeeNotFoundError({ employeeId });
    }
    const found = await this.#employees.findById(id);
    if (!found.ok || found.value.organizationId !== organizationId) {
      throw new EmployeeNotFoundError({ employeeId });
    }
    return found.value;
  }

  async #run<T>(work: () => Promise<T>): Promise<Result<T, NexoraError>> {
    try {
      return ok(await work());
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected onboarding error'));
    }
  }
}

function context(command: CommandBase): RecruitingEventContext {
  return {
    actor: { kind: 'user', id: command.actorId },
    correlationId: command.correlationId,
    organizationId: command.organizationId,
  };
}

const employeeContext = (command: CommandBase) => ({
  actor: { kind: 'user' as const, id: command.actorId },
  correlationId: command.correlationId,
  organizationId: command.organizationId,
});
