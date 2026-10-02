/**
 * @nexora/domain-hr — EmployeeDomainService.
 *
 * Orchestrates the {@link Employee} aggregate lifecycle (DOMAIN_MODEL.md
 * §14.1): creation, hiring, onboarding, activation, and cancellation. Owns
 * the use-case workflows that span the aggregate and its repository; the
 * aggregate enforces its own invariants. All methods return a `Result` so
 * expected failures are explicit values, not exceptions.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { TenantId } from '@nexora/contracts/common';

import { Employee, type EmployeeProfile } from '../entities/employee.js';
import type { EmployeeEventContext } from '../events/index.js';
import {
  EmployeeNotFoundError,
  toHrError,
  type EmployeeStateTransitionError,
  type InvalidEmployeeValueError,
} from '../errors/index.js';
import { EmployeeLifecyclePolicy, EmployeeValuePolicy } from '../policies/index.js';
import type { EmployeeRepository } from '../repositories/index.js';
import type { EmployeeId } from '../value-objects/employee-id.js';
import { EmployeeStatus } from '../value-objects/employee-status.js';

/** Input for creating an employee. */
export interface CreateEmployeeCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The employee name. */
  name: string;
  /** The employment details known at hire, when there are any. */
  profile?: EmployeeProfile;
}

/** The outcome of an employee command: the aggregate plus emitted events. */
export interface EmployeeCommandResult {
  /** The mutated aggregate. */
  employee: Employee;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** The outcome of an offboarding: the aggregate, its events, and whether it changed. */
export interface EmployeeOffboardResult extends EmployeeCommandResult {
  /** `false` when the employee was already offboarded (idempotent no-op). */
  changed: boolean;
}

/** Dependencies of the {@link EmployeeDomainService}. */
export interface EmployeeDomainServiceDependencies {
  /** Employee persistence. */
  employees: EmployeeRepository;
  /** Lifecycle policy (status transitions). */
  lifecycle?: EmployeeLifecyclePolicy;
}

/**
 * The employee lifecycle use-case service.
 */
export class EmployeeDomainService {
  readonly #employees: EmployeeRepository;
  readonly #lifecycle: EmployeeLifecyclePolicy;
  readonly #values: EmployeeValuePolicy;

  constructor(dependencies: EmployeeDomainServiceDependencies) {
    this.#employees = dependencies.employees;
    this.#lifecycle = dependencies.lifecycle ?? new EmployeeLifecyclePolicy();
    this.#values = new EmployeeValuePolicy();
  }

  /**
   * Creates an employee record: validates the input through the aggregate
   * factory, persists it in `proposed`, and returns the aggregate plus its
   * events.
   */
  async create(
    input: CreateEmployeeCommand,
    context: EmployeeEventContext,
  ): Promise<Result<EmployeeCommandResult, InvalidEmployeeValueError>> {
    try {
      // Policy pre-check (fail fast before any state exists) — the aggregate
      // factory re-validates through the value-object constructors, so this
      // is defense-in-depth, not the single enforcement point.
      this.#values.assertValidName(input.name);
      // The aggregate factory validates the name BEFORE any state exists — a
      // validation failure produces no aggregate and no mutation.
      const employee = Employee.create(
        {
          organizationId: input.organizationId,
          name: input.name,
          ...(input.profile === undefined ? {} : { profile: input.profile }),
        },
        context,
      );
      await this.#employees.save(employee);
      return ok({ employee, events: employee.pullDomainEvents() });
    } catch (error) {
      return err(toHrError(error) as InvalidEmployeeValueError);
    }
  }

  /**
   * Hires an employee (`proposed` → `hired` — offer accepted, EVT-1).
   */
  async hire(
    employeeId: EmployeeId,
    context: EmployeeEventContext,
  ): Promise<Result<EmployeeCommandResult, EmployeeNotFoundError | EmployeeStateTransitionError>> {
    try {
      const employee = await this.#requireEmployee(employeeId);
      this.#lifecycle.assertCanTransition(employee.status, EmployeeStatus.hired());
      employee.hire(context);
      await this.#employees.save(employee);
      return ok({ employee, events: employee.pullDomainEvents() });
    } catch (error) {
      return err(toHrError(error) as EmployeeNotFoundError | EmployeeStateTransitionError);
    }
  }

