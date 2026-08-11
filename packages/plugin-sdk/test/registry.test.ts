/**
 * PluginRegistry tests.
 */

import { describe, expect, it } from 'vitest';

import { PluginRegistry } from '../src/registry/index.js';
import { MockPlugin, testPluginManifest } from '../src/testing/index.js';

function entry(overrides: Partial<Parameters<PluginRegistry['register']>[0]> = {}) {
  const plugin = new MockPlugin({
    manifest: testPluginManifest({ id: 'com.nexora.test', version: '1.2.3' }),
  });
  return {
    plugin,
    descriptor: {
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      state: 'installed' as const,
    },
    state: 'installed' as const,
    registeredAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('PluginRegistry', () => {
  it('registers and resolves entries', () => {
    const registry = new PluginRegistry();
    registry.register(entry());
    const resolved = registry.resolve('com.nexora.test');
    expect(resolved?.descriptor.version).toBe('1.2.3');
    expect(resolved?.plugin).toBeInstanceOf(MockPlugin);
  });

  it('throws on duplicate ids', () => {
    const registry = new PluginRegistry();
    registry.register(entry());
    expect(() => registry.register(entry())).toThrow(/already registered/);
  });

  it('unregisters entries', () => {
    const registry = new PluginRegistry();
    registry.register(entry());
    expect(registry.unregister('com.nexora.test')).toBe(true);
    expect(registry.unregister('com.nexora.test')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('lists ids and entries', () => {
    const registry = new PluginRegistry();
    registry.register(entry());
    registry.register(
      entry({
        descriptor: { id: 'com.nexora.other', name: 'Other', version: '1.0.0', state: 'active' },
        state: 'enabled',
      }),
    );
    expect([...registry.ids()].sort()).toEqual(['com.nexora.other', 'com.nexora.test']);
    expect(registry.all()).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it('updates state and projects the canonical descriptor state', () => {
    const registry = new PluginRegistry();
    registry.register(entry());
    registry.updateState('com.nexora.test', 'enabled', { enabledAt: 't1' });
    const resolved = registry.resolve('com.nexora.test');
    expect(resolved?.state).toBe('enabled');
    expect(resolved?.descriptor.state).toBe('active');
    expect(resolved?.enabledAt).toBe('t1');
  });

  it('records lastError on failure state', () => {
    const registry = new PluginRegistry();
    registry.register(entry());
    registry.updateState('com.nexora.test', 'failed', { lastError: 'boom' });
    expect(registry.resolve('com.nexora.test')?.lastError).toBe('boom');
  });

  it('updateState is a no-op for unknown ids', () => {
    const registry = new PluginRegistry();
    expect(() => registry.updateState('com.nexora.nope', 'enabled')).not.toThrow();
  });

  it('is a PluginResolver', () => {
    const registry = new PluginRegistry();
    registry.register(entry());
    const resolver: { resolve(id: string): unknown } = registry;
    expect(resolver.resolve('com.nexora.test')).toBeDefined();
  });
});
