/**
 * @nexora/domain-hr — EmployeeStatus value object.
 *
 * The employment status of an {@link Employee} (DOMAIN_MODEL.md §14.1:
 * Proposed → Hired → Onboarding → Active ⇄ OnLeave → Exiting → Offboarded;
 * Proposed → Cancelled). Transitions are governed by the
 * `EmployeeLifecyclePolicy` (docs/BUSINESS_RULES.md).
 */

import { InvalidEmployeeValueError } from '../errors/index.js';

/** Employee lifecycle statuses (DOMAIN_MODEL.md §14.1). */
export const EMPLOYEE_STATUSES = [
  'proposed',
  'hired',
  'onboarding',
  'active',
  'on_leave',
  'exiting',
  'offboarded',
  'cancelled',
] as const;

/** Single employee status literal. */
export type EmployeeStatusValue = (typeof EMPLOYEE_STATUSES)[number];

/** The employment status of an employee. Immutable. */
export class EmployeeStatus {
  readonly #value: EmployeeStatusValue;

  private constructor(value: EmployeeStatusValue) {
    this.#value = value;
  }

  /** The offer is pending acceptance (EVT-1). */
  static proposed(): EmployeeStatus {
    return new EmployeeStatus('proposed');
  }

  /** The offer was accepted; the employee is hired (EVT-1). */
  static hired(): EmployeeStatus {
    return new EmployeeStatus('hired');
  }

  /** Onboarding has started (WRK-2). */
  static onboarding(): EmployeeStatus {
    return new EmployeeStatus('onboarding');
  }

  /** The employee is active and can be assigned work (EVT-3). */
  static active(): EmployeeStatus {
    return new EmployeeStatus('active');
  }

  /** Approved leave (BR-17). */
  static onLeave(): EmployeeStatus {
    return new EmployeeStatus('on_leave');
  }

  /** Offboarding was requested (WRK-3). */
  static exiting(): EmployeeStatus {
    return new EmployeeStatus('exiting');
  }

  /** Access revoked and final pay settled (EVT-4); terminal. */
  static offboarded(): EmployeeStatus {
    return new EmployeeStatus('offboarded');
  }

  /** The offer was declined (EVT-1); terminal. */
  static cancelled(): EmployeeStatus {
    return new EmployeeStatus('cancelled');
  }

  /**
   * Creates an {@link EmployeeStatus} from a raw string.
   *
   * @param value - one of {@link EMPLOYEE_STATUSES}.
   * @throws {InvalidEmployeeValueError} when the value is unknown.
   */
  static from(value: string): EmployeeStatus {
    const member = EMPLOYEE_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidEmployeeValueError('Invalid employee status', [
        { path: 'status', message: `Must be one of: ${EMPLOYEE_STATUSES.join(', ')}` },
      ]);
    }
    return new EmployeeStatus(member);
  }

  /** The status value. */
  get value(): EmployeeStatusValue {
    return this.#value;
  }

  /** Whether the employee is actively employed and assignable (BR-16). */
  isActive(): boolean {
    return this.#value === 'active';
  }

  /** Whether the status is terminal (offboarded/cancelled). */
  isTerminal(): boolean {
    return this.#value === 'offboarded' || this.#value === 'cancelled';
  }

  /** Structural equality against another {@link EmployeeStatus}. */
  equals(other: EmployeeStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
