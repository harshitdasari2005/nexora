/**
 * @nexora/module-notifications — ActivityItem read model.
 *
 * The Activity Feed is a READ MODEL derived from the canonical event stream.
 * It is disposable and rebuildable from events — it is never a second source
 * of truth (business domains remain authoritative; the event stream is the
 * source of truth). Items are workspace-scoped where the source event is
 * workspace-scoped, and every query is tenant + workspace gated.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

/** Input for recording a new {@link ActivityItem}. */
export interface CreateActivityItemInput {
  /** The tenant (organization) scope. */
  tenantId: TenantId;
  /** The workspace scope, when the source event is workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** The source event type, e.g. `workflow.completed`. */
  type: string;
  /** The user-facing activity title. */
  title: string;
  /** The user-facing activity body. */
  body: string;
  /** The acting user, when a user caused the event. */
  actorId?: string;
  /** The source event id (idempotency: one item per event). */
  sourceEventId: string;
  /** The correlation id of the originating execution. */
  correlationId: string;
}

/** A persistence snapshot of the {@link ActivityItem} read model. */
export interface ActivityItemSnapshot {
  /** The activity item id. */
  id: string;
  /** The tenant (organization) scope. */
  tenantId: TenantId;
  /** The workspace scope, when workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** The source event type. */
  type: string;
  /** The user-facing activity title. */
  title: string;
  /** The user-facing activity body. */
  body: string;
  /** The acting user, when a user caused the event. */
  actorId?: string;
  /** The source event id (idempotency key). */
  sourceEventId: string;
  /** The correlation id of the originating execution. */
  correlationId: string;
  /** ISO-8601 UTC time the activity occurred. */
  occurredAt: string;
}

/**
 * A single {@link ActivityItem} read-model record. Plain value record (no
 * lifecycle) — it mirrors one source event and is rebuilt from the stream.
 */
export class ActivityItem {
  #id: string;
  readonly #tenantId: TenantId;
  readonly #workspaceId?: WorkspaceId;
  readonly #type: string;
  readonly #title: string;
  readonly #body: string;
  readonly #actorId?: string;
  readonly #sourceEventId: string;
  readonly #correlationId: string;
  readonly #occurredAt: string;

  private constructor(input: CreateActivityItemInput & { occurredAt: string }) {
    this.#id = prefixedId('act');
    this.#tenantId = input.tenantId;
    this.#workspaceId = input.workspaceId;
    this.#type = input.type;
    this.#title = input.title;
    this.#body = input.body;
    this.#actorId = input.actorId;
    this.#sourceEventId = input.sourceEventId;
    this.#correlationId = input.correlationId;
    this.#occurredAt = input.occurredAt;
  }

  /** Creates an activity item from a source event. */
  static create(input: CreateActivityItemInput, occurredAt: string): ActivityItem {
    return new ActivityItem({ ...input, occurredAt });
  }

  /** Reconstitutes an item from a persisted snapshot. */
  static hydrate(snapshot: ActivityItemSnapshot): ActivityItem {
    const item = new ActivityItem({
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId,
      type: snapshot.type,
      title: snapshot.title,
      body: snapshot.body,
      actorId: snapshot.actorId,
      sourceEventId: snapshot.sourceEventId,
      correlationId: snapshot.correlationId,
      occurredAt: snapshot.occurredAt,
    });
    // The record identity is restored from the snapshot (a hydrated item is
    // the SAME read-model record, never a regenerated id).
    item.#id = snapshot.id;
    return item;
  }

  /** The activity item id. */
  get id(): string {
    return this.#id;
  }

  /** The tenant (organization) scope. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** The workspace scope, when workspace-scoped. */
  get workspaceId(): WorkspaceId | undefined {
    return this.#workspaceId;
  }

  /** The source event type. */
  get type(): string {
    return this.#type;
  }

  /** The user-facing activity title. */
  get title(): string {
    return this.#title;
  }

  /** The user-facing activity body. */
  get body(): string {
    return this.#body;
  }

  /** The acting user, when a user caused the event. */
  get actorId(): string | undefined {
    return this.#actorId;
  }

  /** The source event id (idempotency key). */
  get sourceEventId(): string {
    return this.#sourceEventId;
  }

  /** The correlation id of the originating execution. */
  get correlationId(): string {
    return this.#correlationId;
  }

  /** ISO-8601 UTC time the activity occurred. */
  get occurredAt(): string {
    return this.#occurredAt;
  }

  /** Produces a persistence snapshot. */
  static snapshot(item: ActivityItem): ActivityItemSnapshot {
    return {
      id: item.#id,
      tenantId: item.#tenantId,
      workspaceId: item.#workspaceId,
      type: item.#type,
      title: item.#title,
      body: item.#body,
      actorId: item.#actorId,
      sourceEventId: item.#sourceEventId,
      correlationId: item.#correlationId,
      occurredAt: item.#occurredAt,
    };
  }
}
