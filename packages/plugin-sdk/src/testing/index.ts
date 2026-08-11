/**
 * @nexora/plugin-sdk — testing support.
 *
 * Testing utilities for building and exercising plugins in unit tests:
 * mocks, fakes, and factories. Only for tests — not part of the runtime
 * surface.
 */

import type { PluginManifest, PluginCapability } from '@nexora/contracts/plugin';
import { createLogger } from '@nexora/shared/logger';

import { BasePlugin, type PluginContext, type PluginDependencies } from '../base/index.js';
import { PluginConfiguration } from '../configuration/index.js';
import type { PluginHookContext } from '../hooks/index.js';
import { PluginRegistry } from '../registry/index.js';
import type { PluginInstaller } from '../installer/index.js';

/**
 * Builds a minimal, valid plugin manifest for tests.
 *
 * @param overrides - optional manifest field overrides.
 */
export function testPluginManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'com.nexora.test',
    name: 'Test Plugin',
    version: '1.0.0',
    capabilities: [],
    permissions: { required: [], granted: [] },
    events: { emits: [], subscribes: [] },
    compatibility: { platformApiVersion: '0.1.0', sdkVersion: '0.1.0' },
    ...overrides,
  };
}

/** A capability helper for building test manifests. */
export function testCapability(id: string): PluginCapability {
  return { id, description: `Capability ${id}`, skillId: `skills.${id}` };
}

/**
 * A configurable mock plugin for tests. Records lifecycle hook invocations
 * and calls an optional activate handler.
 */
export class MockPlugin extends BasePlugin {
  /** Hook invocations in order (hook name + context). */
  readonly hookCalls: string[] = [];
  /** Whether `activate` was called. */
  activated = false;

  /**
   * @param dependencies - plugin dependencies (manifest defaulted).
   * @param activateHook - optional activation behavior.
   */
  constructor(
    dependencies: Partial<PluginDependencies> = {},
    private readonly activateHook?: (context: PluginContext) => Promise<void> | void,
  ) {
    super({ manifest: testPluginManifest(), ...dependencies });
  }

  /** A configured activate hook; records activation and runs the injected hook. */
  async activate(context: PluginContext): Promise<void> {
    this.activated = true;
    await this.activateHook?.(context);
  }

  /** Keeps the public flag in sync with the base activation state. */
  override setActivated(): void {
    super.setActivated();
    this.activated = true;
  }

  /** Keeps the public flag in sync with the base activation state. */
  override setDeactivated(): void {
    super.setDeactivated();
    this.activated = false;
  }

  /** @inheritdoc */
  override onInstall(context: PluginHookContext): void {
    this.hookCalls.push(`onInstall:${context.pluginId}`);
  }

  /** @inheritdoc */
  override onEnable(context: PluginHookContext): void {
    this.hookCalls.push(`onEnable:${context.pluginId}`);
  }

  /** @inheritdoc */
  override onDisable(context: PluginHookContext): void {
    this.hookCalls.push(`onDisable:${context.pluginId}`);
  }

  /** @inheritdoc */
  override onUpdate(context: PluginHookContext, previousVersion: string): void {
    this.hookCalls.push(`onUpdate:${context.pluginId}:${previousVersion}`);
  }

  /** @inheritdoc */
  override onUninstall(context: PluginHookContext): void {
    this.hookCalls.push(`onUninstall:${context.pluginId}`);
  }
}

/** Builds a valid fake plugin context for tests. */
export function fakePluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    pluginId: 'com.nexora.test',
    version: '1.0.0',
    configuration: new PluginConfiguration(),
    platformVersion: '0.1.0',
    sdkVersion: '0.1.0',
    logger: createLogger({ service: 'plugin-test' }),
    ...overrides,
  };
}

/** A registry pre-wired for tests (thin extension of {@link PluginRegistry}). */
export class FakeRegistry extends PluginRegistry {}

/** A recording fake installer: records operations without real logic. */
export class FakeInstaller implements PluginInstaller {
  /** Recorded operations in order. */
  readonly operations: string[] = [];

  async install(options: { plugin: BasePlugin; enableAfterInstall?: boolean }): Promise<never> {
    this.operations.push(`install:${options.plugin.identity.id}`);
    throw new Error('FakeInstaller does not install; use DefaultPluginInstaller');
  }

  async enable(id: string): Promise<never> {
    this.operations.push(`enable:${id}`);
    throw new Error('FakeInstaller does not enable; use DefaultPluginInstaller');
  }

  async disable(id: string): Promise<never> {
    this.operations.push(`disable:${id}`);
    throw new Error('FakeInstaller does not disable; use DefaultPluginInstaller');
  }

  async upgrade(
    id: string,
    _options: { plugin: BasePlugin; previousVersion?: string },
  ): Promise<never> {
    this.operations.push(`upgrade:${id}`);
    throw new Error('FakeInstaller does not upgrade; use DefaultPluginInstaller');
  }

  async uninstall(id: string): Promise<void> {
    this.operations.push(`uninstall:${id}`);
  }

  async rollback(id: string): Promise<never> {
    this.operations.push(`rollback:${id}`);
    throw new Error('FakeInstaller does not rollback; use DefaultPluginInstaller');
  }
}
