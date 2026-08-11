/**
 * @nexora/persistence — scrypt PasswordHasher.
 *
 * Implements the Identity domain {@link PasswordHasher} port with Node's
 * built-in `crypto.scrypt` (SAD.md §13.6: one-way KDF; the infrastructure
 * layer supplies the implementation). Zero native dependencies. The encoded
 * hash format is `scrypt:<saltB64>:<hashB64>` carried in a
 * `PasswordHash('scrypt', …)` value object.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { PasswordHasher } from '@nexora/domain-identity';
import { PasswordHash } from '@nexora/domain-identity';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Key length in bytes (128-bit derived key). */
const KEY_LENGTH = 32;
/** Salt length in bytes (16 bytes = 128-bit salt). */
const SALT_LENGTH = 16;

/** Separates the algorithm tag from the salt and hash payload. */
const ENCODED_PREFIX = 'scrypt:';

/**
 * Hashes a plaintext password with scrypt and a fresh random salt.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  /** Hashes a plaintext password into a {@link PasswordHash}. */
  async hash(plain: string): Promise<PasswordHash> {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await scrypt(plain, salt, KEY_LENGTH);
    const encoded = `${ENCODED_PREFIX}${salt.toString('base64')}:${derived.toString('base64')}`;
    return PasswordHash.create('scrypt', encoded);
  }

  /** Verifies a plaintext password against a stored hash. */
  async verify(plain: string, hash: PasswordHash): Promise<boolean> {
    if (hash.algorithm !== 'scrypt') {
      return false;
    }
    const payload = hash.hash.startsWith(ENCODED_PREFIX)
      ? hash.hash.slice(ENCODED_PREFIX.length)
      : hash.hash;
    const [saltB64, hashB64] = payload.split(':');
    if (saltB64 === undefined || hashB64 === undefined) {
      return false;
    }
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(plain, salt, expected.length);
    return timingSafeEqual(derived, expected);
  }
}
