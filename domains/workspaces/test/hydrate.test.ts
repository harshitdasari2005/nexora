/**
 * Aggregate reconstitution tests: `snapshot()` → `hydrate()` round-trips must
 * restore exact identity, timestamps, version, and child state WITHOUT
 * emitting domain events (PERSISTENCE.md §4 reconstitution).
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { Workspace } from '../src/entities/workspace.js';
import { WorkspaceMembership } from '../src/entities/workspace-membership.js';
import { WorkspaceInstallation } from '../src/entities/workspace-installation.js';
import { WorkspaceSlug } from '../src/value-objects/workspace-slug.js';
import { WorkspaceType } from '../src/value-objects/workspace-type.js';
import { WorkspaceStatus } from '../src/value-objects/workspace-status.js';
import { testContext } from './helpers.js';

const ORGANIZATION = 'tenant_1' as TenantId;
const context = testContext();

function createWorkspace() {
  return Workspace.create(
    {
      organizationId: ORGANIZATION,
      slug: WorkspaceSlug.create('engineering'),
      name: 'Engineering',
      type: WorkspaceType.engineering(),
      status: WorkspaceStatus.active(),
    },
    context,
  );
}

describe('Workspace hydrate round-trip', () => {
  it('restores identity, children, bindings, and version without events', () => {
    const workspace = createWorkspace();
    workspace.pullDomainEvents();
    workspace.updateSettings({ defaultLocale: 'de-DE', aiEnabled: false }, context);
    workspace.updateBranding({ color: '#00FF00', icon: '🚀' }, context);
    workspace.updatePreferences({ theme: 'dark', density: 'compact' });
    workspace.enableFeature('ai_autonomy');
    workspace.attachAgent('agt_hr', context);
    workspace.attachKnowledge('knl_1', context);
    workspace.attachWorkflow('wfl_1', context);
    workspace.attachSearchProvider('typesense', context);
    workspace.attachNotificationProvider('slack', context);
    workspace.pullDomainEvents();
    const before = workspace.version;

    const hydrated = Workspace.hydrate(Workspace.snapshot(workspace));
    expect(hydrated.id).toBe(workspace.id);
    expect(hydrated.organizationId).toBe(ORGANIZATION);
    expect(hydrated.slug.value).toBe('engineering');
    expect(hydrated.name.value).toBe('Engineering');
    expect(hydrated.status.value).toBe('active');
    expect(hydrated.settings.defaultLocale.value).toBe('de-DE');
    expect(hydrated.settings.aiEnabled).toBe(false);
    expect(hydrated.branding.color.value).toBe('#00ff00');
    expect(hydrated.preferences.theme).toBe('dark');
    expect(hydrated.preferences.density).toBe('compact');
    expect(hydrated.isFeatureEnabled('ai_autonomy')).toBe(true);
    expect(hydrated.boundAgentIds).toEqual(['agt_hr']);
    expect(hydrated.boundKnowledgeIds).toEqual(['knl_1']);
    expect(hydrated.boundWorkflowIds).toEqual(['wfl_1']);
    expect(hydrated.searchProvider).toBe('typesense');
    expect(hydrated.notificationProvider).toBe('slack');
    expect(hydrated.createdAt).toBe(workspace.createdAt);
    expect(hydrated.updatedAt).toBe(workspace.updatedAt);
    expect(hydrated.version).toBe(before);
    expect(hydrated.pullDomainEvents()).toHaveLength(0);
  });

  it('hydrated workspaces remain mutable and policy-enforcing', () => {
    const workspace = Workspace.create(
      {
        organizationId: ORGANIZATION,
        slug: WorkspaceSlug.create('engineering'),
        name: 'Engineering',
        type: WorkspaceType.engineering(),
      },
      context,
    );
    const hydrated = Workspace.hydrate(Workspace.snapshot(workspace));
    hydrated.activate(context);
    expect(hydrated.status.value).toBe('active');
    expect(hydrated.isActive()).toBe(true);
  });
});

describe('WorkspaceMembership hydrate round-trip', () => {
  it('restores role, timestamps, and version', () => {
    const membership = WorkspaceMembership.create(
      {
        workspaceId: createWorkspace().id,
        userId: prefixedId('usr') as UserId,
        role: 'member',
      },
      context,
    );
    membership.changeRole('admin');
    const before = membership.version;

    const hydrated = WorkspaceMembership.hydrate(WorkspaceMembership.snapshot(membership));
    expect(hydrated.id).toBe(membership.id);
    expect(hydrated.workspaceId).toBe(membership.workspaceId);
    expect(hydrated.userId).toBe(membership.userId);
    expect(hydrated.role).toBe('admin');
    expect(hydrated.joinedAt).toBe(membership.joinedAt);
    expect(hydrated.version).toBe(before);
    expect(hydrated.pullDomainEvents()).toHaveLength(0);
  });
});

describe('WorkspaceInstallation hydrate round-trip', () => {
  it('restores plugin, version, and timestamps', () => {
    const installation = WorkspaceInstallation.create(
      {
        workspaceId: createWorkspace().id,
        pluginId: 'plugin-hr',
        pluginVersion: '1.2.0',
      },
      context,
    );
    const hydrated = WorkspaceInstallation.hydrate(WorkspaceInstallation.snapshot(installation));
    expect(hydrated.id).toBe(installation.id);
    expect(hydrated.workspaceId).toBe(installation.workspaceId);
    expect(hydrated.pluginId).toBe('plugin-hr');
    expect(hydrated.pluginVersion).toBe('1.2.0');
    expect(hydrated.installedAt).toBe(installation.installedAt);
    expect(hydrated.version).toBe(1);
    expect(hydrated.pullDomainEvents()).toHaveLength(0);
  });
});
