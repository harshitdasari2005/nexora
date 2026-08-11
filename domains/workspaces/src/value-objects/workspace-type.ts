/**
 * @nexora/domain-workspaces — WorkspaceType value object.
 *
 * The template kind of a {@link Workspace} (PSD.md WS-R4). Types are
 * preconfigured template packs (Apps + roles + starter workflows) and carry
 * **no special behavior** in the platform core — a "Finance Workspace" is not
 * treated differently by the core. `operations` is the default workspace type
 * (WS-R1 "Company Default").
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Workspace template types (PSD.md WS-R4). */
export const WORKSPACE_TYPES = [
  'operations',
  'engineering',
  'hr',
  'finance',
  'sales',
  'marketing',
  'executive',
  'general',
] as const;

/** Single workspace type literal. */
export type WorkspaceTypeValue = (typeof WORKSPACE_TYPES)[number];

/** The template type of a workspace. Immutable. */
export class WorkspaceType {
  readonly #value: WorkspaceTypeValue;

  private constructor(value: WorkspaceTypeValue) {
    this.#value = value;
  }

  /** Default operations template (WS-R1). */
  static operations(): WorkspaceType {
    return new WorkspaceType('operations');
  }

  /** Engineering template. */
  static engineering(): WorkspaceType {
    return new WorkspaceType('engineering');
  }

  /** Human resources template. */
  static hr(): WorkspaceType {
    return new WorkspaceType('hr');
  }

  /** Finance template. */
  static finance(): WorkspaceType {
    return new WorkspaceType('finance');
  }

  /** Sales template. */
  static sales(): WorkspaceType {
    return new WorkspaceType('sales');
  }

  /** Marketing template. */
  static marketing(): WorkspaceType {
    return new WorkspaceType('marketing');
  }

  /** Executive template. */
  static executive(): WorkspaceType {
    return new WorkspaceType('executive');
  }

  /** General-purpose template. */
  static general(): WorkspaceType {
    return new WorkspaceType('general');
  }

  /**
   * Creates a {@link WorkspaceType} from a raw string.
   *
   * @param value - one of {@link WORKSPACE_TYPES}.
   * @throws {InvalidWorkspaceValueError} when the value is unknown.
   */
  static from(value: string): WorkspaceType {
    const member = WORKSPACE_TYPES.find((type) => type === value);
    if (member === undefined) {
      throw new InvalidWorkspaceValueError('Invalid workspace type', [
        { path: 'type', message: `Must be one of: ${WORKSPACE_TYPES.join(', ')}` },
      ]);
    }
    return new WorkspaceType(member);
  }

  /** The type value. */
  get value(): WorkspaceTypeValue {
    return this.#value;
  }

  /** Structural equality against another {@link WorkspaceType}. */
  equals(other: WorkspaceType): boolean {
    return this.#value === other.#value;
  }

  /** Returns the type value. */
  toString(): string {
    return this.#value;
  }
}
