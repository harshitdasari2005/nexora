/**
 * @nexora/domain-workspaces — WorkspaceFeature child entity.
 *
 * A feature flag owned by a {@link Workspace} (e.g. `ai_autonomy`,
 * `guest_access`, `export`, `api_access`). The Workspace aggregate holds a
 * collection of features; toggles are silent mutations in v1 (the event
 * catalog has no feature events — documented in docs/BUSINESS_RULES.md).
 */

import { InvalidWorkspaceValueError } from '../errors/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** Feature name pattern: lowercase dotted segments with underscores. */
const FEATURE_NAME_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;

/** A feature flag on a workspace. Immutable except via toggle. */
export class WorkspaceFeature {
  readonly #workspaceId: WorkspaceId;
  readonly #name: string;
  #enabled: boolean;
  readonly #createdAt: string;
  #updatedAt: string;

  private constructor(workspaceId: WorkspaceId, name: string, enabled: boolean, now: string) {
    this.#workspaceId = workspaceId;
    this.#name = name;
    this.#enabled = enabled;
    this.#createdAt = now;
    this.#updatedAt = now;
  }

  /**
   * Creates a feature flag.
   *
   * @param workspaceId - the owning workspace.
   * @param name        - a lowercase dotted feature name.
   * @param enabled     - initial state.
   * @param now         - ISO-8601 UTC creation time.
   */
  static create(
    workspaceId: WorkspaceId,
    name: string,
    enabled: boolean,
    now: string,
  ): WorkspaceFeature {
    if (!FEATURE_NAME_PATTERN.test(name)) {
      throw new InvalidWorkspaceValueError('Invalid feature name', [
        { path: 'name', message: 'Must be lowercase dotted segments (e.g. ai_autonomy)' },
      ]);
    }
    return new WorkspaceFeature(workspaceId, name, enabled, now);
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The feature name. */
  get name(): string {
    return this.#name;
  }

  /** Whether the feature is enabled. */
  get enabled(): boolean {
    return this.#enabled;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last toggle. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /**
   * Enables the feature. A no-op when already enabled.
   *
   * @param now - ISO-8601 UTC mutation time.
   * @returns true when the state changed.
   */
  enable(now: string): boolean {
    if (this.#enabled) {
      return false;
    }
    this.#enabled = true;
    this.#updatedAt = now;
    return true;
  }

  /**
   * Disables the feature. A no-op when already disabled.
   *
   * @param now - ISO-8601 UTC mutation time.
   * @returns true when the state changed.
   */
  disable(now: string): boolean {
    if (!this.#enabled) {
      return false;
    }
    this.#enabled = false;
    this.#updatedAt = now;
    return true;
  }
}
