/**
 * @nexora/domain-workspaces — WorkspaceStatus value object.
 *
 * The lifecycle status of a {@link Workspace} (PSD.md WS-R5: Provisioned →
 * Active → Archived; `suspended` mirrors the tenancy model). Transitions are
 * governed by the `WorkspaceLifecyclePolicy` (docs/LIFECYCLE.md).
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Workspace lifecycle statuses (PSD.md WS-R5). */
export const WORKSPACE_STATUSES = ['provisioning', 'active', 'suspended', 'archived'] as const;

/** Single workspace status literal. */
export type WorkspaceStatusValue = (typeof WORKSPACE_STATUSES)[number];

/** The lifecycle status of a workspace. Immutable. */
export class WorkspaceStatus {
  readonly #value: WorkspaceStatusValue;

  private constructor(value: WorkspaceStatusValue) {
    this.#value = value;
  }

  /** The workspace is being provisioned (default Apps, roles, starter workflows). */
  static provisioning(): WorkspaceStatus {
    return new WorkspaceStatus('provisioning');
  }

  /** The workspace is fully operational. */
  static active(): WorkspaceStatus {
    return new WorkspaceStatus('active');
  }

  /** The workspace is temporarily frozen (no workflow execution, no new members). */
  static suspended(): WorkspaceStatus {
    return new WorkspaceStatus('suspended');
  }

  /** The workspace was archived; it is immutable and retains data and audit. */
  static archived(): WorkspaceStatus {
    return new WorkspaceStatus('archived');
  }

  /**
   * Creates a {@link WorkspaceStatus} from a raw string.
   *
   * @param value - one of {@link WORKSPACE_STATUSES}.
   * @throws {InvalidWorkspaceValueError} when the value is unknown.
   */
  static from(value: string): WorkspaceStatus {
    const member = WORKSPACE_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidWorkspaceValueError('Invalid workspace status', [
        { path: 'status', message: `Must be one of: ${WORKSPACE_STATUSES.join(', ')}` },
      ]);
    }
    return new WorkspaceStatus(member);
  }

  /** The status value. */
  get value(): WorkspaceStatusValue {
    return this.#value;
  }

  /** Whether the workspace is fully operational (status is `active`). */
  isActive(): boolean {
    return this.#value === 'active';
  }

  /** Structural equality against another {@link WorkspaceStatus}. */
  equals(other: WorkspaceStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
