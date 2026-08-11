/**
 * Contribution shape tests: permissions, navigation, pages, widgets,
 * commands, events, configuration, workflow, knowledge, search, and
 * notifications — plus the ContributionSet collection.
 */

import { describe, expect, it } from 'vitest';

import { BasePlugin, ContributionSet, type PluginContribution } from '../src/base/index.js';
import { PluginConfiguration } from '../src/configuration/index.js';
import { MockPlugin } from '../src/testing/index.js';

describe('Permission contributions', () => {
  it('declares permissions, roles, policies, and approvals', () => {
    const permission: PluginContribution = {
      kind: 'permission',
      permissions: [{ name: 'projects.create', scopes: ['projects:write'] }],
    };
    const role: PluginContribution = {
      kind: 'role',
      roles: [
        {
          name: 'projects.lead',
          level: 'application',
          permissions: ['projects.create'],
          approver: true,
        },
      ],
    };
    const policy: PluginContribution = {
      kind: 'policy',
      policyIds: ['p1'],
      governs: ['projects:write'],
    };
    const approval: PluginContribution = {
      kind: 'approval',
      approverRoles: ['projects.lead'],
      delegatable: true,
      timeoutMs: 86_400_000,
    };
    expect(permission.kind).toBe('permission');
    expect(role.kind).toBe('role');
    expect(policy.kind).toBe('policy');
    expect(approval.kind).toBe('approval');
  });
});

describe('Navigation and routes', () => {
  it('declares a navigation and a route contribution', () => {
    const navigation: PluginContribution = {
      kind: 'navigation',
      sidebar: [{ id: 'projects', label: 'Projects', route: '/projects' }],
      topBar: [],
      palette: [],
    };
    const route: PluginContribution = {
      kind: 'route',
      path: '/projects/:id',
      componentId: 'cmp.project-detail',
      requiredScope: 'projects:read',
    };
    expect(navigation.kind).toBe('navigation');
    expect(route.kind).toBe('route');
  });
});

describe('Pages, dashboards, views, widgets', () => {
  it('declares page, dashboard, view, and widget contributions', () => {
    const page: PluginContribution = {
      kind: 'page',
      id: 'p1',
      title: 'T',
      componentId: 'c',
      route: '/r',
    };
    const dashboard: PluginContribution = {
      kind: 'dashboard',
      id: 'd1',
      title: 'D',
      widgetIds: ['w1'],
    };
    const view: PluginContribution = {
      kind: 'view',
      id: 'v1',
      title: 'V',
      componentId: 'c',
      layout: 'board',
    };
    const widget: PluginContribution = {
      kind: 'widget',
      id: 'w1',
      title: 'W',
      widget: { kind: 'metric', label: 'L', sourceKey: 'k' },
    };
    expect(page.kind).toBe('page');
    expect(dashboard.kind).toBe('dashboard');
    expect(view.kind).toBe('view');
    expect(widget.kind).toBe('widget');
  });
});

describe('Commands and events', () => {
  it('declares a command contribution', () => {
    const command: PluginContribution = {
      kind: 'command',
      command: { id: 'c1', name: 'C', description: 'd', keywords: [] },
      handler: () => undefined,
    };
    expect(command.kind).toBe('command');
  });

  it('declares an event contribution with subscriptions', () => {
    const event: PluginContribution = {
      kind: 'event',
      emits: ['project.created'],
      subscriptions: [{ eventType: 'employee.hired', handler: () => undefined, awaitable: true }],
    };
    expect(event.kind).toBe('event');
    expect(event.emits).toEqual(['project.created']);
    expect(event.subscriptions[0]?.eventType).toBe('employee.hired');
  });
});

describe('Configuration', () => {
  it('declares a configuration contribution', () => {
    const contribution: PluginContribution = {
      kind: 'configuration',
      schema: {
        id: 'com.nexora.projects.settings',
        title: 'Projects Settings',
        properties: { defaultView: { type: 'enum', enum: ['board', 'list'], default: 'board' } },
        required: [],
      },
      defaults: { defaultView: 'board' },
    };
    expect(contribution.kind).toBe('configuration');
  });

  it('provides typed configuration access', () => {
    const config = new PluginConfiguration({ theme: 'dark', retries: 3 });
    expect(config.get<string>('theme')).toBe('dark');
    expect(config.getOrDefault('retries', 0)).toBe(3);
    expect(config.getOrDefault('missing', 'fallback')).toBe('fallback');
    expect(config.has('theme')).toBe(true);
    expect(config.has('missing')).toBe(false);
    config.set('theme', 'light');
    expect(config.get('theme')).toBe('light');
    expect(config.all()).toEqual({ theme: 'light', retries: 3 });
  });
});

describe('Workflow', () => {
  it('declares a workflow contribution with a template', () => {
    const contribution: PluginContribution = {
      kind: 'workflow',
      templates: [
        {
          id: 'com.nexora.hr.onboarding',
          name: 'Onboarding',
          description: 'Employee onboarding',
          trigger: { kind: 'event', eventType: 'employee.hired', description: 'On hire' },
          definition: {
            id: 'wfd_1',
            key: 'hr.onboarding',
            version: 1,
            startStepId: 's1',
            steps: [
              {
                id: 's1',
                name: 'Create account',
                kind: 'ai_task',
                capabilityId: 'hr.create_account',
                next: { succeeded: 's2' },
              },
              {
                id: 's2',
                name: 'Approve',
                kind: 'human_task',
                assigneeRole: 'hr.manager',
                next: {},
              },
            ],
            approvalPoints: {
              s2: { approverRoles: ['hr.manager'], timeoutMs: 86_400_000, delegatable: true },
            },
            timeoutMs: 604_800_000,
            status: 'validated',
          },
        },
      ],
    };
    expect(contribution.kind).toBe('workflow');
    expect(contribution.templates[0]?.trigger.kind).toBe('event');
  });
});

