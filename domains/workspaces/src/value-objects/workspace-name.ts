/**
 * @nexora/domain-workspaces — WorkspaceName value object.
 *
 * The human-readable name of a {@link Workspace}. Trimmed, non-empty, bounded
 * by the platform name limit (PSD.md §4; constants `MAX_NAME_LENGTH`).
 */

import { maxLength, required } from '@nexora/shared/validation';

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Maximum workspace name length (platform constant). */
export const MAX_WORKSPACE_NAME_LENGTH = 120;

/** A validated workspace name. Immutable. */
export class WorkspaceName {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link WorkspaceName} from a raw string.
   *
   * @param input - the raw name (trimmed here).
   * @throws {InvalidWorkspaceValueError} when the name is empty or too long.
   */
  static create(input: string): WorkspaceName {
    const value = input.trim();
    const issues: { path: string; message: string }[] = [];
    const requiredIssue = required('name', value);
    if (requiredIssue !== null) {
      issues.push(requiredIssue);
    }
    const lengthIssue = maxLength('name', value, MAX_WORKSPACE_NAME_LENGTH);
    if (lengthIssue !== null) {
      issues.push(lengthIssue);
    }
    if (issues.length > 0) {
      throw new InvalidWorkspaceValueError('Invalid workspace name', issues);
    }
    return new WorkspaceName(value);
  }

  /** The normalized (trimmed) workspace name. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link WorkspaceName}. */
  equals(other: WorkspaceName): boolean {
    return this.#value === other.#value;
  }

  /** Returns the name. */
  toString(): string {
    return this.#value;
  }
}
