/**
 * @nexora/domain-workspaces — domain events.
 *
 * The Workspaces bounded context event vocabulary (DOMAIN_MODEL.md §1
 * Tenancy; PSD.md §4 WS-*). Tenancy is classified as a *Generic*
 * (platform-level) domain (DOMAIN_MODEL.md DOM-01), so workspace events ride
 * the canonical `@nexora/shared/events` envelope with category `platform`;
 * the platform event-bus (SAD.md §11) consumes this shape.
 *
 * Every event carries the organization (tenant) id and, where known, the
 * workspace id (WS-R3 context contract).
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, UserId } from '@nexora/contracts/common';

import type { WorkspaceId } from '../value-objects/workspace-id.js';
import type { MembershipRole } from '../value-objects/membership-role.js';

/** Category applied to every Workspaces domain event (DOM-01 Generic). */
export const WORKSPACES_EVENT_CATEGORY = 'platform' as const;

/** Stable event type names (EVT-* catalog, PRODUCT_SPEC.md §4 / DOMAIN_MODEL.md §8). */
export const WORKSPACE_EVENT_TYPES = {
  workspaceCreated: 'workspace.created',
  workspaceActivated: 'workspace.activated',
  workspaceSuspended: 'workspace.suspended',
  workspaceArchived: 'workspace.archived',
  memberAdded: 'workspace.member_added',
  memberRemoved: 'workspace.member_removed',
  pluginInstalled: 'workspace.plugin_installed',
  pluginUpdated: 'workspace.plugin_updated',
  pluginRemoved: 'workspace.plugin_removed',
  agentBound: 'workspace.agent_bound',
  agentUnbound: 'workspace.agent_unbound',
  knowledgeAttached: 'workspace.knowledge_attached',
  knowledgeDetached: 'workspace.knowledge_detached',
  workflowAttached: 'workspace.workflow_attached',
  workflowDetached: 'workspace.workflow_detached',
  searchProviderAttached: 'workspace.search_provider_attached',
  notificationProviderAttached: 'workspace.notification_provider_attached',
  settingsUpdated: 'workspace.settings_updated',
  brandingUpdated: 'workspace.branding_updated',
} as const;

/** Payload of the {@link workspaceCreatedEvent}. */
export interface WorkspaceCreatedPayload {
  /** The created workspace. */
  workspaceId: WorkspaceId;
  /** The slug at creation time. */
  slug: string;
  /** The name at creation time. */
  name: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The template type at creation time. */
  type: string;
  /** The initial lifecycle status. */
  status: string;
}

/** Payload of the {@link workspaceActivatedEvent}. */
export interface WorkspaceActivatedPayload {
  /** The activated workspace. */
  workspaceId: WorkspaceId;
}

/** Payload of the {@link workspaceSuspendedEvent}. */
export interface WorkspaceSuspendedPayload {
  /** The suspended workspace. */
  workspaceId: WorkspaceId;
  /** Why the workspace was suspended. */
  reason: string;
}

/** Payload of the {@link workspaceArchivedEvent}. */
export interface WorkspaceArchivedPayload {
  /** The archived workspace. */
  workspaceId: WorkspaceId;
  /** Why the workspace was archived. */
  reason: string;
}

/** Payload of the {@link memberAddedEvent}. */
export interface MemberAddedPayload {
  /** The workspace the member joined. */
  workspaceId: WorkspaceId;
  /** The new membership record. */
  membershipId: string;
  /** The user that joined. */
  userId: UserId;
  /** The role granted at join time. */
  role: MembershipRole;
}

/** Payload of the {@link memberRemovedEvent}. */
export interface MemberRemovedPayload {
  /** The workspace the member left. */
  workspaceId: WorkspaceId;
  /** The removed membership record. */
  membershipId: string;
  /** The user that left. */
  userId: UserId;
  /** The role held at removal time (audit). */
  role: MembershipRole;
}

/** Payload of the {@link pluginInstalledEvent}. */
export interface PluginInstalledPayload {
  /** The workspace the plugin was installed in. */
  workspaceId: WorkspaceId;
  /** The installation record. */
  installationId: string;
  /** The installed plugin id. */
  pluginId: string;
  /** The installed plugin version. */
  pluginVersion: string;
}

/** Payload of the {@link pluginRemovedEvent}. */
export interface PluginRemovedPayload {
  /** The workspace the plugin was removed from. */
  workspaceId: WorkspaceId;
  /** The removed installation record. */
  installationId: string;
  /** The removed plugin id. */
  pluginId: string;
}

/** Payload of the {@link pluginUpdatedEvent}. */
export interface PluginUpdatedPayload {
  /** The workspace the plugin was updated in. */
  workspaceId: WorkspaceId;
  /** The installation record. */
  installationId: string;
  /** The updated plugin id. */
  pluginId: string;
  /** The previous plugin version. */
  previousVersion: string;
  /** The new plugin version. */
  pluginVersion: string;
  /** ISO-8601 UTC time of the update. */
  updatedAt: string;
}

