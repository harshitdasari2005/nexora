/**
 * @nexora/domain-workspaces — WorkspaceSettings child entity.
 *
 * The operational configuration of a {@link Workspace} (PSD.md §4.2), owned
 * by the Workspace aggregate. Mutable only through
 * {@link WorkspaceSettings.update}; values are validated *before* mutation so
 * a rejected update leaves the settings unchanged, and the mutation emits the
 * `workspace.settings_updated` event via the aggregate.
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';
import { WorkspaceLocale } from '../value-objects/workspace-locale.js';
import { WorkspaceTimeZone } from '../value-objects/workspace-time-zone.js';

/** Default settings applied at workspace creation. */
export const DEFAULT_WORKSPACE_SETTINGS = {
  defaultLocale: 'en',
  defaultTimezone: 'UTC',
  aiEnabled: true,
  guestAccessEnabled: false,
} as const;

/** Update for {@link WorkspaceSettings}. Every field is optional. */
export interface WorkspaceSettingsUpdate {
  /** Default locale, e.g. `en` or `en-US`. */
  defaultLocale?: string;
  /** Default IANA timezone, e.g. `UTC` or `Europe/Berlin`. */
  defaultTimezone?: string;
  /** Whether AI agents are enabled in the workspace. */
  aiEnabled?: boolean;
  /** Whether guests may be invited into the workspace. */
  guestAccessEnabled?: boolean;
}

/** The operational settings of a workspace. Immutable except via update. */
export class WorkspaceSettings {
  readonly #workspaceId: WorkspaceId;
  #defaultLocale: WorkspaceLocale;
  #defaultTimezone: WorkspaceTimeZone;
  #aiEnabled: boolean;
  #guestAccessEnabled: boolean;
  #updatedAt: string;

  private constructor(workspaceId: WorkspaceId, now: string) {
    this.#workspaceId = workspaceId;
    this.#defaultLocale = WorkspaceLocale.create(DEFAULT_WORKSPACE_SETTINGS.defaultLocale);
    this.#defaultTimezone = WorkspaceTimeZone.create(DEFAULT_WORKSPACE_SETTINGS.defaultTimezone);
    this.#aiEnabled = DEFAULT_WORKSPACE_SETTINGS.aiEnabled;
    this.#guestAccessEnabled = DEFAULT_WORKSPACE_SETTINGS.guestAccessEnabled;
    this.#updatedAt = now;
  }

  /**
   * Creates the default settings of a workspace.
   *
   * @param workspaceId - the owning workspace.
   * @param now         - ISO-8601 UTC creation time.
   */
  static create(workspaceId: WorkspaceId, now: string): WorkspaceSettings {
    return new WorkspaceSettings(workspaceId, now);
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** Default locale. */
  get defaultLocale(): WorkspaceLocale {
    return this.#defaultLocale;
  }

  /** Default timezone. */
  get defaultTimezone(): WorkspaceTimeZone {
    return this.#defaultTimezone;
  }

  /** Whether AI agents are enabled. */
  get aiEnabled(): boolean {
    return this.#aiEnabled;
  }

  /** Whether guests may be invited. */
  get guestAccessEnabled(): boolean {
    return this.#guestAccessEnabled;
  }

  /** ISO-8601 UTC time of the last settings change. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /**
   * Applies a partial update, validating every provided value *before*
   * mutating: a rejected update leaves the settings unchanged (no partial
   * writes on failure).
   *
   * @param update - the fields to change.
   * @param now    - ISO-8601 UTC mutation time.
   * @returns the changed top-level keys.
   * @throws {InvalidWorkspaceValueError} when a value is invalid.
   */
  update(update: WorkspaceSettingsUpdate, now: string): readonly string[] {
    // Validate first so a rejected update never mutates state.
    if (update.defaultLocale !== undefined) {
      WorkspaceLocale.create(update.defaultLocale);
    }
    if (update.defaultTimezone !== undefined) {
      WorkspaceTimeZone.create(update.defaultTimezone);
    }
    if (update.aiEnabled !== undefined && typeof update.aiEnabled !== 'boolean') {
      throw new InvalidWorkspaceValueError('Invalid workspace settings', [
        { path: 'aiEnabled', message: 'Must be a boolean' },
      ]);
    }
    if (update.guestAccessEnabled !== undefined && typeof update.guestAccessEnabled !== 'boolean') {
      throw new InvalidWorkspaceValueError('Invalid workspace settings', [
        { path: 'guestAccessEnabled', message: 'Must be a boolean' },
      ]);
    }

    const changed: string[] = [];
    if (update.defaultLocale !== undefined) {
      this.#defaultLocale = WorkspaceLocale.create(update.defaultLocale);
      changed.push('defaultLocale');
    }
    if (update.defaultTimezone !== undefined) {
      this.#defaultTimezone = WorkspaceTimeZone.create(update.defaultTimezone);
      changed.push('defaultTimezone');
    }
    if (update.aiEnabled !== undefined) {
      this.#aiEnabled = update.aiEnabled;
      changed.push('aiEnabled');
    }
    if (update.guestAccessEnabled !== undefined) {
      this.#guestAccessEnabled = update.guestAccessEnabled;
      changed.push('guestAccessEnabled');
    }
    if (changed.length > 0) {
      this.#updatedAt = now;
    }
    return changed;
  }
}
