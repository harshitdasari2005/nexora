/**
 * @nexora/domain-identity — UserProfile entity.
 *
 * The profile data of a user, owned by the {@link User} aggregate (DDD.md §6
 * aggregate ownership). The profile has no lifecycle of its own: it is
 * created and updated through the User aggregate root.
 */

import type { UserId } from '@nexora/contracts/common';
import { nowIso } from '@nexora/shared/time';

import { DisplayName } from '../value-objects/display-name.js';

/** A profile update: display name plus optional title and bio. */
export interface UserProfileUpdate {
  /** New display name (required). */
  displayName: string;
  /** Optional job title. */
  title?: string;
  /** Optional bio. */
  bio?: string;
}

/**
 * Profile data owned by the {@link User} aggregate root.
 */
export class UserProfile {
  readonly #userId: UserId;
  #displayName: DisplayName;
  #title?: string;
  #bio?: string;
  #updatedAt: string;

  private constructor(userId: UserId, displayName: DisplayName, updatedAt: string) {
    this.#userId = userId;
    this.#displayName = displayName;
    this.#updatedAt = updatedAt;
  }

  /**
   * Creates a {@link UserProfile}.
   *
   * @param userId      - the owning user.
   * @param update      - the initial profile values.
   * @param updatedAt   - ISO-8601 UTC creation time (defaults to now).
   * @throws {InvalidIdentityValueError} when the display name is invalid.
   */
  static create(userId: UserId, update: UserProfileUpdate, updatedAt = nowIso()): UserProfile {
    const profile = new UserProfile(userId, DisplayName.create(update.displayName), updatedAt);
    profile.#title = update.title?.trim();
    profile.#bio = update.bio?.trim();
    return profile;
  }

  /** The owning user id. */
  get userId(): UserId {
    return this.#userId;
  }

  /** The display name. */
  get displayName(): DisplayName {
    return this.#displayName;
  }

  /** The optional job title. */
  get title(): string | undefined {
    return this.#title;
  }

  /** The optional bio. */
  get bio(): string | undefined {
    return this.#bio;
  }

  /** ISO-8601 UTC time of the last profile update. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /**
   * Applies a profile update. Replaces the display name and optional fields.
   *
   * @param update    - the new values.
   * @param updatedAt - ISO-8601 UTC update time (defaults to now).
   * @throws {InvalidIdentityValueError} when the display name is invalid.
   */
  update(update: UserProfileUpdate, updatedAt = nowIso()): void {
    this.#displayName = DisplayName.create(update.displayName);
    this.#title = update.title?.trim();
    this.#bio = update.bio?.trim();
    this.#updatedAt = updatedAt;
  }
}
