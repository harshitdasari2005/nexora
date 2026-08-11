/**
 * Workspace domain event tests: types, payloads, envelope metadata, and the
 * context contract (organization id + workspace id).
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';

import {
  agentBoundEvent,
  agentUnboundEvent,
  knowledgeAttachedEvent,
  knowledgeDetachedEvent,
  memberAddedEvent,
  memberRemovedEvent,
  notificationProviderAttachedEvent,
  pluginInstalledEvent,
  pluginRemovedEvent,
  searchProviderAttachedEvent,
  WORKSPACES_EVENT_CATEGORY,
  workspaceActivatedEvent,
  workspaceArchivedEvent,
  workspaceBrandingUpdatedEvent,
  workspaceCreatedEvent,
  WORKSPACE_EVENT_TYPES,
  workspaceSettingsUpdatedEvent,
  workspaceSuspendedEvent,
  workflowAttachedEvent,
  workflowDetachedEvent,
} from '../src/events/index.js';
import { WorkspaceId } from '../src/value-objects/workspace-id.js';
import { testContext } from './helpers.js';

const context = testContext();
const workspaceId = WorkspaceId.create();
const USER_ID = 'usr_1' as UserId;

describe('workspace events', () => {
  it('created carries identity, slug, name, organization, type, status', () => {
    const event = workspaceCreatedEvent(context, workspaceId, {
      workspaceId,
      slug: 'engineering',
      name: 'Engineering',
      organizationId: 'tenant_1' as never,
      type: 'engineering',
      status: 'provisioning',
    });
    expect(event.type).toBe(WORKSPACE_EVENT_TYPES.workspaceCreated);
    expect(event.payload).toMatchObject({ slug: 'engineering', type: 'engineering' });
  });

  it('activated / suspended / archived carry the workspace id', () => {
    expect(workspaceActivatedEvent(context, workspaceId).type).toBe(
      WORKSPACE_EVENT_TYPES.workspaceActivated,
    );
    const suspended = workspaceSuspendedEvent(context, workspaceId, 'non-payment');
    expect(suspended.type).toBe(WORKSPACE_EVENT_TYPES.workspaceSuspended);
    expect(suspended.payload.reason).toBe('non-payment');
    const archived = workspaceArchivedEvent(context, workspaceId, 'closed');
    expect(archived.type).toBe(WORKSPACE_EVENT_TYPES.workspaceArchived);
    expect(archived.payload.reason).toBe('closed');
  });

  it('member added / removed carry membership and role', () => {
    const added = memberAddedEvent(context, {
      workspaceId,
      membershipId: 'mbr_1',
      userId: USER_ID,
      role: 'admin',
    });
    expect(added.type).toBe(WORKSPACE_EVENT_TYPES.memberAdded);
    expect(added.payload.role).toBe('admin');

    const removed = memberRemovedEvent(context, {
      workspaceId,
      membershipId: 'mbr_1',
      userId: USER_ID,
      role: 'owner',
    });
    expect(removed.type).toBe(WORKSPACE_EVENT_TYPES.memberRemoved);
    expect(removed.payload.role).toBe('owner');
  });

  it('plugin installed / removed carry installation and plugin', () => {
    const installed = pluginInstalledEvent(context, {
      workspaceId,
      installationId: 'ins_1',
      pluginId: 'hr',
      pluginVersion: '1.2.0',
    });
    expect(installed.type).toBe(WORKSPACE_EVENT_TYPES.pluginInstalled);
    expect(installed.payload.pluginVersion).toBe('1.2.0');

    const removed = pluginRemovedEvent(context, {
      workspaceId,
      installationId: 'ins_1',
      pluginId: 'hr',
    });
    expect(removed.type).toBe(WORKSPACE_EVENT_TYPES.pluginRemoved);
  });

  it('agent bound / unbound carry the agent id', () => {
    const bound = agentBoundEvent(context, { workspaceId, bindingId: 'agb_1', agentId: 'agt_hr' });
    expect(bound.type).toBe(WORKSPACE_EVENT_TYPES.agentBound);
    expect(bound.payload.agentId).toBe('agt_hr');
    const unbound = agentUnboundEvent(context, {
      workspaceId,
      bindingId: 'agb_1',
      agentId: 'agt_hr',
    });
    expect(unbound.type).toBe(WORKSPACE_EVENT_TYPES.agentUnbound);
  });

  it('knowledge attached / detached carry the knowledge id', () => {
    const attached = knowledgeAttachedEvent(context, {
      workspaceId,
      bindingId: 'knb_1',
      knowledgeId: 'knl_1',
    });
    expect(attached.type).toBe(WORKSPACE_EVENT_TYPES.knowledgeAttached);
    const detached = knowledgeDetachedEvent(context, {
      workspaceId,
      bindingId: 'knb_1',
      knowledgeId: 'knl_1',
    });
    expect(detached.type).toBe(WORKSPACE_EVENT_TYPES.knowledgeDetached);
  });

  it('workflow attached / detached carry the workflow id', () => {
    const attached = workflowAttachedEvent(context, {
      workspaceId,
      bindingId: 'wfb_1',
      workflowId: 'wfl_1',
    });
    expect(attached.type).toBe(WORKSPACE_EVENT_TYPES.workflowAttached);
    const detached = workflowDetachedEvent(context, {
      workspaceId,
      bindingId: 'wfb_1',
      workflowId: 'wfl_1',
    });
    expect(detached.type).toBe(WORKSPACE_EVENT_TYPES.workflowDetached);
  });

  it('search / notification provider attached carry the provider', () => {
    const search = searchProviderAttachedEvent(context, {
      workspaceId,
      bindingId: 'srb_1',
      provider: 'typesense',
    });
    expect(search.type).toBe(WORKSPACE_EVENT_TYPES.searchProviderAttached);
    expect(search.payload.provider).toBe('typesense');

    const notification = notificationProviderAttachedEvent(context, {
      workspaceId,
      bindingId: 'ntb_1',
      provider: 'slack',
    });
    expect(notification.type).toBe(WORKSPACE_EVENT_TYPES.notificationProviderAttached);
  });

  it('settings / branding updated carry changed keys', () => {
    const settings = workspaceSettingsUpdatedEvent(context, workspaceId, ['aiEnabled']);
    expect(settings.type).toBe(WORKSPACE_EVENT_TYPES.settingsUpdated);
    expect(settings.payload.changedFields).toEqual(['aiEnabled']);

    const branding = workspaceBrandingUpdatedEvent(context, workspaceId, ['color']);
    expect(branding.type).toBe(WORKSPACE_EVENT_TYPES.brandingUpdated);
    expect(branding.payload.changedFields).toEqual(['color']);
  });
});

describe('event envelope', () => {
  it('rides the shared envelope with platform category and context contract', () => {
    const event = workspaceActivatedEvent(context, workspaceId);
    expect(event.id).toMatch(/^evt_/);
    expect(event.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.metadata?.category).toBe(WORKSPACES_EVENT_CATEGORY);
    expect(event.metadata?.category).toBe('platform');
    expect(event.metadata?.priority).toBe('normal');
    expect(event.correlationId).toBe('corr_test');
    expect(event.tenantId).toBe('tenant_1');
    expect(event.workspaceId).toBe(workspaceId);
  });

  it('prefers the explicit workspace id from the context', () => {
    const other = WorkspaceId.create();
    const event = workspaceActivatedEvent(testContext({ workspaceId: other }), workspaceId);
    expect(event.workspaceId).toBe(other);
  });

  it('propagates the actor for audit attribution', () => {
    const event = workspaceSuspendedEvent(
      testContext({ actor: { kind: 'agent', id: 'agt_1' } }),
      workspaceId,
      'policy',
    );
    expect(event.actor).toEqual({ kind: 'agent', id: 'agt_1' });
  });
});
