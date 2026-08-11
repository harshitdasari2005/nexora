/**
 * @nexora/domain-workspaces — WorkspaceVisibility value object.
 *
 * How discoverable/joinable a {@link Workspace} is within its organization.
 * Cross-company visibility never exists (R-03), so there is no `public`
 * scope: a workspace is either private (invite-only) or visible to the whole
 * company.
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Workspace visibility scopes. */
export const WORKSPACE_VISIBILITIES = ['private', 'company'] as const;

/** Single visibility literal. */
export type WorkspaceVisibilityValue = (typeof WORKSPACE_VISIBILITIES)[number];

/** The visibility scope of a workspace. Immutable. */
export class WorkspaceVisibility {
  readonly #value: WorkspaceVisibilityValue;

  private constructor(value: WorkspaceVisibilityValue) {
    this.#value = value;
  }

  /** The workspace is visible only to its members (invite-only). */
  static private(): WorkspaceVisibility {
    return new WorkspaceVisibility('private');
  }

  /** The workspace is visible and joinable by every member of the company. */
  static company(): WorkspaceVisibility {
    return new WorkspaceVisibility('company');
  }

  /**
   * Creates a {@link WorkspaceVisibility} from a raw string.
   *
   * @param value - one of {@link WORKSPACE_VISIBILITIES}.
   * @throws {InvalidWorkspaceValueError} when the value is unknown.
   */
  static from(value: string): WorkspaceVisibility {
    const member = WORKSPACE_VISIBILITIES.find((visibility) => visibility === value);
    if (member === undefined) {
      throw new InvalidWorkspaceValueError('Invalid workspace visibility', [
        {
          path: 'visibility',
          message: `Must be one of: ${WORKSPACE_VISIBILITIES.join(', ')}`,
        },
      ]);
    }
    return new WorkspaceVisibility(member);
  }

  /** The visibility value. */
  get value(): WorkspaceVisibilityValue {
    return this.#value;
  }

  /** Whether the workspace is invite-only. */
  isPrivate(): boolean {
    return this.#value === 'private';
  }

  /** Structural equality against another {@link WorkspaceVisibility}. */
  equals(other: WorkspaceVisibility): boolean {
    return this.#value === other.#value;
  }

  /** Returns the visibility value. */
  toString(): string {
    return this.#value;
  }
}
