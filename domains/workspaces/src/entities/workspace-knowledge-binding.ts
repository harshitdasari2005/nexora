/**
 * @nexora/domain-workspaces — WorkspaceKnowledgeBinding child entity.
 *
 * A record that a knowledge source belongs to a {@link Workspace} (PSD.md
 * §4.2 "Knowledge"; invariant: knowledge cannot exist without a workspace).
 * Owned by the Workspace aggregate as a collection keyed by knowledge id;
 * attach/detach emit `workspace.knowledge_attached` /
 * `workspace.knowledge_detached` via the aggregate.
 */

import { prefixedId } from '@nexora/shared/ids';

import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** A knowledge binding on a workspace. Immutable. */
export class WorkspaceKnowledgeBinding {
  readonly #id: string;
  readonly #workspaceId: WorkspaceId;
  readonly #knowledgeId: string;
  readonly #boundAt: string;

  private constructor(workspaceId: WorkspaceId, knowledgeId: string, boundAt: string) {
    this.#id = prefixedId('knb') as string;
    this.#workspaceId = workspaceId;
    this.#knowledgeId = knowledgeId;
    this.#boundAt = boundAt;
  }

  /** Creates a knowledge binding. */
  static create(
    workspaceId: WorkspaceId,
    knowledgeId: string,
    boundAt: string,
  ): WorkspaceKnowledgeBinding {
    return new WorkspaceKnowledgeBinding(workspaceId, knowledgeId, boundAt);
  }

  /** The binding id. */
  get id(): string {
    return this.#id;
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The attached knowledge source id. */
  get knowledgeId(): string {
    return this.#knowledgeId;
  }

  /** ISO-8601 UTC attach time. */
  get boundAt(): string {
    return this.#boundAt;
  }
}
