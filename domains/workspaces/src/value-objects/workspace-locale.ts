/**
 * @nexora/domain-workspaces — WorkspaceLocale value object.
 *
 * The default locale of a {@link Workspace} (language tag: `en` or `en-US`).
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';

/** Locale pattern: `en` or `en-US`. */
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

/** A validated workspace locale. Immutable. */
export class WorkspaceLocale {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link WorkspaceLocale} from a raw string.
   *
   * @param input - a language tag like `en` or `en-US`.
   * @throws {InvalidWorkspaceValueError} when the value is not a valid tag.
   */
  static create(input: string): WorkspaceLocale {
    const value = input.trim();
    if (!LOCALE_PATTERN.test(value)) {
      throw new InvalidWorkspaceValueError('Invalid workspace locale', [
        { path: 'locale', message: 'Must be a locale like en or en-US' },
      ]);
    }
    return new WorkspaceLocale(value);
  }

  /** The locale value. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link WorkspaceLocale}. */
  equals(other: WorkspaceLocale): boolean {
    return this.#value === other.#value;
  }

  /** Returns the locale. */
  toString(): string {
    return this.#value;
  }
}
