/**
 * @nexora/application-identity — user DTO.
 *
 * The public representation of a user returned by queries and APIs. Kept
 * deliberately small: internal aggregates never cross module boundaries.
 */

import type { User } from '@nexora/domain-identity';

/** The public user representation. */
export interface UserDto {
  /** The user id. */
  id: string;
  /** The email address. */
  email: string;
  /** The login username. */
  username: string;
  /** The display name. */
  displayName: string;
  /** The lifecycle status (`pending` | `active` | `suspended` | `deactivated`). */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps a {@link User} aggregate to its {@link UserDto}. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email.value,
    username: user.username.value,
    displayName: user.profile.displayName.value,
    status: user.status.value,
    createdAt: user.createdAt,
  };
}
