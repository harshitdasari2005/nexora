/**
 * @nexora/domain-organizations — domain events.
 *
 * The Organizations bounded context event vocabulary (DOMAIN_MODEL.md §1
 * Tenancy). Tenancy is classified as a *Generic* (platform-level) domain
 * (DOMAIN_MODEL.md DOM-01), so organization events ride the canonical
 * `@nexora/shared/events` envelope with category `platform`; the platform
 * event-bus (SAD.md §11) consumes this shape.
 *
 * `tenantId` is optional on the context because the Organization IS the
 * tenant: its id is generated inside the aggregate, so the emitted envelope
 * resolves `tenantId` from the organization id when the context does not
 * carry one.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { OrganizationId } from '../value-objects/organization-id.js';
import type { MembershipRole } from '../value-objects/membership-role.js';

/** Category applied to every Organizations domain event (DOM-01 Generic). */
export const ORGANIZATIONS_EVENT_CATEGORY = 'platform' as const;

/** Stable event type names (EVT-* catalog, PRODUCT_SPEC.md §4 / DOMAIN_MODEL.md §8). */
export const ORGANIZATION_EVENT_TYPES = {
  organizationCreated: 'organization.created',
  organizationActivated: 'organization.activated',
  organizationSuspended: 'organization.suspended',
  organizationArchived: 'organization.archived',
  memberAdded: 'organization.member_added',
  memberRemoved: 'organization.member_removed',
  organizationSettingsUpdated: 'organization.settings_updated',
} as const;

/** Payload of the {@link organizationCreatedEvent}. */
export interface OrganizationCreatedPayload {
  /** The created organization (also its tenant id). */
  organizationId: OrganizationId;
  /** The unique slug at creation time. */
  slug: string;
  /** The name at creation time. */
  name: string;
  /** The provisioning type at creation time. */
  type: string;
  /** The initial lifecycle status. */
  status: string;
}

/** Payload of the {@link organizationActivatedEvent}. */
export interface OrganizationActivatedPayload {
  /** The activated organization. */
  organizationId: OrganizationId;
}

/** Payload of the {@link organizationSuspendedEvent}. */
export interface OrganizationSuspendedPayload {
  /** The suspended organization. */
  organizationId: OrganizationId;
  /** Why the organization was suspended. */
  reason: string;
}

/** Payload of the {@link organizationArchivedEvent}. */
export interface OrganizationArchivedPayload {
  /** The archived organization. */
  organizationId: OrganizationId;
  /** Why the organization was archived. */
  reason: string;
}

/** Payload of the {@link memberAddedEvent}. */
export interface MemberAddedPayload {
  /** The organization the member joined. */
  organizationId: OrganizationId;
  /** The new membership record. */
  membershipId: string;
  /** The user that joined. */
  userId: UserId;
  /** The role granted at join time. */
  role: MembershipRole;
}

/** Payload of the {@link memberRemovedEvent}. */
export interface MemberRemovedPayload {
  /** The organization the member left. */
  organizationId: OrganizationId;
  /** The removed membership record. */
  membershipId: string;
  /** The user that left. */
  userId: UserId;
  /** The role held at removal time (audit). */
  role: MembershipRole;
}

/** Payload of the {@link organizationSettingsUpdatedEvent}. */
export interface OrganizationSettingsUpdatedPayload {
  /** The organization whose settings changed. */
  organizationId: OrganizationId;
  /** The top-level settings keys that changed. */
  changedFields: readonly string[];
}

/** Context required to emit an Organizations domain event. */
export interface OrganizationEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /**
   * Tenant the event belongs to. Optional because the Organization is the
   * tenant: when absent, the envelope uses the organization id.
   */
  tenantId?: TenantId;
  /** Workspace the event belongs to, when applicable. */
  workspaceId?: WorkspaceId;
}

/** Creates a typed Organizations domain event envelope with canonical metadata. */
function organizationEvent<P>(
  type: string,
  context: OrganizationEventContext,
  organizationId: OrganizationId,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    // The organization id is the tenant id (documented above); the brands
    // differ only at the type level, so the mapping is contained here.
    tenantId: (context.tenantId ?? organizationId) as unknown as TenantId,
    workspaceId: context.workspaceId,
    payload,
    metadata: {
      version,
      category: ORGANIZATIONS_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** An organization was created (organization.created). */
export function organizationCreatedEvent(
  context: OrganizationEventContext,
  organizationId: OrganizationId,
  payload: OrganizationCreatedPayload,
): EventEnvelope<OrganizationCreatedPayload> {
  return organizationEvent(
    ORGANIZATION_EVENT_TYPES.organizationCreated,
    context,
    organizationId,
    payload,
  );
}

/** An organization was activated (organization.activated). */
export function organizationActivatedEvent(
  context: OrganizationEventContext,
  organizationId: OrganizationId,
): EventEnvelope<OrganizationActivatedPayload> {
  return organizationEvent(
    ORGANIZATION_EVENT_TYPES.organizationActivated,
    context,
    organizationId,
    { organizationId },
  );
}

/** An organization was suspended (organization.suspended). */
export function organizationSuspendedEvent(
  context: OrganizationEventContext,
  organizationId: OrganizationId,
  reason: string,
): EventEnvelope<OrganizationSuspendedPayload> {
  return organizationEvent(
    ORGANIZATION_EVENT_TYPES.organizationSuspended,
    context,
    organizationId,
    { organizationId, reason },
  );
}

/** An organization was archived (organization.archived). */
export function organizationArchivedEvent(
  context: OrganizationEventContext,
  organizationId: OrganizationId,
  reason: string,
): EventEnvelope<OrganizationArchivedPayload> {
  return organizationEvent(ORGANIZATION_EVENT_TYPES.organizationArchived, context, organizationId, {
    organizationId,
    reason,
  });
}

/** A member joined an organization (organization.member_added). */
export function memberAddedEvent(
  context: OrganizationEventContext,
  payload: MemberAddedPayload,
): EventEnvelope<MemberAddedPayload> {
  return organizationEvent(
    ORGANIZATION_EVENT_TYPES.memberAdded,
    context,
    payload.organizationId,
    payload,
  );
}

/** A member left an organization (organization.member_removed). */
export function memberRemovedEvent(
  context: OrganizationEventContext,
  payload: MemberRemovedPayload,
): EventEnvelope<MemberRemovedPayload> {
  return organizationEvent(
    ORGANIZATION_EVENT_TYPES.memberRemoved,
    context,
    payload.organizationId,
    payload,
  );
}

/** Organization settings changed (organization.settings_updated). */
export function organizationSettingsUpdatedEvent(
  context: OrganizationEventContext,
  organizationId: OrganizationId,
  changedFields: readonly string[],
): EventEnvelope<OrganizationSettingsUpdatedPayload> {
  return organizationEvent(
    ORGANIZATION_EVENT_TYPES.organizationSettingsUpdated,
    context,
    organizationId,
    { organizationId, changedFields },
  );
}
