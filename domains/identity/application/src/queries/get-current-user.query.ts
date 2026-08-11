/**
 * @nexora/application-identity — GetCurrentUser query.
 *
 * Reads the public representation of the authenticated user (CQRS read
 * side; BACKEND.md §8).
 */

import type { UserId } from '@nexora/contracts/common';

import type { UserDto } from '../dto/user.dto.js';

/** Resolves the current user by id. */
export interface GetCurrentUserQuery {
  /** The user id to resolve. */
  userId: UserId;
}

/** The result of {@link GetCurrentUserQuery}. */
export type GetCurrentUserResult = UserDto;
