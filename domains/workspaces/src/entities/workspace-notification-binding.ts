/**
 * @nexora/domain-workspaces — WorkspaceNotificationBinding child entity.
 *
 * The active notification provider of a {@link Workspace} (single-slot:
 * attaching a different provider replaces the current one, emitting
 * `workspace.notification_provider_attached`; there is no detach event in the
 * catalog — you replace, not detach). Owned by the Workspace aggregate.
 */

import { prefixedId } from '@nexora/shared/ids';

import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** A notification provider binding on a workspace. Immutable. */
export class WorkspaceNotificationBinding {
  readonly #id: string;
  readonly #workspaceId: WorkspaceId;
  readonly #provider: string;
  readonly #boundAt: string;

  private constructor(workspaceId: WorkspaceId, provider: string, boundAt: string) {
    this.#id = prefixedId('ntb') as string;
    this.#workspaceId = workspaceId;
    this.#provider = provider;
    this.#boundAt = boundAt;
  }

  /** Creates a notification provider binding. */
  static create(
    workspaceId: WorkspaceId,
    provider: string,
    boundAt: string,
  ): WorkspaceNotificationBinding {
    return new WorkspaceNotificationBinding(workspaceId, provider, boundAt);
  }

  /** The binding id. */
  get id(): string {
    return this.#id;
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The notification provider key. */
  get provider(): string {
    return this.#provider;
  }

  /** ISO-8601 UTC attach time. */
  get boundAt(): string {
    return this.#boundAt;
  }
}
