/**
 * @nexora/domain-workspaces — WorkspaceAgentBinding child entity.
 *
 * A record that an AI agent executes inside a {@link Workspace} (PSD.md
 * §4.2 "AI Agents"; invariant: every agent executes inside one workspace).
 * Owned by the Workspace aggregate as a collection keyed by agent id;
 * attach/detach emit `workspace.agent_bound` / `workspace.agent_unbound` via
 * the aggregate.
 */

import { prefixedId } from '@nexora/shared/ids';

import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** An agent binding on a workspace. Immutable. */
export class WorkspaceAgentBinding {
  readonly #id: string;
  readonly #workspaceId: WorkspaceId;
  readonly #agentId: string;
  readonly #boundAt: string;

  private constructor(workspaceId: WorkspaceId, agentId: string, boundAt: string) {
    this.#id = prefixedId('agb') as string;
    this.#workspaceId = workspaceId;
    this.#agentId = agentId;
    this.#boundAt = boundAt;
  }

  /** Creates an agent binding. */
  static create(workspaceId: WorkspaceId, agentId: string, boundAt: string): WorkspaceAgentBinding {
    return new WorkspaceAgentBinding(workspaceId, agentId, boundAt);
  }

  /** The binding id. */
  get id(): string {
    return this.#id;
  }

  /** The owning workspace. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The bound agent id. */
  get agentId(): string {
    return this.#agentId;
  }

  /** ISO-8601 UTC bind time. */
  get boundAt(): string {
    return this.#boundAt;
  }
}
