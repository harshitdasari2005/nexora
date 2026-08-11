/**
 * Workspace aggregate tests: creation, lifecycle transitions, settings,
 * branding, preferences, feature flags, all five binding types, invariants,
 * and event emission.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  AgentAlreadyBoundError,
  AgentNotBoundError,
  InvalidWorkspaceValueError,
  KnowledgeAlreadyAttachedError,
  KnowledgeNotAttachedError,
  WorkflowAlreadyAttachedError,
  WorkflowNotAttachedError,
  WorkspaceStateTransitionError,
} from '../src/errors/index.js';
import {
  WORKSPACE_EVENT_TYPES,
  type AgentBoundPayload,
  type WorkspaceCreatedPayload,
  type WorkspaceSettingsUpdatedPayload,
} from '../src/events/index.js';
import { Workspace } from '../src/entities/workspace.js';
import { WorkspaceSlug } from '../src/value-objects/workspace-slug.js';
import { WorkspaceStatus } from '../src/value-objects/workspace-status.js';
import { WorkspaceType } from '../src/value-objects/workspace-type.js';
import { testContext } from './helpers.js';

const context = testContext();
const ORGANIZATION = 'tenant_1' as TenantId;

function createWorkspace(
  overrides: Partial<Parameters<typeof Workspace.create>[0]> = {},
): Workspace {
  return Workspace.create(
    {
      organizationId: ORGANIZATION,
      slug: WorkspaceSlug.create('engineering'),
      name: 'Engineering',
      type: WorkspaceType.engineering(),
      ...overrides,
    },
    context,
  );
}

describe('Workspace aggregate', () => {
  it('creates in provisioning status and emits WorkspaceCreated', () => {
    const workspace = createWorkspace();
    expect(workspace.id).toMatch(/^wsp_/);
    expect(workspace.organizationId).toBe(ORGANIZATION);
    expect(workspace.status.value).toBe('provisioning');
    expect(workspace.isActive()).toBe(false);
    const events = workspace.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(WORKSPACE_EVENT_TYPES.workspaceCreated);
    if (events[0]) {
      const payload = events[0].payload as WorkspaceCreatedPayload;
      expect(payload.slug).toBe('engineering');
      expect(payload.organizationId).toBe(ORGANIZATION);
      expect(payload.status).toBe('provisioning');
    }
  });

  it('honors explicit visibility, type, and initial status', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    expect(workspace.status.value).toBe('active');
    expect(workspace.visibility.value).toBe('private');
    expect(workspace.type.value).toBe('engineering');
  });

  it('applies default settings, branding, and preferences', () => {
    const workspace = createWorkspace();
    expect(workspace.settings.defaultLocale.value).toBe('en');
    expect(workspace.settings.defaultTimezone.value).toBe('UTC');
    expect(workspace.settings.aiEnabled).toBe(true);
    expect(workspace.settings.guestAccessEnabled).toBe(false);
    expect(workspace.branding.color.value).toBe('#4f46e5');
    expect(workspace.branding.icon.value).toBe('🧭');
    expect(workspace.preferences.theme).toBe('system');
    expect(workspace.preferences.density).toBe('comfortable');
  });

  it('activates a provisioning workspace and emits WorkspaceActivated', () => {
    const workspace = createWorkspace();
    workspace.activate(context);
    expect(workspace.status.value).toBe('active');
    expect(workspace.isActive()).toBe(true);
    const events = workspace.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(WORKSPACE_EVENT_TYPES.workspaceActivated);
  });

  it('rejects activating an already-active or archived workspace', () => {
    expect(() => createWorkspace({ status: WorkspaceStatus.active() }).activate(context)).toThrow(
      WorkspaceStateTransitionError,
    );
    expect(() => createWorkspace({ status: WorkspaceStatus.archived() }).activate(context)).toThrow(
      WorkspaceStateTransitionError,
    );
  });

  it('suspends an active workspace and emits WorkspaceSuspended', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.suspend('non-payment', context);
    expect(workspace.status.value).toBe('suspended');
    const events = workspace.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(WORKSPACE_EVENT_TYPES.workspaceSuspended);
  });

  it('rejects suspending a provisioning workspace', () => {
    expect(() => createWorkspace().suspend('x', context)).toThrow(WorkspaceStateTransitionError);
  });

  it('archives active and suspended workspaces and rejects others', () => {
    const active = createWorkspace({ status: WorkspaceStatus.active() });
    active.archive('closed', context);
    expect(active.status.value).toBe('archived');

    const suspended = createWorkspace({ status: WorkspaceStatus.suspended() });
    suspended.archive('closed', context);
    expect(suspended.status.value).toBe('archived');

    expect(() => createWorkspace().archive('x', context)).toThrow(WorkspaceStateTransitionError);
    expect(() =>
      createWorkspace({ status: WorkspaceStatus.archived() }).archive('x', context),
    ).toThrow(WorkspaceStateTransitionError);
  });

  it('reactivates a suspended workspace (suspended → active)', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.suspended() });
    workspace.activate(context);
    expect(workspace.status.value).toBe('active');
  });

  it('updates settings and emits WorkspaceSettingsUpdated with changed keys', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.updateSettings({ defaultLocale: 'de-DE', aiEnabled: false }, context);
    expect(workspace.settings.defaultLocale.value).toBe('de-DE');
    expect(workspace.settings.aiEnabled).toBe(false);
    const events = workspace.pullDomainEvents();
    const settingsEvent = events.find(
      (event) => event.type === WORKSPACE_EVENT_TYPES.settingsUpdated,
    );
    expect(
      (settingsEvent?.payload as WorkspaceSettingsUpdatedPayload | undefined)?.changedFields,
    ).toEqual(['defaultLocale', 'aiEnabled']);
  });

  it('emits no settings event and no version bump for an empty update', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.pullDomainEvents();
    const version = workspace.version;
    workspace.updateSettings({}, context);
    expect(workspace.pullDomainEvents()).toHaveLength(0);
    expect(workspace.version).toBe(version);
  });

  it('a rejected settings update leaves the settings unchanged', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.pullDomainEvents();
    const version = workspace.version;
    expect(() =>
      workspace.updateSettings({ defaultLocale: 'de-DE', defaultTimezone: '' }, context),
    ).toThrow(InvalidWorkspaceValueError);
    expect(workspace.settings.defaultLocale.value).toBe('en');
    expect(workspace.version).toBe(version);
  });

  it('updates branding and emits WorkspaceBrandingUpdated', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.updateBranding({ color: '#00FF00', icon: '🚀' }, context);
    expect(workspace.branding.color.value).toBe('#00ff00');
    const events = workspace.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(WORKSPACE_EVENT_TYPES.brandingUpdated);
  });

  it('a rejected branding update leaves the branding unchanged', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    const version = workspace.version;
    expect(() => workspace.updateBranding({ color: 'red' }, context)).toThrow(
      InvalidWorkspaceValueError,
    );
    expect(workspace.branding.color.value).toBe('#4f46e5');
    expect(workspace.version).toBe(version);
  });

  it('updates preferences silently (no event)', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.pullDomainEvents();
    workspace.updatePreferences({ theme: 'dark', density: 'compact' });
    expect(workspace.preferences.theme).toBe('dark');
    expect(workspace.preferences.density).toBe('compact');
    expect(workspace.pullDomainEvents()).toHaveLength(0);
  });

  it('rejects invalid preferences', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    expect(() => workspace.updatePreferences({ theme: 'neon' as never })).toThrow(
      InvalidWorkspaceValueError,
    );
  });

  it('enables and disables features silently', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.enableFeature('ai_autonomy');
    expect(workspace.isFeatureEnabled('ai_autonomy')).toBe(true);
    expect(workspace.features).toHaveLength(1);
    workspace.disableFeature('ai_autonomy');
    expect(workspace.isFeatureEnabled('ai_autonomy')).toBe(false);
    // Disabling an unknown feature is a no-op.
    workspace.disableFeature('missing');
    expect(workspace.features).toHaveLength(1);
  });

  it('rejects an invalid feature name', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    expect(() => workspace.enableFeature('Bad Name')).toThrow(InvalidWorkspaceValueError);
  });

  it('binds and unbinds agents with events', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.attachAgent('agt_hr', context);
    expect(workspace.hasAgentBound('agt_hr')).toBe(true);
    expect(workspace.boundAgentIds).toContain('agt_hr');
    const bound = workspace.pullDomainEvents();
    expect(bound.map((event) => event.type)).toContain(WORKSPACE_EVENT_TYPES.agentBound);
    const boundEvent = bound.find((event) => event.type === WORKSPACE_EVENT_TYPES.agentBound);
    expect((boundEvent?.payload as AgentBoundPayload | undefined)?.agentId).toBe('agt_hr');

    workspace.detachAgent('agt_hr', context);
    expect(workspace.hasAgentBound('agt_hr')).toBe(false);
    expect(workspace.pullDomainEvents().map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.agentUnbound,
    );
  });

  it('rejects binding the same agent twice and unbinding an unbound agent', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.attachAgent('agt_hr', context);
    expect(() => workspace.attachAgent('agt_hr', context)).toThrow(AgentAlreadyBoundError);
    expect(() => workspace.detachAgent('agt_missing', context)).toThrow(AgentNotBoundError);
  });

  it('attaches and detaches knowledge sources', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.attachKnowledge('knl_policies', context);
    expect(workspace.hasKnowledgeAttached('knl_policies')).toBe(true);
    expect(workspace.boundKnowledgeIds).toContain('knl_policies');
    expect(workspace.pullDomainEvents().map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.knowledgeAttached,
    );
    workspace.detachKnowledge('knl_policies', context);
    expect(workspace.hasKnowledgeAttached('knl_policies')).toBe(false);
  });

  it('rejects duplicate knowledge attach and missing detach', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.attachKnowledge('knl_1', context);
    expect(() => workspace.attachKnowledge('knl_1', context)).toThrow(
      KnowledgeAlreadyAttachedError,
    );
    expect(() => workspace.detachKnowledge('knl_missing', context)).toThrow(
      KnowledgeNotAttachedError,
    );
  });

  it('attaches and detaches workflows', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.attachWorkflow('wfl_onboarding', context);
    expect(workspace.hasWorkflowAttached('wfl_onboarding')).toBe(true);
    expect(workspace.boundWorkflowIds).toContain('wfl_onboarding');
    expect(workspace.pullDomainEvents().map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.workflowAttached,
    );
    workspace.detachWorkflow('wfl_onboarding', context);
    expect(workspace.hasWorkflowAttached('wfl_onboarding')).toBe(false);
  });

  it('rejects duplicate workflow attach and missing detach', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    workspace.attachWorkflow('wfl_1', context);
    expect(() => workspace.attachWorkflow('wfl_1', context)).toThrow(WorkflowAlreadyAttachedError);
    expect(() => workspace.detachWorkflow('wfl_missing', context)).toThrow(
      WorkflowNotAttachedError,
    );
  });

  it('attaches the search provider as a single slot (replace)', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    expect(workspace.attachSearchProvider('typesense', context)).toBe(true);
    expect(workspace.searchProvider).toBe('typesense');
    expect(workspace.pullDomainEvents().map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.searchProviderAttached,
    );
    // Same provider is a no-op and emits no event.
    expect(workspace.attachSearchProvider('typesense', context)).toBe(false);
    expect(workspace.pullDomainEvents()).toHaveLength(0);
    // Different provider replaces.
    expect(workspace.attachSearchProvider('meilisearch', context)).toBe(true);
    expect(workspace.searchProvider).toBe('meilisearch');
  });

  it('attaches the notification provider as a single slot (replace)', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    expect(workspace.attachNotificationProvider('slack', context)).toBe(true);
    expect(workspace.notificationProvider).toBe('slack');
    expect(workspace.pullDomainEvents().map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.notificationProviderAttached,
    );
    // Same provider is a no-op and emits no event.
    expect(workspace.attachNotificationProvider('slack', context)).toBe(false);
    expect(workspace.pullDomainEvents()).toHaveLength(0);
    expect(workspace.attachNotificationProvider('email', context)).toBe(true);
    expect(workspace.notificationProvider).toBe('email');
  });

  it('bumps the version on every mutation', () => {
    const workspace = createWorkspace({ status: WorkspaceStatus.active() });
    const initial = workspace.version;
    workspace.updateSettings({ defaultLocale: 'fr' }, context);
    expect(workspace.version).toBe(initial + 1);
    workspace.attachAgent('agt_1', context);
    expect(workspace.version).toBe(initial + 2);
    workspace.enableFeature('export');
    expect(workspace.version).toBe(initial + 3);
  });

  it('pullDomainEvents clears the queue', () => {
    const workspace = createWorkspace();
    workspace.pullDomainEvents();
    workspace.activate(context);
    expect(workspace.pullDomainEvents().length).toBeGreaterThan(0);
    expect(workspace.pullDomainEvents()).toHaveLength(0);
  });
});
