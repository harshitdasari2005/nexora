/**
 * @nexora/module-notifications — Notification aggregate root.
 *
 * A notification is the per-recipient projection of a business event (the
 * Notification platform is a CONSUMER of the event stream — it never owns
 * business state). The aggregate carries its recipient and scope explicitly:
 * every read/write is gated by the trusted recipient + tenant, and the
 * recipient is ALWAYS the server-derived event actor — never a value the
 * model, a client, or an event payload can choose.
 *
 * Lifecycle: `unread → read` (dismiss is an app-level read-model flag; the
 * authoritative business event stream is never mutated). All state changes
 * flow through aggregate methods which enforce invariants and record domain
 * events (validate → mutate → event).
 */

import type { NotificationPriority } from '@nexora/contracts/notification';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

/** The read state of a notification in the recipient's inbox. */
export type NotificationReadState = 'unread' | 'read';

/** Notification category (drives preference toggles and UX grouping). */
export type NotificationCategory =
  | 'workflow'
  | 'approval'
  | 'project'
  | 'employee'
  | 'document'
  | 'knowledge'
  | 'calendar'
  | 'system';

/** The stable category set (preferences default every category enabled). */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'workflow',
  'approval',
  'project',
  'employee',
  'document',
  'knowledge',
  'calendar',
  'system',
];

/** An actionable link attached to a notification. */
export interface NotificationAction {
  /** The action kind (deterministic, server-derived). */
  kind: 'approval' | 'navigate';
  /** The safe in-app destination (never a raw payload value). */
  href: string;
  /** The action label rendered by the client. */
  label: string;
}

/** Input for creating a new {@link Notification}. */
export interface CreateNotificationInput {
  /** The recipient user (trusted server-derived actor). */
  recipientId: UserId;
  /** The tenant (organization) scope. */
  tenantId: TenantId;
  /** The workspace scope, when the source event is workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** The source event type, e.g. `workflow.completed`. */
  type: string;
  /** The notification category (preferences gate). */
  category: NotificationCategory;
  /** The human-readable title. */
  title: string;
  /** The human-readable body. */
  body: string;
  /** The notification priority. */
  priority: NotificationPriority;
  /** An optional actionable link. */
  action?: NotificationAction;
  /** The source event id (idempotency: one notification per event). */
  sourceEventId: string;
  /** The correlation id of the originating execution. */
  correlationId: string;
}

/** A persistence snapshot of the {@link Notification} aggregate. */
export interface NotificationSnapshot {
  /** The notification id. */
  id: string;
  /** The recipient user. */
  recipientId: UserId;
  /** The tenant (organization) scope. */
  tenantId: TenantId;
  /** The workspace scope, when workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** The source event type. */
  type: string;
  /** The notification category. */
  category: NotificationCategory;
  /** The human-readable title. */
  title: string;
  /** The human-readable body. */
  body: string;
  /** The notification priority. */
  priority: NotificationPriority;
  /** The current read state. */
  status: NotificationReadState;
  /** The optional actionable link. */
  action?: NotificationAction;
  /** The source event id (idempotency key). */
  sourceEventId: string;
  /** The correlation id of the originating execution. */
  correlationId: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC read time, when read. */
  readAt?: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/** The outcome of {@link Notification.markRead}. */
export type MarkReadResult =
  { ok: true; notification: Notification } | { ok: false; reason: 'already_read' };

/**
 * The {@link Notification} aggregate root. Use {@link Notification.create}
 * to construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class Notification {
  #id: string;
  readonly #recipientId: UserId;
  readonly #tenantId: TenantId;
  readonly #workspaceId?: WorkspaceId;
  readonly #type: string;
  readonly #category: NotificationCategory;
  readonly #title: string;
  readonly #body: string;
  readonly #priority: NotificationPriority;
  #status: NotificationReadState;
  readonly #action?: NotificationAction;
  readonly #sourceEventId: string;
  readonly #correlationId: string;
  readonly #createdAt: string;
  #readAt?: string;
  #version: number;

  private constructor(input: CreateNotificationInput, now: string) {
    this.#id = prefixedId('ntf');
    this.#recipientId = input.recipientId;
    this.#tenantId = input.tenantId;
    this.#workspaceId = input.workspaceId;
    this.#type = input.type;
    this.#category = input.category;
    this.#title = input.title;
    this.#body = input.body;
    this.#priority = input.priority;
    this.#action = input.action;
    this.#sourceEventId = input.sourceEventId;
    this.#correlationId = input.correlationId;
    this.#createdAt = now;
    this.#status = 'unread';
    this.#version = 1;
  }

  /** Creates a new (unread) notification. */
  static create(input: CreateNotificationInput, now: string): Notification {
    return new Notification(input, now);
  }

  /** Reconstitutes an aggregate from a persisted snapshot. */
  static hydrate(snapshot: NotificationSnapshot): Notification {
    const notification = new Notification(
      {
        recipientId: snapshot.recipientId,
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        type: snapshot.type,
        category: snapshot.category,
        title: snapshot.title,
        body: snapshot.body,
        priority: snapshot.priority,
        action: snapshot.action,
        sourceEventId: snapshot.sourceEventId,
        correlationId: snapshot.correlationId,
      },
      snapshot.createdAt,
    );
    // The aggregate identity is restored from the snapshot (never regenerated
    // at load — a hydrated aggregate must be the SAME record).
    notification.#id = snapshot.id;
    notification.#status = snapshot.status;
    notification.#readAt = snapshot.readAt;
    notification.#version = snapshot.version;
    return notification;
  }

  /** The notification id. */
  get id(): string {
    return this.#id;
  }

  /** The recipient user (trusted server-derived actor). */
  get recipientId(): UserId {
    return this.#recipientId;
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

  /** The notification category. */
  get category(): NotificationCategory {
    return this.#category;
  }

  /** The human-readable title. */
  get title(): string {
    return this.#title;
  }

  /** The human-readable body. */
  get body(): string {
    return this.#body;
  }

  /** The notification priority. */
  get priority(): NotificationPriority {
    return this.#priority;
  }

  /** The current read state. */
  get status(): NotificationReadState {
    return this.#status;
  }

  /** The optional actionable link. */
  get action(): NotificationAction | undefined {
    return this.#action;
  }

  /** The source event id (idempotency key). */
  get sourceEventId(): string {
    return this.#sourceEventId;
  }

  /** The correlation id of the originating execution. */
  get correlationId(): string {
    return this.#correlationId;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC read time, when read. */
  get readAt(): string | undefined {
    return this.#readAt;
  }

  /**
   * Marks the notification as read (validate → mutate). A notification is
   * read exactly once; repeating the transition is a no-op that reports
   * `already_read` (idempotent re-delivery of a read action).
   */
  markRead(now: string): MarkReadResult {
    if (this.#status === 'read') {
      return { ok: false, reason: 'already_read' };
    }
    this.#status = 'read';
    this.#readAt = now;
    this.#version += 1;
    return { ok: true, notification: this };
  }

  /** Produces a persistence snapshot. */
  static snapshot(notification: Notification): NotificationSnapshot {
    return {
      id: notification.#id,
      recipientId: notification.#recipientId,
      tenantId: notification.#tenantId,
      workspaceId: notification.#workspaceId,
      type: notification.#type,
      category: notification.#category,
      title: notification.#title,
      body: notification.#body,
      priority: notification.#priority,
      status: notification.#status,
      action: notification.#action,
      sourceEventId: notification.#sourceEventId,
      correlationId: notification.#correlationId,
      createdAt: notification.#createdAt,
      readAt: notification.#readAt,
      version: notification.#version,
    };
  }
}