/** Payload of the {@link agentBoundEvent}. */
export interface AgentBoundPayload {
  /** The workspace the agent was bound to. */
  workspaceId: WorkspaceId;
  /** The binding record. */
  bindingId: string;
  /** The bound agent id. */
  agentId: string;
}

/** Payload of the {@link agentUnboundEvent}. */
export interface AgentUnboundPayload {
  /** The workspace the agent was unbound from. */
  workspaceId: WorkspaceId;
  /** The removed binding record. */
  bindingId: string;
  /** The unbound agent id. */
  agentId: string;
}

/** Payload of the {@link knowledgeAttachedEvent}. */
export interface KnowledgeAttachedPayload {
  /** The workspace the knowledge source was attached to. */
  workspaceId: WorkspaceId;
  /** The binding record. */
  bindingId: string;
  /** The attached knowledge source id. */
  knowledgeId: string;
}

/** Payload of the {@link knowledgeDetachedEvent}. */
export interface KnowledgeDetachedPayload {
  /** The workspace the knowledge source was detached from. */
  workspaceId: WorkspaceId;
  /** The removed binding record. */
  bindingId: string;
  /** The detached knowledge source id. */
  knowledgeId: string;
}

/** Payload of the {@link workflowAttachedEvent}. */
export interface WorkflowAttachedPayload {
  /** The workspace the workflow was attached to. */
  workspaceId: WorkspaceId;
  /** The binding record. */
  bindingId: string;
  /** The attached workflow id. */
  workflowId: string;
}

/** Payload of the {@link workflowDetachedEvent}. */
export interface WorkflowDetachedPayload {
  /** The workspace the workflow was detached from. */
  workspaceId: WorkspaceId;
  /** The removed binding record. */
  bindingId: string;
  /** The detached workflow id. */
  workflowId: string;
}

/** Payload of the {@link searchProviderAttachedEvent}. */
export interface SearchProviderAttachedPayload {
  /** The workspace the provider was attached to. */
  workspaceId: WorkspaceId;
  /** The binding record. */
  bindingId: string;
  /** The search provider key. */
  provider: string;
}

/** Payload of the {@link notificationProviderAttachedEvent}. */
export interface NotificationProviderAttachedPayload {
  /** The workspace the provider was attached to. */
  workspaceId: WorkspaceId;
  /** The binding record. */
  bindingId: string;
  /** The notification provider key. */
  provider: string;
}

/** Payload of the {@link workspaceSettingsUpdatedEvent}. */
export interface WorkspaceSettingsUpdatedPayload {
  /** The workspace whose settings changed. */
  workspaceId: WorkspaceId;
  /** The top-level settings keys that changed. */
  changedFields: readonly string[];
}

/** Payload of the {@link workspaceBrandingUpdatedEvent}. */
export interface WorkspaceBrandingUpdatedPayload {
  /** The workspace whose branding changed. */
  workspaceId: WorkspaceId;
  /** The branding keys that changed. */
  changedFields: readonly string[];
}

/** Context required to emit a Workspaces domain event. */
export interface WorkspaceEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The workspace the event belongs to, when known by the caller. */
  workspaceId?: WorkspaceId;
}

/** Creates a typed Workspaces domain event envelope with canonical metadata. */
function workspaceEvent<P>(
  type: string,
  context: WorkspaceEventContext,
  workspaceId: WorkspaceId,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.organizationId,
    workspaceId: context.workspaceId ?? workspaceId,
    payload,
    metadata: {
      version,
      category: WORKSPACES_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A workspace was created (workspace.created). */
export function workspaceCreatedEvent(
  context: WorkspaceEventContext,
  workspaceId: WorkspaceId,
  payload: WorkspaceCreatedPayload,
): EventEnvelope<WorkspaceCreatedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.workspaceCreated, context, workspaceId, payload);
}

/** A workspace was activated (workspace.activated). */
export function workspaceActivatedEvent(
  context: WorkspaceEventContext,
  workspaceId: WorkspaceId,
): EventEnvelope<WorkspaceActivatedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.workspaceActivated, context, workspaceId, {
    workspaceId,
  });
}

/** A workspace was suspended (workspace.suspended). */
export function workspaceSuspendedEvent(
  context: WorkspaceEventContext,
  workspaceId: WorkspaceId,
  reason: string,
): EventEnvelope<WorkspaceSuspendedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.workspaceSuspended, context, workspaceId, {
    workspaceId,
    reason,
  });
}

/** A workspace was archived (workspace.archived). */
export function workspaceArchivedEvent(
  context: WorkspaceEventContext,
  workspaceId: WorkspaceId,
  reason: string,
): EventEnvelope<WorkspaceArchivedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.workspaceArchived, context, workspaceId, {
    workspaceId,
    reason,
  });
}

