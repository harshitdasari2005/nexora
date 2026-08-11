/**
 * @nexora/domain-organizations — OrganizationSlug value object.
 *
 * The URL-safe, globally unique handle of an {@link Organization} (used in
 * routing and public references). Uniqueness across the platform is a domain
 * contract enforced through the `SlugUniquenessPolicy` and the repository
 * port (unique index in the infrastructure layer).
 */

import { InvalidOrganizationValueError } from '../errors/index.js';

/** Slug literal pattern: lowercase alphanumeric segments separated by dashes. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Minimum slug length. */
export const MIN_SLUG_LENGTH = 3;

/** Maximum slug length. */
export const MAX_SLUG_LENGTH = 64;

/** A validated organization slug. Immutable. */
export class OrganizationSlug {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates an {@link OrganizationSlug} from a raw string.
   *
   * @param input - the raw slug (lowercased here).
   * @throws {InvalidOrganizationValueError} when the slug violates the pattern
   *         or length bounds.
   */
  static create(input: string): OrganizationSlug {
    const value = input.trim().toLowerCase();
    const issues: { path: string; message: string }[] = [];
    if (value.length < MIN_SLUG_LENGTH || value.length > MAX_SLUG_LENGTH) {
      issues.push({
        path: 'slug',
        message: `Must be between ${MIN_SLUG_LENGTH} and ${MAX_SLUG_LENGTH} characters`,
      });
    }
    if (!SLUG_PATTERN.test(value)) {
      issues.push({
        path: 'slug',
        message: 'Must be lowercase letters, digits, and dashes (e.g. acme-corp)',
      });
    }
    if (issues.length > 0) {
      throw new InvalidOrganizationValueError('Invalid organization slug', issues);
    }
    return new OrganizationSlug(value);
  }

  /** The normalized (lowercase) slug. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link OrganizationSlug}. */
  equals(other: OrganizationSlug): boolean {
    return this.#value === other.#value;
  }

  /** Returns the slug. */
  toString(): string {
    return this.#value;
  }
}
