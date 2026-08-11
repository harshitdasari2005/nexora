/**
 * @nexora/domain-workspaces — WorkspaceWorkflowBinding child entity.
 *
 * A record that a workflow template belongs to a {@link Workspace} (PSD.md
 * §4.2 "Workflows"). Owned by the Workspace aggregate as a collection keyed
 * by workflow id; attach/detach emit `workspace.workflow_attached` /
 * `workspace.workflow_detached` via the aggregate. A suspended workspace
 * cannot execute workflows (`WorkspaceLifecyclePolicy`).
 */

import { prefixedId } from '@nexora/shared/ids';

import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** A workflow binding on a workspace. Immutable. */
export class WorkspaceWorkflowBinding {
  readonly #id: string;
  readonly #workspaceId: WorkspaceId;
  readonly #workflowId: string;
  readonly #boundAt: string;

  private constructor(workspaceId: WorkspaceId, workflowId: string, boundAt: string) {
    this.#id = prefixedId('wfb') as string;
    this.#workspaceId = workspaceId;
    this.#workflowId = workflowId;
    this.#boundAt = boundAt;
  }

  /** Creates a workflow binding. */
  static create(
    workspaceId: WorkspaceId,
    workflowId: string,
    boundAt: string,
  ): WorkspaceWorkflowBinding {
    return new WorkspaceWorkflowBinding(workspaceId, workflowId, boundAt);
  }

  /** The binding id. */
  get id(): string {
    return this.#id;
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The attached workflow id. */
  get workflowId(): string {
    return this.#workflowId;
  }

  /** ISO-8601 UTC attach time. */
  get boundAt(): string {
    return this.#boundAt;
  }
}
