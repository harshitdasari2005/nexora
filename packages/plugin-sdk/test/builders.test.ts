/**
 * Fluent builder tests.
 */

import { describe, expect, it } from 'vitest';

import {
  CommandBuilder,
  NavigationBuilder,
  PageBuilder,
  PluginManifestBuilder,
  WidgetBuilder,
} from '../src/builders/index.js';

describe('PluginManifestBuilder', () => {
  it('builds a minimal valid manifest', () => {
    const manifest = new PluginManifestBuilder('com.nexora.projects', 'Projects', '1.0.0').build();
    expect(manifest.id).toBe('com.nexora.projects');
    expect(manifest.name).toBe('Projects');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.capabilities).toEqual([]);
    expect(manifest.permissions).toEqual({ required: [], granted: [] });
    expect(manifest.events).toEqual({ emits: [], subscribes: [] });
    expect(manifest.compatibility).toBeDefined();
  });

  it('accumulates capabilities, scopes, events, and dependencies', () => {
    const manifest = new PluginManifestBuilder('com.nexora.projects', 'Projects', '1.0.0')
      .withCapability({ id: 'projects.create_project', description: 'Create', skillId: 's.create' })
      .withCapability({ id: 'projects.list_projects', description: 'List', skillId: 's.list' })
      .requires('projects:read')
      .grants('projects:write')
      .emits('project.created')
      .subscribes('employee.hired')
      .dependsOn({ id: 'com.nexora.identity', range: '^1.0.0' })
      .build();
    expect(manifest.capabilities).toHaveLength(2);
    expect(manifest.permissions.required).toEqual(['projects:read']);
    expect(manifest.permissions.granted).toEqual(['projects:write']);
    expect(manifest.events.emits).toEqual(['project.created']);
    expect(manifest.events.subscribes).toEqual(['employee.hired']);
    expect(manifest.dependencies).toEqual([{ id: 'com.nexora.identity', range: '^1.0.0' }]);
  });

  it('adds navigation registrations', () => {
    const manifest = new PluginManifestBuilder('com.nexora.projects', 'Projects', '1.0.0')
      .withNavigation('projects', 'Projects', 'folder')
      .build();
    expect(manifest.navigation).toEqual([{ id: 'projects', label: 'Projects', icon: 'folder' }]);
  });
});

describe('NavigationBuilder', () => {
  it('builds a navigation contribution with all surfaces', () => {
    const contribution = new NavigationBuilder()
      .ownedBy('com.nexora.projects')
      .addSidebarItem({ id: 'projects', label: 'Projects', route: '/projects' })
      .addTopBarItem({ id: 'search', label: 'Search', route: '/search' })
      .addPaletteItem({ id: 'pal.new', keywords: ['new', 'project'], action: 'projects.new' })
      .build();
    expect(contribution.kind).toBe('navigation');
    expect(contribution.sidebar).toHaveLength(1);
    expect(contribution.topBar).toHaveLength(1);
    expect(contribution.palette).toHaveLength(1);
    expect(contribution.pluginId).toBe('com.nexora.projects');
  });

  it('supports nested sidebar children', () => {
    const contribution = new NavigationBuilder()
      .addSidebarItem({
        id: 'hr',
        label: 'HR',
        route: '/hr',
        children: [{ id: 'hr.people', label: 'People', route: '/hr/people' }],
      })
      .build();
    expect(contribution.sidebar[0]?.children).toHaveLength(1);
  });
});

describe('CommandBuilder', () => {
  it('builds a command contribution', () => {
    const handler = () => 'done';
    const contribution = new CommandBuilder(
      {
        id: 'projects.new',
        name: 'New Project',
        description: 'Create a project',
        keywords: ['new'],
      },
      handler,
    )
      .ownedBy('com.nexora.projects')
      .exposeToAi()
      .build();
    expect(contribution.kind).toBe('command');
    expect(contribution.command.id).toBe('projects.new');
    expect(contribution.command.pluginId).toBe('com.nexora.projects');
    expect(contribution.exposeToAi).toBe(true);
    expect(contribution.handler).toBe(handler);
  });

  it('keeps exposeToAi false by default', () => {
    const contribution = new CommandBuilder(
      { id: 'x', name: 'X', description: 'd', keywords: [] },
      () => undefined,
    ).build();
    expect(contribution.exposeToAi).toBe(false);
  });
});

describe('PageBuilder', () => {
  it('builds a page contribution with optional settings', () => {
    const page = new PageBuilder(
      'com.nexora.projects.overview',
      'Overview',
      'cmp.overview',
      '/projects',
    )
      .requiresScope('projects:read')
      .withSettingsSchema('com.nexora.projects.settings')
      .ownedBy('com.nexora.projects')
      .build();
    expect(page.kind).toBe('page');
    expect(page.id).toBe('com.nexora.projects.overview');
    expect(page.requiredScope).toBe('projects:read');
    expect(page.settingsSchemaId).toBe('com.nexora.projects.settings');
    expect(page.pluginId).toBe('com.nexora.projects');
  });
});

describe('WidgetBuilder', () => {
  it('builds a metric widget contribution', () => {
    const widget = new WidgetBuilder('com.nexora.projects.active', 'Active Projects', {
      kind: 'metric',
      label: 'Active',
      sourceKey: 'projects.active',
    })
      .refreshEvery(30_000)
      .requiresScope('projects:read')
      .build();
    expect(widget.kind).toBe('widget');
    expect(widget.widget.kind).toBe('metric');
    expect(widget.refreshMs).toBe(30_000);
    expect(widget.requiredScope).toBe('projects:read');
  });

  it('builds a card widget contribution', () => {
    const widget = new WidgetBuilder('com.nexora.projects.card', 'Feed', {
      kind: 'card',
      componentId: 'cmp.project-feed',
    }).build();
    expect(widget.widget).toEqual({ kind: 'card', componentId: 'cmp.project-feed' });
  });
});
