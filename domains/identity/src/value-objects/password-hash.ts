/**
 * @nexora/domain-identity — PasswordHash value object.
 *
 * The result of hashing a password with a one-way algorithm. Never holds
 * plaintext; the raw password exists only transiently in the caller.
 * Verification is delegated to a `PasswordHasher` port (the domain defines
 * the contract; the infrastructure layer supplies the implementation,
 * ENGINEERING_PLAYBOOK.md §10 secrets).
 */

import { InvalidIdentityValueError } from '../errors/index.js';

/** Password hashing algorithms the domain accepts (aligned with SAD.md §13). */
export const PASSWORD_ALGORITHMS = ['argon2id', 'bcrypt', 'scrypt', 'pbkdf2'] as const;

/** Single password-hashing algorithm literal. */
export type PasswordAlgorithm = (typeof PASSWORD_ALGORITHMS)[number];

/** A one-way password hash. Immutable. */
export class PasswordHash {
  readonly #algorithm: PasswordAlgorithm;
  readonly #hash: string;

  private constructor(algorithm: PasswordAlgorithm, hash: string) {
    this.#algorithm = algorithm;
    this.#hash = hash;
  }

  /**
   * Creates a {@link PasswordHash}.
   *
   * @param algorithm - the hashing algorithm used.
   * @param hash      - the encoded hash value.
   * @throws {InvalidIdentityValueError} when the hash is empty.
   */
  static create(algorithm: PasswordAlgorithm, hash: string): PasswordHash {
    if (hash.length === 0) {
      throw new InvalidIdentityValueError('Invalid password hash', [
        { path: 'passwordHash', message: 'Hash must not be empty' },
      ]);
    }
    return new PasswordHash(algorithm, hash);
  }

  /** The hashing algorithm. */
  get algorithm(): PasswordAlgorithm {
    return this.#algorithm;
  }

  /** The encoded hash value. */
  get hash(): string {
    return this.#hash;
  }

  /** Structural equality against another {@link PasswordHash}. */
  equals(other: PasswordHash): boolean {
    return this.#algorithm === other.#algorithm && this.#hash === other.#hash;
  }
}
