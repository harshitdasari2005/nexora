/**
 * @nexora/domain-workspaces — WorkspaceBranding child entity.
 *
 * The visual identity of a {@link Workspace} (accent color, icon), owned by
 * the Workspace aggregate. Mutable only through
 * {@link WorkspaceBranding.update}; values are validated *before* mutation
 * and the mutation emits the `workspace.branding_updated` event via the
 * aggregate.
 */

import type { WorkspaceId } from '../value-objects/workspace-id.js';
import { WorkspaceColor } from '../value-objects/workspace-color.js';
import { WorkspaceIcon } from '../value-objects/workspace-icon.js';

/** Default branding applied at workspace creation. */
export const DEFAULT_WORKSPACE_BRANDING = {
  color: '#4f46e5',
  icon: '🧭',
} as const;

/** Update for {@link WorkspaceBranding}. Every field is optional. */
export interface WorkspaceBrandingUpdate {
  /** Accent color as a `#rrggbb` hex value. */
  color?: string;
  /** An emoji or short icon key. */
  icon?: string;
}

/** The visual identity of a workspace. Immutable except via update. */
export class WorkspaceBranding {
  readonly #workspaceId: WorkspaceId;
  #color: WorkspaceColor;
  #icon: WorkspaceIcon;
  #updatedAt: string;

  private constructor(workspaceId: WorkspaceId, now: string) {
    this.#workspaceId = workspaceId;
    this.#color = WorkspaceColor.create(DEFAULT_WORKSPACE_BRANDING.color);
    this.#icon = WorkspaceIcon.create(DEFAULT_WORKSPACE_BRANDING.icon);
    this.#updatedAt = now;
  }

  /**
   * Creates the default branding of a workspace.
   *
   * @param workspaceId - the owning workspace.
   * @param now         - ISO-8601 UTC creation time.
   */
  static create(workspaceId: WorkspaceId, now: string): WorkspaceBranding {
    return new WorkspaceBranding(workspaceId, now);
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The accent color. */
  get color(): WorkspaceColor {
    return this.#color;
  }

  /** The icon. */
  get icon(): WorkspaceIcon {
    return this.#icon;
  }

  /** ISO-8601 UTC time of the last branding change. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /**
   * Applies a partial update, validating every provided value *before*
   * mutating.
   *
   * @param update - the fields to change.
   * @param now    - ISO-8601 UTC mutation time.
   * @returns the changed top-level keys.
   * @throws {InvalidWorkspaceValueError} when a value is invalid.
   */
  update(update: WorkspaceBrandingUpdate, now: string): readonly string[] {
    // Validate first so a rejected update never mutates state.
    if (update.color !== undefined) {
      WorkspaceColor.create(update.color);
    }
    if (update.icon !== undefined) {
      WorkspaceIcon.create(update.icon);
    }

    const changed: string[] = [];
    if (update.color !== undefined) {
      this.#color = WorkspaceColor.create(update.color);
      changed.push('color');
    }
    if (update.icon !== undefined) {
      this.#icon = WorkspaceIcon.create(update.icon);
      changed.push('icon');
    }
    if (changed.length > 0) {
      this.#updatedAt = now;
    }
    return changed;
  }
}