describe('Knowledge, search, notifications', () => {
  it('declares a knowledge contribution (agent-sdk provider)', () => {
    const contribution: PluginContribution = {
      kind: 'knowledge',
      provider: {
        name: 'projects-knowledge',
        retrieve: async () => ({ references: [], citations: [], servedAt: 't' }),
      },
      sources: [{ id: 'src_1', kind: 'app.records', name: 'Projects' }],
    };
    expect(contribution.kind).toBe('knowledge');
    expect(contribution.provider.name).toBe('projects-knowledge');
  });

  it('declares a search contribution with a provider', () => {
    const contribution: PluginContribution = {
      kind: 'search',
      provider: {
        name: 'projects-search',
        indexes: [{ id: 'projects.tasks', name: 'Tasks', fields: ['title'], tenantScoped: true }],
        search: async () => [],
      },
    };
    expect(contribution.kind).toBe('search');
    expect(contribution.provider.indexes[0]?.id).toBe('projects.tasks');
  });

  it('declares a notification contribution with a provider', () => {
    const contribution: PluginContribution = {
      kind: 'notification',
      provider: {
        name: 'projects-notify',
        channels: ['inbox', 'email'],
        send: async () => undefined,
      },
      notificationTypes: ['project.assigned'],
    };
    expect(contribution.kind).toBe('notification');
    expect(contribution.provider.channels).toContain('inbox');
  });
});

describe('ContributionSet', () => {
  it('stores and returns contributions by kind', () => {
    const set = new ContributionSet();
    const navigation: PluginContribution = {
      kind: 'navigation',
      sidebar: [],
      topBar: [],
      palette: [],
    };
    const command: PluginContribution = {
      kind: 'command',
      command: { id: 'c1', name: 'C', description: 'd', keywords: [] },
      handler: () => undefined,
    };
    set.add(navigation);
    set.add(command);
    expect(set.size).toBe(2);
    expect(set.byKind('navigation')).toHaveLength(1);
    expect(set.byKind('command')).toHaveLength(1);
    expect(set.byKind('page')).toHaveLength(0);
    expect(set.has('navigation')).toBe(true);
    expect(set.has('page')).toBe(false);
    expect(set.all()).toHaveLength(2);
  });

  it('deduplicates identical contributions by identity, not by kind', () => {
    const set = new ContributionSet();
    const page: PluginContribution = {
      kind: 'page',
      id: 'p1',
      title: 'T',
      componentId: 'c',
      route: '/r',
    };
    set.add(page);
    set.add(page);
    // Same identity ('p1') -> deduplicated.
    expect(set.size).toBe(1);

    // A distinct page with a different id is preserved.
    set.add({ ...page, id: 'p2', title: 'U', route: '/r2' });
    expect(set.size).toBe(2);
    const pages = set.byKind('page');
    expect(pages.map((entry) => (entry.kind === 'page' ? entry.id : ''))).toEqual(['p1', 'p2']);
  });

  it('preserves distinct kind-keyed contributions instead of collapsing them', () => {
    const set = new ContributionSet();
    // Two navigation contributions for different areas must both be kept.
    set.add({
      kind: 'navigation',
      sidebar: [{ id: 'projects', label: 'Projects', route: '/projects' }],
      topBar: [],
      palette: [],
    });
    set.add({
      kind: 'navigation',
      sidebar: [{ id: 'reports', label: 'Reports', route: '/reports' }],
      topBar: [],
      palette: [],
    });
    // Two permission contributions declaring different permission sets.
    set.add({
      kind: 'permission',
      permissions: [{ name: 'projects.create', scopes: ['projects:write'] }],
    });
    set.add({
      kind: 'permission',
      permissions: [{ name: 'finance.review', scopes: ['finance:write'] }],
    });
    // Two event contributions emitting different event types.
    set.add({ kind: 'event', emits: ['EmployeeCreated'], subscriptions: [] });
    set.add({ kind: 'event', emits: ['InvoiceGenerated'], subscriptions: [] });

    expect(set.size).toBe(6);
    expect(set.byKind('navigation')).toHaveLength(2);
    expect(set.byKind('permission')).toHaveLength(2);
    expect(set.byKind('event')).toHaveLength(2);
  });

  it('aggregates a plugin registration surface', () => {
    const plugin = new MockPlugin();
    plugin.registerNavigation({ kind: 'navigation', sidebar: [], topBar: [], palette: [] });
    plugin.registerCommand({
      kind: 'command',
      command: { id: 'c1', name: 'C', description: 'd', keywords: [] },
      handler: () => undefined,
    });
    plugin.registerWidget({
      kind: 'widget',
      id: 'w1',
      title: 'W',
      widget: { kind: 'metric', label: 'L', sourceKey: 'k' },
    });
    expect(plugin.contributions.size).toBe(3);
    expect(plugin.contributions.byKind('command')).toHaveLength(1);
  });

  it('accepts a contribution via the generic registerContribution', () => {
    const plugin = new MockPlugin();
    plugin.registerContribution({
      kind: 'role',
      roles: [{ name: 'projects.lead', level: 'application', permissions: [], approver: false }],
    });
    expect(plugin.contributions.has('role')).toBe(true);
  });

  it('BasePlugin implements the PluginHooks contract', () => {
    const plugin = new MockPlugin();
    expect(typeof plugin.onInstall).toBe('function');
    expect(typeof plugin.onEnable).toBe('function');
    expect(typeof plugin.onDisable).toBe('function');
    expect(typeof plugin.onUpdate).toBe('function');
    expect(typeof plugin.onUninstall).toBe('function');
    expect(plugin).toBeInstanceOf(BasePlugin);
  });
});
