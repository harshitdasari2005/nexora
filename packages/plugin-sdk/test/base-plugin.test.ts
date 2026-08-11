/**
 * BasePlugin tests: identity, manifest, lifecycle wiring, configuration,
 * health, activation, and dependencies.
 */

import { describe, expect, it } from 'vitest';

import { MockAgent, MockSkill, MockTool, testManifest } from '@nexora/agent-sdk/testing';

import { PluginConfiguration } from '../src/configuration/index.js';
import { MockPlugin, testPluginManifest } from '../src/testing/index.js';

describe('BasePlugin', () => {
  it('derives identity and version from the manifest', () => {
    const plugin = new MockPlugin({
      manifest: testPluginManifest({
        id: 'com.nexora.projects',
        name: 'Projects',
        version: '2.1.0',
      }),
    });
    expect(plugin.identity).toEqual({ id: 'com.nexora.projects', name: 'Projects' });
    expect(plugin.version).toBe('2.1.0');
    expect(plugin.manifest.id).toBe('com.nexora.projects');
  });

  it('exposes metadata when provided', () => {
    const metadata = { author: 'Nexora', license: 'Apache-2.0', description: 'Projects app' };
    const plugin = new MockPlugin({ metadata });
    expect(plugin.metadata).toEqual(metadata);
  });

  it('starts in the discovered lifecycle state', () => {
    const plugin = new MockPlugin();
    expect(plugin.lifecycle.state).toBe('discovered');
    expect(plugin.isActivated).toBe(false);
  });

  it('builds the configuration store from defaults', () => {
    const plugin = new MockPlugin({ settings: { theme: 'dark' } });
    expect(plugin.configuration).toBeInstanceOf(PluginConfiguration);
    expect(plugin.configuration.get('theme')).toBe('dark');
  });

  it('defaults platformVersion when not injected', () => {
    const plugin = new MockPlugin();
    expect(plugin.platformVersion).toBe('0.0.0');
  });

  it('honors the injected platformVersion', () => {
    const plugin = new MockPlugin({ platformVersion: '0.3.0' });
    expect(plugin.platformVersion).toBe('0.3.0');
  });

  it('reports healthy when all health checks pass', async () => {
    const plugin = new MockPlugin();
    plugin.registerHealthCheck('memory', () => true);
    plugin.registerHealthCheck('io', async () => true);
    const snapshot = await plugin.health();
    expect(snapshot.status).toBe('healthy');
    expect(snapshot.checks).toHaveLength(2);
  });

  it('reports degraded when some checks fail', async () => {
    const plugin = new MockPlugin();
    plugin.registerHealthCheck('ok', () => true);
    plugin.registerHealthCheck('bad', () => false);
    const snapshot = await plugin.health();
    expect(snapshot.status).toBe('degraded');
  });

  it('reports unavailable when all checks fail and captures details', async () => {
    const plugin = new MockPlugin();
    plugin.registerHealthCheck('a', () => {
      throw new Error('down');
    });
    const snapshot = await plugin.health();
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.checks[0]?.detail).toBe('down');
  });

  it('reports healthy with no registered checks', async () => {
    const plugin = new MockPlugin();
    expect((await plugin.health()).status).toBe('healthy');
  });

  it('tracks activation state', () => {
    const plugin = new MockPlugin();
    plugin.setActivated();
    expect(plugin.isActivated).toBe(true);
    plugin.setDeactivated();
    expect(plugin.isActivated).toBe(false);
  });

  it('registers every contribution kind through typed methods', () => {
    const plugin = new MockPlugin();
    plugin.registerPermission({ kind: 'permission', permissions: [] });
    plugin.registerRole({ kind: 'role', roles: [] });
    plugin.registerPolicy({ kind: 'policy', policyIds: [], governs: [] });
    plugin.registerApproval({
      kind: 'approval',
      approverRoles: [],
      delegatable: false,
      timeoutMs: 1,
    });
    plugin.registerNavigation({ kind: 'navigation', sidebar: [], topBar: [], palette: [] });
    plugin.registerRoute({ kind: 'route', path: '/x', componentId: 'c' });
    plugin.registerPage({ kind: 'page', id: 'p', title: 'T', componentId: 'c', route: '/p' });
    plugin.registerDashboard({ kind: 'dashboard', id: 'd', title: 'D', widgetIds: [] });
    plugin.registerView({ kind: 'view', id: 'v', title: 'V', componentId: 'c', layout: 'list' });
    plugin.registerWidget({
      kind: 'widget',
      id: 'w',
      title: 'W',
      widget: { kind: 'card', componentId: 'c' },
    });
    plugin.registerCommand({
      kind: 'command',
      command: { id: 'c', name: 'C', description: 'd', keywords: [] },
      handler: () => undefined,
    });
    plugin.registerEvent({ kind: 'event', emits: [], subscriptions: [] });
    plugin.registerConfiguration({
      kind: 'configuration',
      schema: { id: 's', title: 'S', properties: {} },
      defaults: {},
    });
    plugin.registerWorkflow({ kind: 'workflow', templates: [] });
    plugin.registerKnowledge({
      kind: 'knowledge',
      provider: {
        name: 'k',
        retrieve: async () => ({ references: [], citations: [], servedAt: 't' }),
      },
      sources: [],
    });
    plugin.registerSearch({
      kind: 'search',
      provider: { name: 's', indexes: [], search: async () => [] },
    });
    plugin.registerNotifications({
      kind: 'notification',
      provider: { name: 'n', channels: ['inbox'], send: async () => undefined },
      notificationTypes: [],
    });
    plugin.registerAgent({
      kind: 'agent',
      id: 'agt_a',
      agent: () =>
        new MockAgent(testManifest({ identity: { id: 'agt_a', name: 'a', displayName: 'A' } })),
    });
    plugin.registerTool({
      kind: 'tool',
      id: 'tool_t',
      tool: new MockTool({
        id: 'tool_t',
        name: 'T',
        description: 'Tool',
        sideEffectClass: 'read_only',
        idempotent: true,
        timeoutMs: 1000,
        inputSchema: {},
      }),
    });
    plugin.registerSkill({
      kind: 'skill',
      id: 'skill_s',
      skill: new MockSkill({
        id: 'skill_s',
        name: 'S',
        description: 'Skill',
        capabilityIds: [],
        toolIds: [],
        autonomyTier: 'supervised',
        requiresApproval: false,
      }),
    });
    plugin.registerCapability({
      kind: 'capability',
      capability: {
        manifest: {
          id: 'cap_c',
          name: 'C',
          description: 'Capability',
          skillId: 'skill_s',
          sideEffectClass: 'read_only',
          mutatesState: false,
        },
      },
    });
    expect(plugin.contributions.size).toBe(21);
  });

  it('accepts a config manager dependency', () => {
    const plugin = new MockPlugin({ configManager: {} as never });
    expect(plugin.configuration).toBeInstanceOf(PluginConfiguration);
  });

  it('runs activate and records it', async () => {
    const plugin = new MockPlugin();
    await plugin.activate({
      pluginId: 'com.nexora.test',
      version: '1.0.0',
      configuration: plugin.configuration,
      platformVersion: '0.1.0',
      sdkVersion: '0.1.0',
      logger: plugin['logger'] as never,
    });
    expect(plugin.activated).toBe(true);
  });
});
