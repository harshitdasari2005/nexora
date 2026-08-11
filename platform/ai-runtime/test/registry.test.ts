/**
 * @nexora/ai-runtime — registry tests.
 */

import { describe, expect, it } from 'vitest';

import { RuntimeRegistry, registryEntries, registryKey } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';

describe('RuntimeRegistry', () => {
  const capability = {
    id: 'projects.create_project',
    name: 'Create project',
    description: 'Creates a new project',
    skillId: 'projects.create',
    sideEffectClass: 'state_change' as const,
  };

  it('registers and resolves entries', () => {
    const registry = new RuntimeRegistry();
    const entry = registryEntries.capability({
      capability,
      owner: 'com.nexora.projects',
      version: '1.0.0',
    });
    registry.register(entry);
    expect(registry.resolve('capability', capability.id)?.id).toBe(capability.id);
  });

  it('throws on duplicate registration', () => {
    const registry = new RuntimeRegistry();
    registry.register(registryEntries.capability({ capability, owner: 'a', version: '1.0.0' }));
    expect(() =>
      registry.register(registryEntries.capability({ capability, owner: 'b', version: '1.0.0' })),
    ).toThrow(/already registered/);
  });

  it('only returns active entries from typed queries', () => {
    const registry = new RuntimeRegistry();
    const entry = registryEntries.capability({ capability, owner: 'a', version: '1.0.0' });
    registry.register(entry);
    registry.setActive('capability', capability.id, false);
    expect(registry.capabilities()).toHaveLength(0);
    registry.setActive('capability', capability.id, true);
    expect(registry.capabilities()).toHaveLength(1);
  });

  it('lists all entries of a type including inactive', () => {
    const registry = new RuntimeRegistry();
    registry.register(registryEntries.capability({ capability, owner: 'a', version: '1.0.0' }));
    registry.setActive('capability', capability.id, false);
    expect(registry.allOf('capability')).toHaveLength(1);
  });

  it('updates and unregisters entries', () => {
    const registry = new RuntimeRegistry();
    const entry = registryEntries.capability({ capability, owner: 'a', version: '1.0.0' });
    registry.register(entry);
    registry.update({ ...entry, active: false });
    expect(registry.resolve('capability', capability.id)?.active).toBe(false);
    expect(registry.unregister('capability', capability.id)).toBe(true);
    expect(registry.resolve('capability', capability.id)).toBeUndefined();
  });

  it('tracks size across types', () => {
    const registry = new RuntimeRegistry();
    registry.register(registryEntries.capability({ capability, owner: 'a', version: '1.0.0' }));
    registry.register(
      registryEntries.tool({
        tool: {
          id: 'tool_create_project',
          description: 'creates',
          sideEffectClass: 'state_change',
          idempotent: false,
          timeoutMs: 1000,
          inputSchema: {},
        },
        owner: 'a',
        version: '1.0.0',
        ownedByAgents: [],
      }),
    );
    expect(registry.size).toBe(2);
  });
});

describe('registryKey', () => {
  it('composes registry and id', () => {
    expect(registryKey('capability', 'c1')).toBe('capability:c1');
  });
});

describe('SkillIndex', () => {
  const skill = {
    id: 'projects.create',
    description: 'creates a project',
    toolIds: ['tool_create_project'],
    autonomyTier: 'supervised' as const,
    requiresApproval: false,
  };

  it('indexes and resolves skills', () => {
    const index = new SkillIndex();
    index.index(skill, 'agt_projects');
    expect(index.resolve('projects.create')?.skill.id).toBe('projects.create');
    expect(index.resolve('projects.create')?.agentId).toBe('agt_projects');
  });

  it('throws on duplicate skill ids', () => {
    const index = new SkillIndex();
    index.index(skill, 'a');
    expect(() => index.index(skill, 'b')).toThrow(/already indexed/);
  });

  it('removes skills', () => {
    const index = new SkillIndex();
    index.index(skill, 'a');
    expect(index.remove('projects.create')).toBe(true);
    expect(index.size).toBe(0);
  });

  it('tracks plugin id when provided', () => {
    const index = new SkillIndex();
    index.index(skill, 'a', 'com.nexora.projects');
    expect(index.resolve('projects.create')?.pluginId).toBe('com.nexora.projects');
  });
});

describe('ExecutableToolRegistry', () => {
  const makeTool = (id: string) => ({
    manifest: {
      id,
      name: id,
      description: `Tool ${id}`,
      sideEffectClass: 'read_only' as const,
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: {},
    },
    execute: async () => ({ ok: true, completedAt: new Date().toISOString() }),
  });

  it('registers and resolves tools', () => {
    const registry = new ExecutableToolRegistry();
    registry.register(makeTool('t1'));
    expect(registry.resolve('t1')?.manifest.id).toBe('t1');
  });

  it('throws on duplicate tool ids', () => {
    const registry = new ExecutableToolRegistry();
    registry.register(makeTool('t1'));
    expect(() => registry.register(makeTool('t1'))).toThrow(/already registered/);
  });

  it('lists ids and tracks size', () => {
    const registry = new ExecutableToolRegistry();
    registry.register(makeTool('t1'));
    registry.register(makeTool('t2'));
    expect(registry.ids()).toEqual(['t1', 't2']);
    expect(registry.size).toBe(2);
  });
});