/** A member joined a workspace (workspace.member_added). */
export function memberAddedEvent(
  context: WorkspaceEventContext,
  payload: MemberAddedPayload,
): EventEnvelope<MemberAddedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.memberAdded, context, payload.workspaceId, payload);
}

/** A member left a workspace (workspace.member_removed). */
export function memberRemovedEvent(
  context: WorkspaceEventContext,
  payload: MemberRemovedPayload,
): EventEnvelope<MemberRemovedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.memberRemoved, context, payload.workspaceId, payload);
}

/** A plugin was installed in a workspace (workspace.plugin_installed). */
export function pluginInstalledEvent(
  context: WorkspaceEventContext,
  payload: PluginInstalledPayload,
): EventEnvelope<PluginInstalledPayload> {
  return workspaceEvent(
    WORKSPACE_EVENT_TYPES.pluginInstalled,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A plugin was removed from a workspace (workspace.plugin_removed). */
export function pluginRemovedEvent(
  context: WorkspaceEventContext,
  payload: PluginRemovedPayload,
): EventEnvelope<PluginRemovedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.pluginRemoved, context, payload.workspaceId, payload);
}

/** A plugin was updated to a new version (workspace.plugin_updated). */
export function pluginUpdatedEvent(
  context: WorkspaceEventContext,
  payload: PluginUpdatedPayload,
): EventEnvelope<PluginUpdatedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.pluginUpdated, context, payload.workspaceId, payload);
}

/** An agent was bound to a workspace (workspace.agent_bound). */
export function agentBoundEvent(
  context: WorkspaceEventContext,
  payload: AgentBoundPayload,
): EventEnvelope<AgentBoundPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.agentBound, context, payload.workspaceId, payload);
}

/** An agent was unbound from a workspace (workspace.agent_unbound). */
export function agentUnboundEvent(
  context: WorkspaceEventContext,
  payload: AgentUnboundPayload,
): EventEnvelope<AgentUnboundPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.agentUnbound, context, payload.workspaceId, payload);
}

/** A knowledge source was attached to a workspace (workspace.knowledge_attached). */
export function knowledgeAttachedEvent(
  context: WorkspaceEventContext,
  payload: KnowledgeAttachedPayload,
): EventEnvelope<KnowledgeAttachedPayload> {
  return workspaceEvent(
    WORKSPACE_EVENT_TYPES.knowledgeAttached,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A knowledge source was detached from a workspace (workspace.knowledge_detached). */
export function knowledgeDetachedEvent(
  context: WorkspaceEventContext,
  payload: KnowledgeDetachedPayload,
): EventEnvelope<KnowledgeDetachedPayload> {
  return workspaceEvent(
    WORKSPACE_EVENT_TYPES.knowledgeDetached,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A workflow was attached to a workspace (workspace.workflow_attached). */
export function workflowAttachedEvent(
  context: WorkspaceEventContext,
  payload: WorkflowAttachedPayload,
): EventEnvelope<WorkflowAttachedPayload> {
  return workspaceEvent(
    WORKSPACE_EVENT_TYPES.workflowAttached,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A workflow was detached from a workspace (workspace.workflow_detached). */
export function workflowDetachedEvent(
  context: WorkspaceEventContext,
  payload: WorkflowDetachedPayload,
): EventEnvelope<WorkflowDetachedPayload> {
  return workspaceEvent(
    WORKSPACE_EVENT_TYPES.workflowDetached,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A search provider was attached to a workspace (workspace.search_provider_attached). */
export function searchProviderAttachedEvent(
  context: WorkspaceEventContext,
  payload: SearchProviderAttachedPayload,
): EventEnvelope<SearchProviderAttachedPayload> {
  return workspaceEvent(
    WORKSPACE_EVENT_TYPES.searchProviderAttached,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A notification provider was attached (workspace.notification_provider_attached). */
export function notificationProviderAttachedEvent(
  context: WorkspaceEventContext,
  payload: NotificationProviderAttachedPayload,
): EventEnvelope<NotificationProviderAttachedPayload> {
  return workspaceEvent(
    WORKSPACE_EVENT_TYPES.notificationProviderAttached,
    context,
    payload.workspaceId,
    payload,
  );
}

/** Workspace settings changed (workspace.settings_updated). */
export function workspaceSettingsUpdatedEvent(
  context: WorkspaceEventContext,
  workspaceId: WorkspaceId,
  changedFields: readonly string[],
): EventEnvelope<WorkspaceSettingsUpdatedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.settingsUpdated, context, workspaceId, {
    workspaceId,
    changedFields,
  });
}

/** Workspace branding changed (workspace.branding_updated). */
export function workspaceBrandingUpdatedEvent(
  context: WorkspaceEventContext,
  workspaceId: WorkspaceId,
  changedFields: readonly string[],
): EventEnvelope<WorkspaceBrandingUpdatedPayload> {
  return workspaceEvent(WORKSPACE_EVENT_TYPES.brandingUpdated, context, workspaceId, {
    workspaceId,
    changedFields,
  });
}
