/**
 * @nexora/module-notifications — NotificationPreferences aggregate.
 *
 * Per-user notification preferences (PSD.md §10 notification UX). Defaults
 * are safe: every category is enabled. Preferences affect presentation and
 * delivery only — disabling a category never disables the underlying
 * business action, and the AI is never the authority on preferences
 * (they are user + tenant scoped, mutated only through the application
 * layer from the authenticated user's own request).
 */

import type { NotificationPreferences as NotificationPreferencesContract } from '@nexora/contracts/notification';
import type { TenantId, UserId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { NOTIFICATION_CATEGORIES, type NotificationCategory } from './notification.js';

/** A persistence snapshot of the {@link NotificationPreferences} aggregate. */
export interface NotificationPreferencesSnapshot {
  /** The preferences id. */
  id: string;
  /** The owning user. */
  userId: UserId;
  /** The tenant (organization) scope. */
  tenantId: TenantId;
  /** Category → enabled map (a missing entry means enabled). */
  categories: Record<string, boolean>;
  /** ISO-8601 UTC last update time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link NotificationPreferences} aggregate root. Construct with
 * {@link NotificationPreferences.create}; mutate only through aggregate
 * methods so defaults stay safe.
 */
export class NotificationPreferences {
  #id: string;
  readonly #userId: UserId;
  readonly #tenantId: TenantId;
  #categories: Record<string, boolean>;
  #updatedAt: string;
  #version: number;

  private constructor(input: { userId: UserId; tenantId: TenantId }, now: string) {
    this.#id = prefixedId('ntp');
    this.#userId = input.userId;
    this.#tenantId = input.tenantId;
    // Safe defaults: every category enabled.
    this.#categories = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, true]));
    this.#updatedAt = now;
    this.#version = 1;
  }

  /** Creates preferences with every category enabled (safe defaults). */
  static create(
    input: { userId: UserId; tenantId: TenantId },
    now: string,
  ): NotificationPreferences {
    return new NotificationPreferences(input, now);
  }

  /** Reconstitutes preferences from a persisted snapshot. */
  static hydrate(snapshot: NotificationPreferencesSnapshot): NotificationPreferences {
    const preferences = new NotificationPreferences(
      { userId: snapshot.userId, tenantId: snapshot.tenantId },
      snapshot.updatedAt,
    );
    // The aggregate identity is restored from the snapshot (a hydrated
    // aggregate must be the SAME record).
    preferences.#id = snapshot.id;
    preferences.#categories = { ...snapshot.categories };
    preferences.#version = snapshot.version;
    return preferences;
  }

  /** The preferences id. */
  get id(): string {
    return this.#id;
  }

  /** The owning user. */
  get userId(): UserId {
    return this.#userId;
  }

  /** The tenant (organization) scope. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** Whether a category is enabled (missing entries default to enabled). */
  isEnabled(category: NotificationCategory): boolean {
    return this.#categories[category] ?? true;
  }

  /**
   * Sets whether a category is enabled (validate → mutate). Only known
   * categories are accepted — an unknown category never silently widens
   * delivery. Returns true when the value changed.
   */
  setCategory(category: NotificationCategory, enabled: boolean, now: string): boolean {
    if (!NOTIFICATION_CATEGORIES.includes(category)) {
      return false;
    }
    if ((this.#categories[category] ?? true) === enabled) {
      return false;
    }
    this.#categories[category] = enabled;
    this.#updatedAt = now;
    this.#version += 1;
    return true;
  }

  /** The contract shape of the current preferences. */
  toContract(): NotificationPreferencesContract {
    return {
      userId: this.#userId,
      tenantId: this.#tenantId,
      categories: { ...this.#categories },
      updatedAt: this.#updatedAt,
    };
  }

  /** Produces a persistence snapshot. */
  static snapshot(preferences: NotificationPreferences): NotificationPreferencesSnapshot {
    return {
      id: preferences.#id,
      userId: preferences.#userId,
      tenantId: preferences.#tenantId,
      categories: { ...preferences.#categories },
      updatedAt: preferences.#updatedAt,
      version: preferences.#version,
    };
  }
}
