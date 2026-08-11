/**
 * WorkspaceDomainService tests: create (with slug uniqueness), lifecycle
 * transitions, settings/branding/preferences updates, feature toggles, all
 * five bindings, and query paths — using in-memory repository fakes.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  InvalidWorkspaceValueError,
  SlugAlreadyExistsError,
  WorkspaceArchivedError,
  WorkspaceNotFoundError,
  WorkspaceStateTransitionError,
} from '../src/errors/index.js';
import { WORKSPACE_EVENT_TYPES } from '../src/events/index.js';
import { WorkspaceDomainService } from '../src/services/workspace-domain-service.js';
import { WorkspaceId } from '../src/value-objects/workspace-id.js';
import { InMemoryWorkspaceRepository, testContext } from './helpers.js';

const ORGANIZATION = 'tenant_1' as TenantId;
const context = testContext();

function createService() {
  const workspaces = new InMemoryWorkspaceRepository();
  const service = new WorkspaceDomainService({ workspaces });
  return { workspaces, service };
}

async function createActiveWorkspace(
  service: WorkspaceDomainService,
  slug = 'engineering',
): Promise<WorkspaceId> {
  const result = await service.create(
    {
      organizationId: ORGANIZATION,
      slug,
      name: 'Engineering',
      type: 'engineering',
    },
    context,
  );
  if (!result.ok) {
    throw new Error('createActiveWorkspace failed');
  }
  const activation = await service.activate(result.value.workspace.id, context);
  if (!activation.ok) {
    throw new Error('activate failed');
  }
  return activation.value.workspace.id;
}

describe('WorkspaceDomainService.create', () => {
  it('creates a provisioning workspace and emits WorkspaceCreated', async () => {
    const { service } = createService();
    const result = await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'Engineering', type: 'engineering' },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.status.value).toBe('provisioning');
    expect(result.value.events.map((event) => event.type)).toEqual([
      WORKSPACE_EVENT_TYPES.workspaceCreated,
    ]);
    expect(result.value.events[0]?.tenantId).toBe(ORGANIZATION);
  });

  it('persists the created workspace in the repository', async () => {
    const { service, workspaces } = createService();
    const result = await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'Engineering', type: 'engineering' },
      context,
    );
    if (!result.ok) return;
    expect(workspaces.findById(result.value.workspace.id)).resolves.toBeDefined();
  });

  it('honors an explicit visibility and status', async () => {
    const { service } = createService();
    const result = await service.create(
      {
        organizationId: ORGANIZATION,
        slug: 'eng',
        name: 'Engineering',
        type: 'engineering',
        visibility: 'company',
        status: 'active',
      },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.visibility.value).toBe('company');
    expect(result.value.workspace.status.value).toBe('active');
  });

  it('rejects a slug that already exists in the organization', async () => {
    const { service } = createService();
    await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'One', type: 'engineering' },
      context,
    );
    const result = await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'Two', type: 'engineering' },
      context,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(SlugAlreadyExistsError);
  });

  it('allows the same slug in a different organization', async () => {
    const { service } = createService();
    const first = await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'One', type: 'engineering' },
      context,
    );
    expect(first.ok).toBe(true);
    const second = await service.create(
      { organizationId: 'tenant_2' as TenantId, slug: 'eng', name: 'Two', type: 'engineering' },
      context,
    );
    expect(second.ok).toBe(true);
  });

  it('rejects an invalid workspace type', async () => {
    const { service } = createService();
    const result = await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'E', type: 'bogus' },
      context,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(InvalidWorkspaceValueError);
  });

  it('rejects an invalid slug', async () => {
    const { service } = createService();
    const result = await service.create(
      { organizationId: ORGANIZATION, slug: 'Bad Slug!', name: 'E', type: 'engineering' },
      context,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(InvalidWorkspaceValueError);
  });
});

describe('WorkspaceDomainService lifecycle', () => {
  it('activates a provisioning workspace', async () => {
    const { service } = createService();
    const created = await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'E', type: 'engineering' },
      context,
    );
    if (!created.ok) return;
    const result = await service.activate(created.value.workspace.id, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.status.value).toBe('active');
    expect(result.value.events.map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.workspaceActivated,
    );
  });

  it('fails to activate a missing workspace', async () => {
    const { service } = createService();
    const result = await service.activate(WorkspaceId.create(), context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('fails to activate an already-active workspace', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const result = await service.activate(id, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceStateTransitionError);
  });

  it('suspends an active workspace with a reason', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const result = await service.suspend(id, 'compliance', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.status.value).toBe('suspended');
    expect(result.value.events.map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.workspaceSuspended,
    );
  });

  it('fails to suspend a provisioning workspace', async () => {
    const { service } = createService();
    const created = await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'E', type: 'engineering' },
      context,
    );
    if (!created.ok) return;
    const result = await service.suspend(created.value.workspace.id, 'x', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceStateTransitionError);
  });

  it('archives an active workspace', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const result = await service.archive(id, 'project ended', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.status.value).toBe('archived');
    expect(result.value.events.map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.workspaceArchived,
    );
  });

  it('fails to archive a provisioning workspace', async () => {
    const { service } = createService();
    const created = await service.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'E', type: 'engineering' },
      context,
    );
    if (!created.ok) return;
    const result = await service.archive(created.value.workspace.id, 'x', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceStateTransitionError);
  });
});

describe('WorkspaceDomainService settings/branding/preferences', () => {
  it('updates settings and emits SettingsUpdated', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const result = await service.updateSettings(
      id,
      { defaultLocale: 'de-DE', aiEnabled: false },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.settings.defaultLocale.value).toBe('de-DE');
    expect(result.value.events.map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.settingsUpdated,
    );
  });

  it('rejects settings updates on an archived workspace', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    await service.archive(id, 'done', context);
    const result = await service.updateSettings(id, { aiEnabled: false }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceArchivedError);
  });

  it('rejects invalid settings values', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const result = await service.updateSettings(id, { defaultTimezone: '' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(InvalidWorkspaceValueError);
  });

  it('updates branding and emits BrandingUpdated', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const result = await service.updateBranding(id, { color: '#00FF00', icon: '🚀' }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.branding.color.value).toBe('#00ff00');
    expect(result.value.events.map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.brandingUpdated,
    );
  });

  it('updates preferences silently (no events)', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const result = await service.updatePreferences(id, { theme: 'dark' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.preferences.theme).toBe('dark');
    expect(result.value.events).toHaveLength(0);
  });

  it('fails updatePreferences on an archived workspace', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    await service.archive(id, 'done', context);
    const result = await service.updatePreferences(id, { theme: 'dark' });
    expect(result.ok).toBe(false);
  });
});

describe('WorkspaceDomainService features', () => {
  it('enables and disables a feature', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const enabled = await service.enableFeature(id, 'ai_autonomy');
    expect(enabled.ok).toBe(true);
    const workspace = await service.findById(id);
    if (!workspace.ok) return;
    expect(workspace.value.isFeatureEnabled('ai_autonomy')).toBe(true);
    const disabled = await service.disableFeature(id, 'ai_autonomy');
    expect(disabled.ok).toBe(true);
    const after = await service.findById(id);
    if (!after.ok) return;
    expect(after.value.isFeatureEnabled('ai_autonomy')).toBe(false);
  });

  it('rejects feature changes on a missing workspace', async () => {
    const { service } = createService();
    const result = await service.enableFeature(WorkspaceId.create(), 'flag');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });
});

describe('WorkspaceDomainService bindings', () => {
  it('attaches and detaches an agent', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const attached = await service.attachAgent(id, 'agt_hr', context);
    expect(attached.ok).toBe(true);
    const detached = await service.detachAgent(id, 'agt_hr', context);
    expect(detached.ok).toBe(true);
    if (!detached.ok) return;
    expect(detached.value.events.map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.agentUnbound,
    );
  });

  it('attaches and detaches knowledge sources', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const attached = await service.attachKnowledge(id, 'knl_1', context);
    expect(attached.ok).toBe(true);
    const detached = await service.detachKnowledge(id, 'knl_1', context);
    expect(detached.ok).toBe(true);
    if (!detached.ok) return;
    expect(detached.value.events.map((event) => event.type)).toContain(
      WORKSPACE_EVENT_TYPES.knowledgeDetached,
    );
  });

  it('attaches and detaches workflows', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const attached = await service.attachWorkflow(id, 'wfl_1', context);
    expect(attached.ok).toBe(true);
    const detached = await service.detachWorkflow(id, 'wfl_1', context);
    expect(detached.ok).toBe(true);
  });

  it('attaches the search provider and the notification provider', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const search = await service.attachSearchProvider(id, 'typesense', context);
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    expect(search.value.workspace.searchProvider).toBe('typesense');
    const notif = await service.attachNotificationProvider(id, 'slack', context);
    expect(notif.ok).toBe(true);
    if (!notif.ok) return;
    expect(notif.value.workspace.notificationProvider).toBe('slack');
  });

  it('rejects binding changes on an archived workspace', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    await service.archive(id, 'done', context);
    const result = await service.attachAgent(id, 'agt_1', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceArchivedError);
  });

  it('rejects binding changes on a missing workspace', async () => {
    const { service } = createService();
    const result = await service.attachAgent(WorkspaceId.create(), 'agt_1', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });
});

describe('WorkspaceDomainService queries', () => {
  it('finds a workspace by id', async () => {
    const { service } = createService();
    const id = await createActiveWorkspace(service);
    const result = await service.findById(id);
    expect(result.ok).toBe(true);
  });

  it('returns NotFound for a missing id', async () => {
    const { service } = createService();
    const result = await service.findById(WorkspaceId.create());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('finds a workspace by slug within the organization', async () => {
    const { service } = createService();
    await createActiveWorkspace(service, 'finance');
    const result = await service.findBySlug(ORGANIZATION, 'finance');
    expect(result.ok).toBe(true);
  });

  it('returns NotFound for a slug in the wrong organization', async () => {
    const { service } = createService();
    await createActiveWorkspace(service, 'finance');
    const result = await service.findBySlug('tenant_2' as TenantId, 'finance');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('lists all workspaces of an organization', async () => {
    const { service } = createService();
    await createActiveWorkspace(service, 'alpha');
    await createActiveWorkspace(service, 'beta');
    const result = await service.listByOrganization(ORGANIZATION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });
});
