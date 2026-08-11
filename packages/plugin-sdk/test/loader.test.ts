/**
 * Plugin loader contract tests.
 */

import { describe, expect, it } from 'vitest';

import type { LoadOptions, LoadedPlugin, PluginLoader, PluginModule } from '../src/loader/index.js';
import { MockPlugin } from '../src/testing/index.js';

describe('Plugin loader contracts', () => {
  it('a plugin module is a default-exported factory', () => {
    const module: PluginModule = { default: () => new MockPlugin() };
    expect(typeof module.default).toBe('function');
    expect(module.default()).toBeInstanceOf(MockPlugin);
  });

  it('load options carry integrity checks', () => {
    const options: LoadOptions = {
      expectedId: 'com.nexora.projects',
      expectedVersion: '1.0.0',
      verifyIntegrity: true,
    };
    expect(options.verifyIntegrity).toBe(true);
  });

  it('a loaded plugin carries the module and id', () => {
    const loaded: LoadedPlugin = {
      module: { default: () => ({}) as never },
      id: 'com.nexora.projects',
      loadedAt: '2026-08-08T00:00:00.000Z',
    };
    expect(loaded.id).toBe('com.nexora.projects');
    expect(loaded.loadedAt).toMatch(/T/);
  });

  it('defines the PluginLoader contract', () => {
    const loader: PluginLoader = {
      name: 'node-loader',
      load: async (location, options) => ({
        module: { default: () => ({}) as never },
        id: options?.expectedId ?? location,
        loadedAt: 't',
      }),
    };
    expect(loader.name).toBe('node-loader');
  });
});
