/**
 * @nexora/domain-workspaces — WorkspaceTimeZone value object.
 *
 * The default IANA timezone of a {@link Workspace}. Non-empty and bounded;
 * full IANA validation is delegated to the infrastructure/environment layer.
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Maximum timezone name length. */
export const MAX_TIME_ZONE_LENGTH = 64;

/** A validated workspace timezone. Immutable. */
export class WorkspaceTimeZone {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link WorkspaceTimeZone} from a raw string.
   *
   * @param input - an IANA timezone name (e.g. `UTC`, `Europe/Berlin`).
   * @throws {InvalidWorkspaceValueError} when the value is empty or too long.
   */
  static create(input: string): WorkspaceTimeZone {
    const value = input.trim();
    const issues: { path: string; message: string }[] = [];
    if (value.length === 0) {
      issues.push({ path: 'timezone', message: 'Must not be empty' });
    }
    if (value.length > MAX_TIME_ZONE_LENGTH) {
      issues.push({
        path: 'timezone',
        message: `Must be at most ${MAX_TIME_ZONE_LENGTH} characters`,
      });
    }
    if (issues.length > 0) {
      throw new InvalidWorkspaceValueError('Invalid workspace timezone', issues);
    }
    return new WorkspaceTimeZone(value);
  }

  /** The timezone value. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link WorkspaceTimeZone}. */
  equals(other: WorkspaceTimeZone): boolean {
    return this.#value === other.#value;
  }

  /** Returns the timezone. */
  toString(): string {
    return this.#value;
  }
}