  /**
   * Starts onboarding (`hired` → `onboarding` — WRK-2).
   */
  async onboard(
    employeeId: EmployeeId,
    context: EmployeeEventContext,
  ): Promise<Result<EmployeeCommandResult, EmployeeNotFoundError | EmployeeStateTransitionError>> {
    try {
      const employee = await this.#requireEmployee(employeeId);
      this.#lifecycle.assertCanTransition(employee.status, EmployeeStatus.onboarding());
      employee.onboard(context);
      await this.#employees.save(employee);
      return ok({ employee, events: employee.pullDomainEvents() });
    } catch (error) {
      return err(toHrError(error) as EmployeeNotFoundError | EmployeeStateTransitionError);
    }
  }

  /**
   * Activates an employee (`onboarding` → `active` — checklist complete,
   * EVT-3). Only active employees are assignable (BR-16).
   */
  async activate(
    employeeId: EmployeeId,
    context: EmployeeEventContext,
  ): Promise<Result<EmployeeCommandResult, EmployeeNotFoundError | EmployeeStateTransitionError>> {
    try {
      const employee = await this.#requireEmployee(employeeId);
      this.#lifecycle.assertCanTransition(employee.status, EmployeeStatus.active());
      employee.activate(context);
      await this.#employees.save(employee);
      return ok({ employee, events: employee.pullDomainEvents() });
    } catch (error) {
      return err(toHrError(error) as EmployeeNotFoundError | EmployeeStateTransitionError);
    }
  }

  /**
   * Offboards an employee (`active | on_leave` → `exiting` → `offboarded`).
   * The record is retained — offboarding is the domain's supported way to end
   * an employment, never a delete.
   *
   * Idempotent: an already-offboarded employee returns `changed: false` with
   * no events, so a retried rollback never fails or double-emits. An
   * employee that cannot legally reach `offboarded` from its current status
   * (e.g. `proposed`, `hired`) yields a transition error — the caller must
   * treat that as "not safely reversible", never force it.
   */
  async offboard(
    employeeId: EmployeeId,
    reason: string,
    context: EmployeeEventContext,
  ): Promise<Result<EmployeeOffboardResult, EmployeeNotFoundError | EmployeeStateTransitionError>> {
    try {
      const employee = await this.#requireEmployee(employeeId);
      if (employee.status.value === 'offboarded') {
        return ok({ employee, events: [], changed: false });
      }
      if (employee.status.value !== 'exiting') {
        this.#lifecycle.assertCanTransition(employee.status, EmployeeStatus.exiting());
        employee.startOffboarding(context);
      }
      this.#lifecycle.assertCanTransition(employee.status, EmployeeStatus.offboarded());
      employee.offboard(context, reason);
      await this.#employees.save(employee);
      return ok({ employee, events: employee.pullDomainEvents(), changed: true });
    } catch (error) {
      return err(toHrError(error) as EmployeeNotFoundError | EmployeeStateTransitionError);
    }
  }

  /** Finds an employee by id, or returns a {@link EmployeeNotFoundError}. */
  async findById(employeeId: EmployeeId): Promise<Result<Employee, EmployeeNotFoundError>> {
    const employee = await this.#employees.findById(employeeId);
    if (employee === undefined) {
      return err(new EmployeeNotFoundError({ employeeId }));
    }
    return ok(employee);
  }

  /**
   * Resolves employees by name within an organization (tenant-scoped,
   * case-insensitive substring). Returns every candidate — the caller
   * decides between resolved (exactly one) and ambiguous (multiple) so no
   * guess is ever made (AI resolution contract).
   */
  async findByName(
    organizationId: TenantId,
    name: string,
  ): Promise<Result<readonly Employee[], never>> {
    return ok(await this.#employees.findByName(organizationId, name));
  }

  /** Lists the employees of an organization (tenant-scoped read). */
  async listByOrganization(organizationId: TenantId): Promise<Result<readonly Employee[], never>> {
    return ok(await this.#employees.listByOrganization(organizationId));
  }

  /** Loads an employee or throws {@link EmployeeNotFoundError}. */
  async #requireEmployee(employeeId: EmployeeId): Promise<Employee> {
    const employee = await this.#employees.findById(employeeId);
    if (employee === undefined) {
      throw new EmployeeNotFoundError({ employeeId });
    }
    return employee;
  }
}
