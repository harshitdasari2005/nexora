/**
 * @nexora/domain-workspaces — WorkspaceSlug value object.
 *
 * The URL-safe handle of a {@link Workspace}. Uniqueness is scoped **per
 * organization** (two companies may each have an `engineering` workspace), a
 * domain contract enforced through the repository port and a unique index in
 * the infrastructure layer.
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Slug literal pattern: lowercase alphanumeric segments separated by dashes. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Minimum slug length. */
export const MIN_SLUG_LENGTH = 3;

/** Maximum slug length. */
export const MAX_SLUG_LENGTH = 64;

/** A validated workspace slug. Immutable. */
export class WorkspaceSlug {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link WorkspaceSlug} from a raw string.
   *
   * @param input - the raw slug (lowercased here).
   * @throws {InvalidWorkspaceValueError} when the slug violates the pattern or
   *         length bounds.
   */
  static create(input: string): WorkspaceSlug {
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
        message: 'Must be lowercase letters, digits, and dashes (e.g. engineering)',
      });
    }
    if (issues.length > 0) {
      throw new InvalidWorkspaceValueError('Invalid workspace slug', issues);
    }
    return new WorkspaceSlug(value);
  }

  /** The normalized (lowercase) slug. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link WorkspaceSlug}. */
  equals(other: WorkspaceSlug): boolean {
    return this.#value === other.#value;
  }

  /** Returns the slug. */
  toString(): string {
    return this.#value;
  }
}
