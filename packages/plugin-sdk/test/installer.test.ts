/**
 * DefaultPluginInstaller tests: install, enable, disable, upgrade,
 * uninstall, rollback, dependency resolution, and failure containment.
 */

import { describe, expect, it } from 'vitest';

import {
  PluginDependencyError,
  PluginLifecycleError,
  PluginValidationError,
} from '../src/errors/index.js';
import { DefaultPluginInstaller } from '../src/installer/index.js';
import { PluginRegistry } from '../src/registry/index.js';
import { MockPlugin, testPluginManifest } from '../src/testing/index.js';

function makeInstaller(): { installer: DefaultPluginInstaller; registry: PluginRegistry } {
  const registry = new PluginRegistry();
  const installer = new DefaultPluginInstaller({
    registry,
    platformVersion: '0.1.0',
    sdkVersion: '0.1.0',
  });
  return { installer, registry };
}

describe('DefaultPluginInstaller', () => {
  it('installs and enables a valid plugin', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin();
    const entry = await installer.install({ plugin });
    expect(registry.size).toBe(1);
    expect(entry.state).toBe('enabled');
    expect(plugin.lifecycle.state).toBe('enabled');
    expect(plugin.activated).toBe(true);
    expect(plugin.hookCalls).toEqual(['onInstall:com.nexora.test', 'onEnable:com.nexora.test']);
  });

  it('installs without enabling when requested', async () => {
    const { installer } = makeInstaller();
    const plugin = new MockPlugin();
    const entry = await installer.install({ plugin, enableAfterInstall: false });
    expect(entry.state).toBe('installed');
    expect(plugin.lifecycle.state).toBe('installed');
    expect(plugin.activated).toBe(false);
    expect(plugin.hookCalls).toEqual(['onInstall:com.nexora.test']);
  });

  it('rejects an invalid manifest without registering', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin({ manifest: testPluginManifest({ id: 'bad' }) });
    await expect(installer.install({ plugin })).rejects.toThrow(PluginValidationError);
    expect(registry.size).toBe(0);
    expect(plugin.lifecycle.state).toBe('failed');
  });

  it('rejects an incompatible manifest', async () => {
    const { installer } = makeInstaller();
    const plugin = new MockPlugin({
      manifest: testPluginManifest({
        compatibility: { platformApiVersion: '2.0.0', sdkVersion: '2.0.0' },
      }),
    });
    await expect(installer.install({ plugin })).rejects.toThrow();
  });

  it('rejects missing dependencies', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin({
      manifest: testPluginManifest({
        dependencies: [{ id: 'com.nexora.identity', range: '^1.0.0' }],
      }),
    });
    await expect(installer.install({ plugin })).rejects.toThrow(PluginDependencyError);
    expect(registry.size).toBe(0);
  });

  it('accepts satisfied dependencies', async () => {
    const { installer, registry } = makeInstaller();
    const dep = new MockPlugin({
      manifest: testPluginManifest({ id: 'com.nexora.identity', name: 'Identity' }),
    });
    await installer.install({ plugin: dep, enableAfterInstall: false });

    const plugin = new MockPlugin({
      manifest: testPluginManifest({
        id: 'com.nexora.projects',
        name: 'Projects',
        dependencies: [{ id: 'com.nexora.identity', range: '^1.0.0' }],
      }),
    });
    const entry = await installer.install({ plugin });
    expect(entry.state).toBe('enabled');
    expect(registry.size).toBe(2);
  });

  it('rolls back cleanly when activation fails during install', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin({}, () => {
      throw new Error('activate exploded');
    });
    await expect(installer.install({ plugin })).rejects.toThrow('activate exploded');
    expect(registry.size).toBe(0);
    expect(plugin.lifecycle.state).toBe('uninstalled');
  });

  it('enables a previously installed plugin', async () => {
    const { installer } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin, enableAfterInstall: false });
    const entry = await installer.enable('com.nexora.test');
    expect(entry.state).toBe('enabled');
    expect(plugin.activated).toBe(true);
  });

  it('disables an enabled plugin and runs deactivate', async () => {
    const { installer } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin });
    const entry = await installer.disable('com.nexora.test');
    expect(entry.state).toBe('disabled');
    expect(plugin.lifecycle.state).toBe('disabled');
    expect(plugin.activated).toBe(false);
    expect(plugin.hookCalls).toContain('onDisable:com.nexora.test');
  });

  it('re-enables a disabled plugin', async () => {
    const { installer } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin });
    await installer.disable('com.nexora.test');
    const entry = await installer.enable('com.nexora.test');
    expect(entry.state).toBe('enabled');
  });

  it('upgrades a plugin to a new version and preserves enabled state', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin });

    const next = new MockPlugin({
      manifest: testPluginManifest({ version: '2.0.0' }),
    });
    const entry = await installer.upgrade('com.nexora.test', { plugin: next });
    expect(entry.descriptor.version).toBe('2.0.0');
    expect(entry.state).toBe('enabled');
    expect(registry.resolve('com.nexora.test')?.plugin).toBe(next);
    expect(next.hookCalls).toContain('onUpdate:com.nexora.test:1.0.0');
    expect(next.activated).toBe(true);
  });

  it('rejects an upgrade id mismatch', async () => {
    const { installer } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin });
    const next = new MockPlugin({
      manifest: testPluginManifest({ id: 'com.nexora.other', name: 'Other' }),
    });
    await expect(installer.upgrade('com.nexora.test', { plugin: next })).rejects.toThrow(
      PluginLifecycleError,
    );
  });

  it('restores the previous version when an upgrade activation fails', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin });

    // The new version fails to activate after the registry swap.
    const next = new MockPlugin({ manifest: testPluginManifest({ version: '2.0.0' }) }, () => {
      throw new Error('activate exploded');
    });

    await expect(installer.upgrade('com.nexora.test', { plugin: next })).rejects.toThrow(
      'activate exploded',
    );

    // The previous working version is back in place, still enabled.
    const restored = registry.resolve('com.nexora.test');
    expect(restored?.plugin).toBe(plugin);
    expect(restored?.descriptor.version).toBe('1.0.0');
    expect(restored?.state).toBe('enabled');
    expect(restored?.plugin.isActivated).toBe(true);
    // The broken new instance is never registered.
    expect(registry.size).toBe(1);
    expect(next.lifecycle.state).toBe('failed');
  });

  it('marks the previous version failed when deactivation throws during upgrade', async () => {
    const { installer, registry } = makeInstaller();

    // A plugin whose deactivation fails (subclassing MockPlugin to inject the
    // failure at the right seam).
    class DeactivateBombPlugin extends MockPlugin {
      override async deactivate(): Promise<void> {
        throw new Error('deactivate exploded');
      }
    }
    const plugin = new DeactivateBombPlugin();
    await installer.install({ plugin });

    const next = new MockPlugin({ manifest: testPluginManifest({ version: '2.0.0' }) });

    await expect(installer.upgrade('com.nexora.test', { plugin: next })).rejects.toThrow(
      'deactivate exploded',
    );

    // The old entry stays put but is marked failed (recoverable via rollback),
    // and the new instance was never swapped in.
    const entry = registry.resolve('com.nexora.test');
    expect(entry?.plugin).toBe(plugin);
    expect(entry?.state).toBe('failed');
    expect(plugin.lifecycle.state).toBe('failed');
    expect(registry.size).toBe(1);
  });

  it('uninstalls a plugin and removes the registry entry', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin });
    await installer.uninstall('com.nexora.test');
    expect(registry.size).toBe(0);
    expect(plugin.lifecycle.state).toBe('uninstalled');
    expect(plugin.hookCalls).toContain('onUninstall:com.nexora.test');
  });

  it('uninstall is idempotent for unknown ids', async () => {
    const { installer } = makeInstaller();
    await expect(installer.uninstall('com.nexora.nope')).resolves.toBeUndefined();
  });

  it('rolls a failed plugin back to installed', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin, enableAfterInstall: false });

    // Force a failure via a throwing enable.
    plugin.lifecycle.transition('failed', 'forced');
    registry.updateState('com.nexora.test', 'failed', { lastError: 'forced' });

    const entry = await installer.rollback('com.nexora.test');
    expect(entry.state).toBe('installed');
    expect(entry.lastError).toBeUndefined();
  });

  it('rejects rollback for non-failed plugins', async () => {
    const { installer } = makeInstaller();
    const plugin = new MockPlugin();
    await installer.install({ plugin, enableAfterInstall: false });
    await expect(installer.rollback('com.nexora.test')).rejects.toThrow(PluginLifecycleError);
  });

  it('throws PluginLifecycleError for unknown ids on enable', async () => {
    const { installer } = makeInstaller();
    await expect(installer.enable('com.nexora.nope')).rejects.toThrow(PluginLifecycleError);
  });

  it('moves a plugin to failed when activation throws on enable', async () => {
    const { installer, registry } = makeInstaller();
    const plugin = new MockPlugin({}, () => {
      throw new Error('enable exploded');
    });
    await installer.install({ plugin, enableAfterInstall: false });
    await expect(installer.enable('com.nexora.test')).rejects.toThrow('enable exploded');
    expect(plugin.lifecycle.state).toBe('failed');
    expect(registry.resolve('com.nexora.test')?.lastError).toBe('enable exploded');
  });
});
