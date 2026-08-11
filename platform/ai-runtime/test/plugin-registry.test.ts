/**
 * @nexora/ai-runtime — plugin registry tests.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';

import { registerPluginAiSurface } from '../src/registry/plugin-registry.js';
import { RuntimeRegistry } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { nowIso } from '@nexora/shared/time';

const manifest = {
  id: 'com.nexora.projects',
  name: 'Projects',
  version: '1.0.0',
  capabilities: [
    { id: 'projects.create_project', description: 'Create a project', skillId: 'projects.create' },
  ],
  permissions: { required: [], granted: [] },
  events: { emits: [], subscribes: [] },
  compatibility: { platformApiVersion: '0.1.0', sdkVersion: '0.1.0' },
};

const tool: Tool = {
  manifest: {
    id: 'tool_create_project',
    name: 'Create project',
    description: 'creates',
    sideEffectClass: 'state_change',
    idempotent: false,
    timeoutMs: 1000,
    inputSchema: {},
  },
  execute: async () => ({ ok: true, output: { id: 1 }, completedAt: nowIso() }),
};

describe('registerPluginAiSurface', () => {
  it('registers the plugin entry', async () => {
    const registry = new RuntimeRegistry();
    const result = await registerPluginAiSurface({
      manifest,
      registry,
      skills: new SkillIndex(),
      tools: new ExecutableToolRegistry(),
    });
    expect(registry.plugins()).toHaveLength(1);
    expect(registry.plugins()[0]?.plugin.id).toBe('com.nexora.projects');
    expect(result.capabilityIds).toEqual([]);
  });

  it('registers capabilities and tools', async () => {
    const registry = new RuntimeRegistry();
    const tools = new ExecutableToolRegistry();
    const result = await registerPluginAiSurface({
      manifest,
      registry,
      skills: new SkillIndex(),
      tools,
      capabilities: [
        {
          id: 'projects.create_project',
          name: 'Create project',
          description: 'Create a project',
          skillId: 'projects.create',
          sideEffectClass: 'state_change',
        },
      ],
      toolContributions: [{ kind: 'tool', id: 'tool_create_project', tool }],
    });
    expect(result.capabilityIds).toEqual(['projects.create_project']);
    expect(result.toolIds).toEqual(['tool_create_project']);
    expect(registry.capabilities()).toHaveLength(1);
    expect(registry.tools()).toHaveLength(1);
    expect(tools.resolve('tool_create_project')).toBeDefined();
  });

  it('supports lazy contribution factories', async () => {
    const registry = new RuntimeRegistry();
    const result = await registerPluginAiSurface({
      manifest,
      registry,
      skills: new SkillIndex(),
      tools: new ExecutableToolRegistry(),
      capabilities: [
        {
          id: 'projects.create_project',
          name: 'Create project',
          description: 'Create a project',
          skillId: 'projects.create',
          sideEffectClass: 'state_change',
        },
      ],
      toolContributions: [{ kind: 'tool', id: 'tool_create_project', tool: () => tool }],
    });
    expect(result.toolIds).toEqual(['tool_create_project']);
  });

  it('registers agents and indexes their skills', async () => {
    const registry = new RuntimeRegistry();
    const skills = new SkillIndex();
    const agentManifest = {
      identity: { id: 'agt_hr', name: 'hr', displayName: 'HR Agent' },
      version: '1.0.0',
      skills: [
        {
          id: 'hr.hire',
          description: 'hires',
          toolIds: ['tool_hire'],
          autonomyTier: 'supervised' as const,
          requiresApproval: true,
        },
      ],
      tools: [
        {
          id: 'tool_hire',
          sideEffectClass: 'consequential' as const,
          idempotent: false,
          timeoutMs: 1000,
          inputSchema: {},
        },
      ],
      knowledgeScopes: [],
      policyIds: [],
      emittedEventTypes: [],
      subscribedEventTypes: [],
      updatedAt: '2026-08-08T00:00:00.000Z',
    };
    const fakeAgent = {
      identity: agentManifest.identity,
      manifest: agentManifest,
    } as never;
    const result = await registerPluginAiSurface({
      manifest,
      registry,
      skills,
      tools: new ExecutableToolRegistry(),
      agentContributions: [{ kind: 'agent', id: 'agt_hr', agent: () => fakeAgent }],
    });
    expect(result.agentIds).toEqual(['agt_hr']);
    expect(result.skillIds).toContain('hr.hire');
    expect(result.toolIds).toContain('tool_hire');
    expect(skills.resolve('hr.hire')?.agentId).toBe('agt_hr');
  });

  it('re-registration is idempotent (no duplicate entries, no throw)', async () => {
    const registry = new RuntimeRegistry();
    const tools = new ExecutableToolRegistry();
    const input = {
      manifest,
      registry,
      skills: new SkillIndex(),
      tools,
      capabilities: [
        {
          id: 'projects.create_project',
          name: 'Create project',
          description: 'Create a project',
          skillId: 'projects.create',
          sideEffectClass: 'state_change' as const,
        },
      ],
      toolContributions: [{ kind: 'tool' as const, id: 'tool_create_project', tool }],
    };
    const first = await registerPluginAiSurface(input);
    const second = await registerPluginAiSurface(input);
    expect(second.capabilityIds).toEqual([]);
    expect(second.toolIds).toEqual([]);
    expect(registry.plugins()).toHaveLength(1);
    expect(registry.capabilities()).toHaveLength(1);
    expect(registry.tools()).toHaveLength(1);
    expect(tools.size).toBe(1);
    expect(first.capabilityIds).toEqual(['projects.create_project']);
    expect(first.toolIds).toEqual(['tool_create_project']);
  });

  it('deduplicates skills contributed twice (skill + agent manifest)', async () => {
    const registry = new RuntimeRegistry();
    const skills = new SkillIndex();
    const agentManifest = {
      identity: { id: 'agt_hr', name: 'hr', displayName: 'HR Agent' },
      version: '1.0.0',
      skills: [
        {
          id: 'hr.hire',
          description: 'hires',
          toolIds: [],
          autonomyTier: 'supervised' as const,
          requiresApproval: false,
        },
      ],
      tools: [],
      knowledgeScopes: [],
      policyIds: [],
      emittedEventTypes: [],
      subscribedEventTypes: [],
      updatedAt: '2026-08-08T00:00:00.000Z',
    };
    const result = await registerPluginAiSurface({
      manifest,
      registry,
      skills,
      tools: new ExecutableToolRegistry(),
      skillContributions: [
        {
          kind: 'skill',
          id: 'hr.hire',
          skill: {
            manifest: {
              id: 'hr.hire',
              name: 'Hire',
              description: 'hires',
              capabilityIds: [],
              toolIds: [],
              autonomyTier: 'supervised',
              requiresApproval: false,
            },
            execute: async () => ({ ok: true, output: {} }),
          },
        },
      ],
      agentContributions: [
        {
          kind: 'agent',
          id: 'agt_hr',
          agent: { identity: agentManifest.identity, manifest: agentManifest } as never,
        },
      ],
    });
    // The agent path only indexes skills not already present — one index entry.
    expect(skills.size).toBe(1);
    expect(skills.resolve('hr.hire')?.skill.id).toBe('hr.hire');
    expect(result.skillIds).toContain('hr.hire');
  });
});
