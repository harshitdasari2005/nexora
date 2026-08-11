/**
 * @nexora/domain-workspaces — WorkspaceIcon value object.
 *
 * The icon of a {@link Workspace}: a single emoji or a short icon key.
 * Non-empty, at most 8 characters, no whitespace (icons are rendered inline
 * in navigation).
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Maximum icon length (emoji or icon key). */
export const MAX_ICON_LENGTH = 8;

/** A validated workspace icon. Immutable. */
export class WorkspaceIcon {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link WorkspaceIcon} from a raw string.
   *
   * @param input - an emoji (e.g. `🧭`) or a short icon key (e.g. `rocket`).
   * @throws {InvalidWorkspaceValueError} when the value is empty, too long, or
   *         contains whitespace.
   */
  static create(input: string): WorkspaceIcon {
    const value = input.trim();
    const issues: { path: string; message: string }[] = [];
    if (value.length === 0 || value.length > MAX_ICON_LENGTH) {
      issues.push({
        path: 'icon',
        message: `Must be 1 to ${MAX_ICON_LENGTH} characters`,
      });
    }
    if (/\s/.test(value)) {
      issues.push({ path: 'icon', message: 'Must not contain whitespace' });
    }
    if (issues.length > 0) {
      throw new InvalidWorkspaceValueError('Invalid workspace icon', issues);
    }
    return new WorkspaceIcon(value);
  }

  /** The icon value. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link WorkspaceIcon}. */
  equals(other: WorkspaceIcon): boolean {
    return this.#value === other.#value;
  }

  /** Returns the icon. */
  toString(): string {
    return this.#value;
  }
}
