/**
 * @nexora/domain-identity — domain events.
 *
 * The Identity & Access bounded context event vocabulary (DOMAIN_MODEL.md
 * §8, PRODUCT_SPEC.md §4 EVT-*). Every event rides the canonical
 * `@nexora/shared/events` envelope with category `identity`; the platform
 * event-bus (SAD.md §11) consumes this shape. Each factory fills the
 * envelope metadata and keeps the payload typed.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

/** Category applied to every Identity domain event. */
export const IDENTITY_EVENT_CATEGORY = 'identity' as const;

/** Stable event type names (EVT-* catalog, PRODUCT_SPEC.md §4). */
export const IDENTITY_EVENT_TYPES = {
  userCreated: 'identity.user.created',
  userActivated: 'identity.user.activated',
  userSuspended: 'identity.user.suspended',
  userDeactivated: 'identity.user.deactivated',
  roleAssigned: 'identity.user.role_assigned',
  roleRemoved: 'identity.user.role_removed',
  sessionStarted: 'identity.session.started',
  sessionEnded: 'identity.session.ended',
} as const;

/** Payload of the {@link userCreatedEvent}. */
export interface UserCreatedPayload {
  /** The created user. */
  userId: UserId;
  /** The email the user was created with. */
  email: string;
  /** The username the user was created with. */
  username: string;
  /** The display name at creation time. */
  displayName: string;
}

/** Payload of the {@link userActivatedEvent}. */
export interface UserActivatedPayload {
  /** The activated user. */
  userId: UserId;
}

/** Payload of the {@link userSuspendedEvent}. */
export interface UserSuspendedPayload {
  /** The suspended user. */
  userId: UserId;
  /** Why the user was suspended. */
  reason: string;
}

/** Payload of the {@link userDeactivatedEvent}. */
export interface UserDeactivatedPayload {
  /** The deactivated user. */
  userId: UserId;
  /** Why the user was deactivated. */
  reason: string;
}

/** Payload of the {@link roleAssignedEvent}. */
export interface RoleAssignedPayload {
  /** The user that received the role. */
  userId: UserId;
  /** The role name that was assigned. */
  role: string;
}

/** Payload of the {@link roleRemovedEvent}. */
export interface RoleRemovedPayload {
  /** The user that lost the role. */
  userId: UserId;
  /** The role name that was removed. */
  role: string;
}

/** Payload of the {@link sessionStartedEvent}. */
export interface SessionStartedPayload {
  /** The started session. */
  sessionId: string;
  /** The session owner. */
  userId: UserId;
  /** ISO-8601 UTC time the session was issued. */
  issuedAt: string;
  /** ISO-8601 UTC expiry time of the session. */
  expiresAt: string;
}

/** Payload of the {@link sessionEndedEvent}. */
export interface SessionEndedPayload {
  /** The ended session. */
  sessionId: string;
  /** The session owner. */
  userId: UserId;
  /** Why the session ended (logout, expiry, revocation). */
  reason: string;
}

/** Context required to emit an Identity domain event. */
export interface IdentityEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** Tenant the event belongs to. */
  tenantId: TenantId;
  /** Workspace the event belongs to, when applicable. */
  workspaceId?: WorkspaceId;
}

/** Creates a typed Identity domain event envelope with canonical metadata. */
function identityEvent<P>(
  type: string,
  context: IdentityEventContext,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    payload,
    metadata: {
      version,
      category: IDENTITY_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A user account was created (identity.user.created). */
export function userCreatedEvent(
  context: IdentityEventContext,
  payload: UserCreatedPayload,
): EventEnvelope<UserCreatedPayload> {
  return identityEvent(IDENTITY_EVENT_TYPES.userCreated, context, payload);
}

/** A user was activated (identity.user.activated). */
export function userActivatedEvent(
  context: IdentityEventContext,
  payload: UserActivatedPayload,
): EventEnvelope<UserActivatedPayload> {
  return identityEvent(IDENTITY_EVENT_TYPES.userActivated, context, payload);
}

/** A user was suspended (identity.user.suspended). */
export function userSuspendedEvent(
  context: IdentityEventContext,
  payload: UserSuspendedPayload,
): EventEnvelope<UserSuspendedPayload> {
  return identityEvent(IDENTITY_EVENT_TYPES.userSuspended, context, payload);
}

/** A user was deactivated (identity.user.deactivated). */
export function userDeactivatedEvent(
  context: IdentityEventContext,
  payload: UserDeactivatedPayload,
): EventEnvelope<UserDeactivatedPayload> {
  return identityEvent(IDENTITY_EVENT_TYPES.userDeactivated, context, payload);
}

/** A role was assigned to a user (identity.user.role_assigned). */
export function roleAssignedEvent(
  context: IdentityEventContext,
  payload: RoleAssignedPayload,
): EventEnvelope<RoleAssignedPayload> {
  return identityEvent(IDENTITY_EVENT_TYPES.roleAssigned, context, payload);
}

/** A role was removed from a user (identity.user.role_removed). */
export function roleRemovedEvent(
  context: IdentityEventContext,
  payload: RoleRemovedPayload,
): EventEnvelope<RoleRemovedPayload> {
  return identityEvent(IDENTITY_EVENT_TYPES.roleRemoved, context, payload);
}

/** A session was started (identity.session.started). */
export function sessionStartedEvent(
  context: IdentityEventContext,
  payload: SessionStartedPayload,
): EventEnvelope<SessionStartedPayload> {
  return identityEvent(IDENTITY_EVENT_TYPES.sessionStarted, context, payload);
}

/** A session ended (identity.session.ended). */
export function sessionEndedEvent(
  context: IdentityEventContext,
  payload: SessionEndedPayload,
): EventEnvelope<SessionEndedPayload> {
  return identityEvent(IDENTITY_EVENT_TYPES.sessionEnded, context, payload);
}
