/**
 * @nexora/domain-workspaces — WorkspaceSearchBinding child entity.
 *
 * The active search provider of a {@link Workspace} (single-slot: attaching a
 * different provider replaces the current one, emitting
 * `workspace.search_provider_attached`; there is no detach event in the
 * catalog — you replace, not detach). Owned by the Workspace aggregate.
 */

import { prefixedId } from '@nexora/shared/ids';

import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** A search provider binding on a workspace. Immutable. */
export class WorkspaceSearchBinding {
  readonly #id: string;
  readonly #workspaceId: WorkspaceId;
  readonly #provider: string;
  readonly #boundAt: string;

  private constructor(workspaceId: WorkspaceId, provider: string, boundAt: string) {
    this.#id = prefixedId('srb') as string;
    this.#workspaceId = workspaceId;
    this.#provider = provider;
    this.#boundAt = boundAt;
  }

  /** Creates a search provider binding. */
  static create(
    workspaceId: WorkspaceId,
    provider: string,
    boundAt: string,
  ): WorkspaceSearchBinding {
    return new WorkspaceSearchBinding(workspaceId, provider, boundAt);
  }

  /** The binding id. */
  get id(): string {
    return this.#id;
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The search provider key. */
  get provider(): string {
    return this.#provider;
  }

  /** ISO-8601 UTC attach time. */
  get boundAt(): string {
    return this.#boundAt;
  }
}
