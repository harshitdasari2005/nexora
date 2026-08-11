/**
 * Registry tests: tools, skills, capabilities, and agents.
 */

import { describe, expect, it } from 'vitest';

import { CapabilityRegistry } from '../src/capabilities/index.js';
import { AgentRegistry } from '../src/registry/index.js';
import { SkillRegistry } from '../src/skills/index.js';
import { ToolRegistry } from '../src/tools/index.js';
import { MockSkill, MockTool, testManifest } from '../src/testing/index.js';

function toolManifest(id: string) {
  return {
    id,
    name: id,
    description: 'd',
    sideEffectClass: 'read_only' as const,
    idempotent: true,
    timeoutMs: 1000,
    inputSchema: {},
  };
}

function skillManifest(id: string) {
  return {
    id,
    name: id,
    description: 'd',
    capabilityIds: [],
    toolIds: [],
    autonomyTier: 'supervised' as const,
    requiresApproval: false,
  };
}

function capabilityManifest(id: string) {
  return {
    id,
    name: id,
    description: 'd',
    skillId: 's1',
    sideEffectClass: 'read_only' as const,
    mutatesState: false,
  };
}

describe('ToolRegistry', () => {
  it('registers and resolves tools', () => {
    const registry = new ToolRegistry();
    const tool = new MockTool(toolManifest('t1'));
    registry.register(tool);
    expect(registry.resolve('t1')).toBe(tool);
    expect(registry.resolve('missing')).toBeUndefined();
    expect(registry.size).toBe(1);
  });

  it('rejects duplicate registrations', () => {
    const registry = new ToolRegistry();
    registry.register(new MockTool(toolManifest('t1')));
    expect(() => registry.register(new MockTool(toolManifest('t1')))).toThrowError(
      /already registered/,
    );
  });

  it('describes tools with metadata', () => {
    const registry = new ToolRegistry();
    registry.register(new MockTool(toolManifest('t1')));
    const descriptor = registry.describe('t1');
    expect(descriptor?.manifest.id).toBe('t1');
    expect(descriptor?.metadata.invocationCount).toBe(0);
  });

  it('records invocations for metrics', () => {
    const registry = new ToolRegistry();
    registry.register(new MockTool(toolManifest('t1')));
    registry.recordInvocation('t1');
    registry.recordInvocation('t1');
    expect(registry.describe('t1')?.metadata.invocationCount).toBe(2);
  });

  it('lists ids and converts to canonical contracts', () => {
    const registry = new ToolRegistry();
    registry.register(new MockTool(toolManifest('t1')));
    registry.register(new MockTool(toolManifest('t2')));
    expect(registry.ids()).toEqual(['t1', 't2']);
    const contracts = registry.toContracts();
    expect(contracts).toHaveLength(2);
    expect(contracts[0]?.id).toBe('t1');
  });
});

describe('SkillRegistry', () => {
  it('registers and resolves skills', () => {
    const registry = new SkillRegistry();
    const skill = new MockSkill(skillManifest('s1'));
    registry.register(skill);
    expect(registry.resolve('s1')).toBe(skill);
    expect(registry.size).toBe(1);
  });

  it('rejects duplicate registrations', () => {
    const registry = new SkillRegistry();
    registry.register(new MockSkill(skillManifest('s1')));
    expect(() => registry.register(new MockSkill(skillManifest('s1')))).toThrowError();
  });

  it('describes skills and lists ids', () => {
    const registry = new SkillRegistry();
    registry.register(new MockSkill(skillManifest('s1')));
    expect(registry.describe('s1')?.manifest.id).toBe('s1');
    expect(registry.ids()).toEqual(['s1']);
  });

  it('converts to canonical skill contracts', () => {
    const registry = new SkillRegistry();
    registry.register(new MockSkill(skillManifest('s1')));
    const contracts = registry.toContracts();
    expect(contracts[0]).toMatchObject({
      id: 's1',
      autonomyTier: 'supervised',
      requiresApproval: false,
    });
  });
});

describe('CapabilityRegistry', () => {
  it('registers, resolves, and unregisters capabilities', () => {
    const registry = new CapabilityRegistry();
    const capability = { manifest: capabilityManifest('c1') };
    registry.register(capability);
    expect(registry.resolve('c1')).toBe(capability);
    expect(registry.unregister('c1')).toBe(true);
    expect(registry.unregister('c1')).toBe(false);
    expect(registry.resolve('c1')).toBeUndefined();
  });

  it('rejects duplicate registrations', () => {
    const registry = new CapabilityRegistry();
    registry.register({ manifest: capabilityManifest('c1') });
    expect(() => registry.register({ manifest: capabilityManifest('c1') })).toThrowError();
  });

  it('describes and lists capabilities', () => {
    const registry = new CapabilityRegistry();
    registry.register({ manifest: capabilityManifest('c1') });
    expect(registry.describe('c1')?.metadata.id).toBe('c1');
    expect(registry.ids()).toEqual(['c1']);
    expect(registry.size).toBe(1);
  });

  it('converts to canonical capability contracts', () => {
    const registry = new CapabilityRegistry();
    registry.register({ manifest: capabilityManifest('c1') });
    const contracts = registry.toContracts();
    expect(contracts[0]).toMatchObject({ id: 'c1', mutatesState: false });
  });
});

describe('AgentRegistry', () => {
  it('registers, resolves, and lists agents', () => {
    const registry = new AgentRegistry();
    const manifest = testManifest();
    registry.register({
      identity: manifest.identity,
      manifest,
      metadata: { id: manifest.identity.id, registeredAt: '2026-08-08T00:00:00.000Z' },
    });
    expect(registry.resolve('agt_test')?.manifest.version).toBe('1.0.0');
    expect(registry.all()).toHaveLength(1);
    expect(registry.size).toBe(1);
  });

  it('rejects duplicate agent registrations', () => {
    const registry = new AgentRegistry();
    const manifest = testManifest();
    const descriptor = {
      identity: manifest.identity,
      manifest,
      metadata: { id: manifest.identity.id, registeredAt: '2026-08-08T00:00:00.000Z' },
    };
    registry.register(descriptor);
    expect(() => registry.register(descriptor)).toThrowError(/already registered/);
  });

  it('unregisters agents', () => {
    const registry = new AgentRegistry();
    const manifest = testManifest();
    registry.register({
      identity: manifest.identity,
      manifest,
      metadata: { id: manifest.identity.id, registeredAt: '2026-08-08T00:00:00.000Z' },
    });
    expect(registry.unregister('agt_test')).toBe(true);
    expect(registry.size).toBe(0);
  });
});
