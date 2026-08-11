/**
 * @nexora/domain-projects — ProjectStatus value object.
 *
 * The lifecycle status of a {@link Project} (DOMAIN_MODEL.md §14.2:
 * Proposed → Active → OnHold ⇄ Active → Completed → Archived; Cancelled from
 * Proposed/Active). Transitions are governed by the `ProjectLifecyclePolicy`
 * (docs/LIFECYCLE.md).
 */

import { InvalidProjectValueError } from '../errors/index.js';

/** Project lifecycle statuses (DOMAIN_MODEL.md §14.2). */
export const PROJECT_STATUSES = [
  'proposed',
  'active',
  'on_hold',
  'completed',
  'archived',
  'cancelled',
] as const;

/** Single project status literal. */
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number];

/** The lifecycle status of a project. Immutable. */
export class ProjectStatus {
  readonly #value: ProjectStatusValue;

  private constructor(value: ProjectStatusValue) {
    this.#value = value;
  }

  /** The project charter has been drafted; awaiting approval (WRK-4). */
  static proposed(): ProjectStatus {
    return new ProjectStatus('proposed');
  }

  /** The charter was approved; the project is being executed (WRK-4). */
  static active(): ProjectStatus {
    return new ProjectStatus('active');
  }

  /** Execution is paused by an authorized decision. */
  static onHold(): ProjectStatus {
    return new ProjectStatus('on_hold');
  }

  /** The owner closed the project; work is finished (EVT-9). */
  static completed(): ProjectStatus {
    return new ProjectStatus('completed');
  }

  /** The project was archived by retention policy; immutable. */
  static archived(): ProjectStatus {
    return new ProjectStatus('archived');
  }

  /** The project was cancelled before or during execution; terminal. */
  static cancelled(): ProjectStatus {
    return new ProjectStatus('cancelled');
  }

  /**
   * Creates a {@link ProjectStatus} from a raw string.
   *
   * @param value - one of {@link PROJECT_STATUSES}.
   * @throws {InvalidProjectValueError} when the value is unknown.
   */
  static from(value: string): ProjectStatus {
    const member = PROJECT_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidProjectValueError('Invalid project status', [
        { path: 'status', message: `Must be one of: ${PROJECT_STATUSES.join(', ')}` },
      ]);
    }
    return new ProjectStatus(member);
  }

  /** The status value. */
  get value(): ProjectStatusValue {
    return this.#value;
  }

  /** Whether the project is actively being executed (`active`). */
  isActive(): boolean {
    return this.#value === 'active';
  }

  /** Whether the project is in a terminal state (archived/cancelled). */
  isTerminal(): boolean {
    return this.#value === 'archived' || this.#value === 'cancelled';
  }

  /** Structural equality against another {@link ProjectStatus}. */
  equals(other: ProjectStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
