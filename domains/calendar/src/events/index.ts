/**
 * @nexora/module-calendar — domain events.
 *
 * The Calendar bounded context event vocabulary (DOMAIN_MODEL.md §4.5
 * Calendar: `EventCreated`, `MeetingBooked`; the calendar vertical slice
 * event catalog). Calendar is a *Supporting* domain (DOMAIN_MODEL.md DOM-14),
 * so calendar events ride the canonical `@nexora/shared/events` envelope
 * with category `calendar`; the platform event-bus (SAD.md §11) consumes
 * this shape.
 *
 * Every event carries the organization (tenant) id (context contract), the
 * workspace id ON THE ENVELOPE (calendar entries are workspace-scoped, so
 * the notification policy can scope notifications/activity to the workspace)
 * and the calendar entry id.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { CalendarEntryId } from '../value-objects/calendar-entry-id.js';

/** Category applied to every Calendar domain event (DOM-14 Supporting). */
export const CALENDAR_EVENT_CATEGORY = 'calendar' as const;

/** Stable event type names (calendar vertical slice event catalog). */
export const CALENDAR_EVENT_TYPES = {
  calendarEventCreated: 'calendar.event.created',
  calendarEventUpdated: 'calendar.event.updated',
  calendarEventCancelled: 'calendar.event.cancelled',
} as const;

/** Payload of the {@link calendarEventCreatedEvent}. */
export interface CalendarEntryCreatedPayload {
  /** The created calendar entry. */
  calendarEntryId: CalendarEntryId;
  /** The title at creation time. */
  title: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The user that created the entry. */
  createdBy: UserId;
  /** ISO-8601 UTC start instant. */
  startsAt: string;
  /** ISO-8601 UTC end instant. */
  endsAt: string;
  /** The initial status (`scheduled`). */
  status: string;
}

/** Payload of the {@link calendarEventUpdatedEvent}. */
export interface CalendarEntryUpdatedPayload {
  /** The updated calendar entry. */
  calendarEntryId: CalendarEntryId;
  /** The title after the update. */
  title: string;
  /** ISO-8601 UTC start instant after the update. */
  startsAt: string;
  /** ISO-8601 UTC end instant after the update. */
  endsAt: string;
}

/** Payload of the {@link calendarEventCancelledEvent}. */
export interface CalendarEntryCancelledPayload {
  /** The cancelled calendar entry. */
  calendarEntryId: CalendarEntryId;
}

/** Context required to emit a Calendar domain event. */
export interface CalendarEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id (calendar entries are workspace-scoped). */
  workspaceId: WorkspaceId;
}

/** Creates a typed Calendar domain event envelope with canonical metadata. */
function calendarEvent<P>(
  type: string,
  context: CalendarEventContext,
  calendarEntryId: CalendarEntryId,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.organizationId,
    // Workspace scope ON THE ENVELOPE so consumers (e.g. the notification
    // policy) can scope notifications/activity to the workspace.
    workspaceId: context.workspaceId,
    payload,
    metadata: {
      version,
      category: CALENDAR_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A calendar entry was created (calendar.event.created). */
export function calendarEventCreatedEvent(
  context: CalendarEventContext,
  calendarEntryId: CalendarEntryId,
  payload: CalendarEntryCreatedPayload,
): EventEnvelope<CalendarEntryCreatedPayload> {
  return calendarEvent(CALENDAR_EVENT_TYPES.calendarEventCreated, context, calendarEntryId, payload);
}

/** A calendar entry was updated (calendar.event.updated). */
export function calendarEventUpdatedEvent(
  context: CalendarEventContext,
  calendarEntryId: CalendarEntryId,
  payload: CalendarEntryUpdatedPayload,
): EventEnvelope<CalendarEntryUpdatedPayload> {
  return calendarEvent(CALENDAR_EVENT_TYPES.calendarEventUpdated, context, calendarEntryId, payload);
}

/** A calendar entry was cancelled (calendar.event.cancelled). */
export function calendarEventCancelledEvent(
  context: CalendarEventContext,
  calendarEntryId: CalendarEntryId,
): EventEnvelope<CalendarEntryCancelledPayload> {
  return calendarEvent(CALENDAR_EVENT_TYPES.calendarEventCancelled, context, calendarEntryId, {
    calendarEntryId,
  });
}
