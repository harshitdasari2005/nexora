/**
 * @nexora/domain-identity — session token hashing (AUTH-004).
 *
 * The session bearer token is a random, high-entropy value (a UUID v4: 122
 * random bits) that is handed ONLY to the client. The server persists and looks
 * up sessions by its SHA-256 digest, so a database or backup read yields
 * digests that cannot be presented as cookies and cannot be reversed. A fast
 * hash is the right tool here (and a password KDF is not): the input is
 * high-entropy, so brute force is infeasible, and the digest must support an
 * exact, indexed O(1) lookup on every authenticated request.
 */

import { createHash } from 'node:crypto';

/** The length of a stored session token digest (SHA-256, lowercase hex). */
export const SESSION_TOKEN_HASH_LENGTH = 64;

/** Hashes a raw session token to the representation that is persisted and indexed. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
