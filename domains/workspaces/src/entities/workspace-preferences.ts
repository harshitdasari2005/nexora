/**
 * @nexora/domain-workspaces — WorkspacePreferences child entity.
 *
 * The display preferences of a {@link Workspace} (theme, density), owned by
 * the Workspace aggregate. Mutable only through
 * {@link WorkspacePreferences.update}. The event catalog has no
 * `preferences_updated` event in v1, so preference changes are silent
 * mutations (documented in docs/BUSINESS_RULES.md).
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** Supported themes. */
export const WORKSPACE_THEMES = ['light', 'dark', 'system'] as const;

/** Supported density modes. */
export const WORKSPACE_DENSITIES = ['comfortable', 'compact'] as const;

/** Default preferences applied at workspace creation. */
export const DEFAULT_WORKSPACE_PREFERENCES = {
  theme: 'system',
  density: 'comfortable',
} as const;

/** Update for {@link WorkspacePreferences}. Every field is optional. */
export interface WorkspacePreferencesUpdate {
  /** Theme preference. */
  theme?: (typeof WORKSPACE_THEMES)[number];
  /** UI density. */
  density?: (typeof WORKSPACE_DENSITIES)[number];
}

/** The display preferences of a workspace. Immutable except via update. */
export class WorkspacePreferences {
  readonly #workspaceId: WorkspaceId;
  #theme: (typeof WORKSPACE_THEMES)[number];
  #density: (typeof WORKSPACE_DENSITIES)[number];
  #updatedAt: string;

  private constructor(workspaceId: WorkspaceId, now: string) {
    this.#workspaceId = workspaceId;
    this.#theme = DEFAULT_WORKSPACE_PREFERENCES.theme;
    this.#density = DEFAULT_WORKSPACE_PREFERENCES.density;
    this.#updatedAt = now;
  }

  /**
   * Creates the default preferences of a workspace.
   *
   * @param workspaceId - the owning workspace.
   * @param now         - ISO-8601 UTC creation time.
   */
  static create(workspaceId: WorkspaceId, now: string): WorkspacePreferences {
    return new WorkspacePreferences(workspaceId, now);
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** Theme preference. */
  get theme(): (typeof WORKSPACE_THEMES)[number] {
    return this.#theme;
  }

  /** UI density. */
  get density(): (typeof WORKSPACE_DENSITIES)[number] {
    return this.#density;
  }

  /** ISO-8601 UTC time of the last preference change. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /**
   * Applies a partial update, validating every provided value *before*
   * mutating.
   *
   * @param update - the fields to change.
   * @param now    - ISO-8601 UTC mutation time.
   * @throws {InvalidWorkspaceValueError} when a value is invalid.
   */
  update(update: WorkspacePreferencesUpdate, now: string): readonly string[] {
    const issues: { path: string; message: string }[] = [];
    if (update.theme !== undefined && !WORKSPACE_THEMES.includes(update.theme)) {
      issues.push({ path: 'theme', message: `Must be one of: ${WORKSPACE_THEMES.join(', ')}` });
    }
    if (update.density !== undefined && !WORKSPACE_DENSITIES.includes(update.density)) {
      issues.push({
        path: 'density',
        message: `Must be one of: ${WORKSPACE_DENSITIES.join(', ')}`,
      });
    }
    if (issues.length > 0) {
      throw new InvalidWorkspaceValueError('Invalid workspace preferences', issues);
    }

    const changed: string[] = [];
    if (update.theme !== undefined) {
      this.#theme = update.theme;
      changed.push('theme');
    }
    if (update.density !== undefined) {
      this.#density = update.density;
      changed.push('density');
    }
    if (changed.length > 0) {
      this.#updatedAt = now;
    }
    return changed;
  }
}
