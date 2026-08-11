/**
 * @nexora/application-hr — EmployeeApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): it coordinates the
 * HR domain service, collects emitted domain events, and publishes them
 * through the {@link EventPublisher} port. It contains no business rules of
 * its own — every invariant is enforced by the domain.
 *
 * For this vertical slice the employee record is created and immediately
 * moved to `active` so it is assignable (BR-16); the hire/onboarding
 * workflows (WRK-2/3) are later sprints.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import type { EmployeeDomainService, EmployeeEventContext } from '@nexora/domain-hr';

import type {
  CreateEmployeeCommand,
  CreateEmployeeResult,
} from '../commands/create-employee.command.js';
import { toEmployeeDto, type EmployeeDto } from '../dto/employee.dto.js';
import { validateCreateEmployee } from '../validators/create-employee.validator.js';

/** Dependencies of the {@link EmployeeApplicationService}. */
export interface EmployeeApplicationServiceDependencies {
  /** The employee lifecycle domain service. */
  employeesService: EmployeeDomainService;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
}

/**
 * The HR application service. All methods return a `Result` so expected
 * failures are explicit values.
 */
export class EmployeeApplicationService {
  readonly #employeesService: EmployeeDomainService;
  readonly #publisher: EventPublisher;

  constructor(dependencies: EmployeeApplicationServiceDependencies) {
    this.#employeesService = dependencies.employeesService;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Creates an employee: drafts the record (`proposed`) and, in v1,
   * immediately moves it through hire → onboard → activate so it is
   * assignable (BR-16). Emitted events are published once, after the whole
   * sequence succeeds.
   */
  async createEmployee(
    command: CreateEmployeeCommand,
  ): Promise<Result<CreateEmployeeResult, NexoraError>> {
    try {
      validateCreateEmployee(command);
      const context = employeeContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );

      const created = await this.#employeesService.create(
        {
          organizationId: command.organizationId,
          name: command.name,
        },
        context,
      );
      if (!created.ok) {
        return err(created.error);
      }

      const employeeId = created.value.employee.id;
      const hired = await this.#employeesService.hire(employeeId, context);
      if (!hired.ok) {
        return err(hired.error);
      }
      const onboarded = await this.#employeesService.onboard(employeeId, context);
      if (!onboarded.ok) {
        return err(onboarded.error);
      }
      const activated = await this.#employeesService.activate(employeeId, context);
      if (!activated.ok) {
        return err(activated.error);
      }

      const events = [
        ...created.value.events,
        ...hired.value.events,
        ...onboarded.value.events,
        ...activated.value.events,
      ];
      await this.#publisher.publish(events);

      return ok({
        employee: activated.value.employee,
        events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected employee application error'));
    }
  }

  /**
   * Resolves employees by name within an organization (tenant-scoped,
   * case-insensitive substring). Returns every candidate — the caller
   * distinguishes resolved (exactly one) from ambiguous (multiple). The
   * organization is the trusted tenant scope — the AI and HTTP surfaces
   * both call this same path (one business execution path).
   */
  async findEmployeeByName(
    organizationId: TenantId,
    name: string,
  ): Promise<Result<readonly EmployeeDto[], never>> {
    const found = await this.#employeesService.findByName(organizationId, name);
    if (!found.ok) {
      return err(found.error);
    }
    return ok(found.value.map((employee) => toEmployeeDto(employee)));
  }

  /** Lists the employees of an organization (tenant-scoped read). */
  async listEmployeesByOrganization(
    organizationId: TenantId,
  ): Promise<Result<readonly EmployeeDto[], never>> {
    const listed = await this.#employeesService.listByOrganization(organizationId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((employee) => toEmployeeDto(employee)));
  }

  /**
   * Loads the employees referenced by a set of ids within an organization.
   * Tenant-scoped: ids outside the organization resolve to nothing, never
   * to foreign records.
   */
  async listEmployeesByIds(
    organizationId: TenantId,
    ids: readonly string[],
  ): Promise<Result<readonly EmployeeDto[], never>> {
    if (ids.length === 0) {
      return ok([]);
    }
    const listed = await this.#employeesService.listByOrganization(organizationId);
    if (!listed.ok) {
      return err(listed.error);
    }
    const wanted = new Set(ids);
    return ok(
      listed.value
        .filter((employee) => wanted.has(employee.id))
        .map((employee) => toEmployeeDto(employee)),
    );
  }
}

/** Builds an HR event context (tenant known to caller). */
function employeeContext(
  actorId: string,
  correlationId: string,
  organizationId: TenantId,
): EmployeeEventContext {
  return { actor: { kind: 'user', id: actorId }, correlationId, organizationId };
}
