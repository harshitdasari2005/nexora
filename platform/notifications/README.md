# @nexora/module-notifications

Bounded context: **Notifications** (DOMAIN_MODEL.md §1).

Responsibilities: inbox, toasts, approvals, AI alerts, delivery (in-app +
email baseline) (FRONTEND.md §10). The Notification platform is a
**CONSUMER of the canonical event stream** — it never owns business state.
The Activity Feed is a **read model** derived from the same events — it is
disposable and rebuildable, never a second source of truth.

## Event → notification architecture

```
Domain ──► EventEnvelope ──► Publisher seam ──► NotificationEventConsumer
                                                   │
                                                   ├─► NotificationPolicy (deterministic)
                                                   ├─► recipient inbox (notifications table)
                                                   ├─► activity read model (activity table)
                                                   └─► NotificationStream (SSE push)
```

- Domains **never** call the notification service directly. They publish
  canonical events (`project.created`, `employee.created`,
  `workflow.completed`, `workflow.failed`,
  `workflow.waiting_for_approval`, `document.available`,
  `document.processing_failed`, `knowledge.indexed`, …).
- The `NotificationForwardingPublisher` (composition root, `apps/api`) hands
  every envelope to the consumer **before** the base publisher. The consumer
  is guaranteed never to throw, so a notification failure can never break
  the business mutation that emitted the event.
- No second event bus, no second workflow engine, no second approval
  engine: notifications are a projection of the existing event backbone.

## Recipient authorization

The **recipient is always the trusted event actor** (server-derived) — never
a payload field, never an LLM choice, never a client value.

- `NotificationPolicy.evaluate(event)` is pure deterministic code: it maps
  an event type to recipient-scoped notification specs and workspace-scoped
  activity specs. Events outside the catalog produce nothing.
- If the actor is a system/agent (no human recipient), no notification is
  produced — activity may still record the workspace event.
- Every inbox query is `recipientId + tenantId` scoped; every activity query
  is `tenantId (+ workspaceId)` scoped. A notification id alone grants
  nothing (foreign ids resolve to 404).
- The AI (`notifications.what_needs_attention`) is a **consumer** of
  notification context — it cannot name a recipient, tenant, or workspace.

## Idempotency

Delivery is **at-least-once**; the consumer is idempotent:

- `findBySourceEvent(sourceEventId, recipientId, tenantId)` gates every
  projection — a duplicate delivery creates exactly one notification and
  one activity item.
- The source event id is the deduplication key; replay never duplicates.

## Preferences

Per-user, per-tenant `NotificationPreferences` (category → enabled).
Defaults are **safe**: every category enabled. Preferences gate
**presentation/delivery only** — disabling a category never disables the
underlying business action. Unknown categories are rejected (never silently
widen delivery).

## Activity Feed (read model)

`ActivityItem` records are derived from the event stream, workspace-scoped
when the source event is. They are disposable and rebuildable — business
domains remain authoritative. Filtering happens server-side at the query
level; the frontend renders only what the API returned.

## Real-time

`NotificationStream` is the in-process transport seam; `GET
/api/notifications/stream` serves one authenticated SSE connection per
client, filtered server-side to the authenticated recipient.

## Tests

- Domain: Notification read-state lifecycle, preferences defaults/gating,
  ActivityItem scoping.
- Policy: event → recipient mapping, actor gating, unknown events,
  hostile payloads.
- Consumer: projection, idempotent duplicate delivery, preference gating,
  never-throws, stream publication.
- Application: recipient-scoped listing, unread counts, mark-read,
  preferences, activity scoping.
- API E2E (`apps/api/test/api.notifications.test.ts`): event → inbox →
  feed flow, read lifecycle, preferences, security (cross-tenant, forged
  ids, client-supplied identity), idempotency.
