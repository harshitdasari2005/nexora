/**
 * WorkspaceInstallation aggregate tests: creation, event emission, and
 * versioning.
 */

import { describe, expect, it } from 'vitest';

import { WORKSPACE_EVENT_TYPES, type PluginInstalledPayload } from '../src/events/index.js';
import { WorkspaceInstallation } from '../src/entities/workspace-installation.js';
import { WorkspaceId } from '../src/value-objects/workspace-id.js';
import { testContext } from './helpers.js';

const context = testContext();
const WORKSPACE = WorkspaceId.create();

function createInstallation(
  overrides: Partial<Parameters<typeof WorkspaceInstallation.create>[0]> = {},
): WorkspaceInstallation {
  return WorkspaceInstallation.create(
    {
      workspaceId: WORKSPACE,
      pluginId: 'plugin-hr',
      pluginVersion: '1.2.0',
      ...overrides,
    },
    context,
  );
}

describe('WorkspaceInstallation aggregate', () => {
  it('creates with the given plugin and version and emits PluginInstalled', () => {
    const installation = createInstallation();
    expect(installation.id).toMatch(/^ins_/);
    expect(installation.workspaceId).toBe(WORKSPACE);
    expect(installation.pluginId).toBe('plugin-hr');
    expect(installation.pluginVersion).toBe('1.2.0');
    expect(installation.version).toBe(1);
    expect(installation.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const events = installation.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(WORKSPACE_EVENT_TYPES.pluginInstalled);
    if (events[0]) {
      const payload = events[0].payload as PluginInstalledPayload;
      expect(payload.workspaceId).toBe(WORKSPACE);
      expect(payload.pluginId).toBe('plugin-hr');
      expect(payload.pluginVersion).toBe('1.2.0');
      expect(payload.installationId).toBe(installation.id);
    }
  });

  it('honors an explicit install time', () => {
    const installation = WorkspaceInstallation.create(
      {
        workspaceId: WORKSPACE,
        pluginId: 'plugin-finance',
        pluginVersion: '2.0.0',
      },
      context,
      '2026-03-15T08:30:00.000Z',
    );
    expect(installation.installedAt).toBe('2026-03-15T08:30:00.000Z');
  });

  it('stores the plugin version verbatim', () => {
    const installation = createInstallation({ pluginVersion: '3.0.0-beta.1' });
    expect(installation.pluginVersion).toBe('3.0.0-beta.1');
  });

  it('pullDomainEvents clears the queue', () => {
    const installation = createInstallation();
    expect(installation.pullDomainEvents().length).toBeGreaterThan(0);
    expect(installation.pullDomainEvents()).toHaveLength(0);
  });
});
