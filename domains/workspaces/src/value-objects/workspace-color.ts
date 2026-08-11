/**
 * @nexora/domain-workspaces — WorkspaceColor value object.
 *
 * The accent color of a {@link Workspace} used for branding (sidebar,
 * avatar, theming). Stored as a normalized lowercase `#rrggbb` hex value.
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Hex color pattern: `#rrggbb`. */
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** A validated workspace color. Immutable. */
export class WorkspaceColor {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link WorkspaceColor} from a raw string.
   *
   * @param input - a `#rrggbb` hex color (normalized to lowercase).
   * @throws {InvalidWorkspaceValueError} when the value is not a hex color.
   */
  static create(input: string): WorkspaceColor {
    const value = input.trim().toLowerCase();
    if (!COLOR_PATTERN.test(value)) {
      throw new InvalidWorkspaceValueError('Invalid workspace color', [
        { path: 'color', message: 'Must be a hex color like #4f46e5' },
      ]);
    }
    return new WorkspaceColor(value);
  }

  /** The normalized hex color. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link WorkspaceColor}. */
  equals(other: WorkspaceColor): boolean {
    return this.#value === other.#value;
  }

  /** Returns the hex color. */
  toString(): string {
    return this.#value;
  }
}
