/**
 * @nexora/domain-organizations — OrganizationName value object.
 *
 * The human-readable name of an {@link Organization} (a legal/customer entity
 * per PSD.md CO-2). Trimmed, non-empty, bounded by the platform name limit
 * (PSD.md §3; constants `MAX_NAME_LENGTH`).
 */

import { maxLength, required } from '@nexora/shared/validation';

import { InvalidOrganizationValueError } from '../errors/index.js';

/** Maximum organization name length (platform constant). */
export const MAX_ORGANIZATION_NAME_LENGTH = 120;

/** A validated organization name. Immutable. */
export class OrganizationName {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates an {@link OrganizationName} from a raw string.
   *
   * @param input - the raw name (trimmed here).
   * @throws {InvalidOrganizationValueError} when the name is empty or too long.
   */
  static create(input: string): OrganizationName {
    const value = input.trim();
    const issues: { path: string; message: string }[] = [];
    const requiredIssue = required('name', value);
    if (requiredIssue !== null) {
      issues.push(requiredIssue);
    }
    const lengthIssue = maxLength('name', value, MAX_ORGANIZATION_NAME_LENGTH);
    if (lengthIssue !== null) {
      issues.push(lengthIssue);
    }
    if (issues.length > 0) {
      throw new InvalidOrganizationValueError('Invalid organization name', issues);
    }
    return new OrganizationName(value);
  }

  /** The normalized (trimmed) organization name. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link OrganizationName}. */
  equals(other: OrganizationName): boolean {
    return this.#value === other.#value;
  }

  /** Returns the name. */
  toString(): string {
    return this.#value;
  }
}
