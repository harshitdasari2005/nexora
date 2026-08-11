/**
 * Agent/skill/tool contribution tests: shapes, factories, and applying
 * contributions onto an Agent SDK BaseAgent.
 */

import { describe, expect, it } from 'vitest';

import { BaseAgent } from '@nexora/agent-sdk/base';
import { testManifest, fakeExecutionContext } from '@nexora/agent-sdk/testing';
import type { Result } from '@nexora/shared/result';

import { applyAgentContributions, resolveContribution } from '../src/agents/index.js';
import type { AgentContribution, CapabilityContribution } from '../src/agents/index.js';
import type { SkillContribution } from '../src/skills/index.js';
import type { ToolContribution } from '../src/tools/index.js';
import type { ExecutionFailure } from '@nexora/agent-sdk/types';

/** A minimal agent for applying contributions. */
class TestAgent extends BaseAgent<string, string> {
  constructor() {
    super({ manifest: testManifest() });
  }

  protected async execute(input: string): Promise<Result<string, ExecutionFailure>> {
    return { ok: true, value: `done:${input}` };
  }
}

describe('resolveContribution', () => {
  it('returns values directly', () => {
    expect(resolveContribution('value')).toBe('value');
  });

  it('invokes factories', () => {
    expect(resolveContribution(() => 'made')).toBe('made');
  });

  it('awaits async factories', async () => {
    await expect(resolveContribution(async () => 'async-made')).resolves.toBe('async-made');
  });
});

describe('Agent, skill, and tool contributions', () => {
  it('declares an agent contribution', () => {
    const contribution: AgentContribution = {
      kind: 'agent',
      id: 'agt_projects',
      agent: () => new TestAgent(),
    };
    expect(contribution.kind).toBe('agent');
    expect(contribution.id).toBe('agt_projects');
  });

  it('declares a skill contribution wrapping an agent-sdk skill', () => {
    const skill = {
      manifest: {
        id: 'skills.say_hi',
        name: 'say_hi',
        description: 'Says hi',
        capabilityIds: [],
        toolIds: [],
        autonomyTier: 'autonomous' as const,
        requiresApproval: false,
      },
      execute: async () => ({ ok: true as const, output: 'hi' }),
    };
    const contribution: SkillContribution = { kind: 'skill', id: 'skills.say_hi', skill };
    expect(contribution.skill).toBe(skill);
  });

  it('declares a tool contribution wrapping an agent-sdk tool', () => {
    const tool = {
      manifest: {
        id: 'tools.echo',
        name: 'echo',
        description: 'Echoes',
        sideEffectClass: 'read_only' as const,
        idempotent: true,
        timeoutMs: 1000,
        inputSchema: {},
      },
      execute: async () => ({ ok: true as const, output: {}, completedAt: 't' }),
    };
    const contribution: ToolContribution = { kind: 'tool', id: 'tools.echo', tool };
    expect(contribution.tool).toBe(tool);
  });

  it('declares a capability contribution', () => {
    const contribution: CapabilityContribution = {
      kind: 'capability',
      capability: {
        manifest: {
          id: 'projects.create_project',
          name: 'Create Project',
          description: 'Creates a project',
          skillId: 'skills.create_project',
          sideEffectClass: 'state_change',
          mutatesState: true,
        },
      },
    };
    expect(contribution.kind).toBe('capability');
    expect(contribution.capability.manifest.id).toBe('projects.create_project');
  });
});

describe('applyAgentContributions', () => {
  it('registers skill and tool contributions onto an agent', async () => {
    const agent = new TestAgent();
    agent.markReady();
    const skill: SkillContribution = {
      kind: 'skill',
      id: 'skills.say_hi',
      skill: {
        manifest: {
          id: 'skills.say_hi',
          name: 'say_hi',
          description: 'Says hi',
          capabilityIds: [],
          toolIds: [],
          autonomyTier: 'autonomous',
          requiresApproval: false,
        },
        execute: async () => ({ ok: true as const, output: 'hi' }),
      },
    };
    const tool: ToolContribution = {
      kind: 'tool',
      id: 'tools.echo',
      tool: {
        manifest: {
          id: 'tools.echo',
          name: 'echo',
          description: 'Echoes',
          sideEffectClass: 'read_only',
          idempotent: true,
          timeoutMs: 1000,
          inputSchema: {},
        },
        execute: async () => ({ ok: true as const, output: {}, completedAt: 't' }),
      },
    };
    const count = await applyAgentContributions(agent, [skill, tool]);
    expect(count).toBe(2);
    expect(agent.skills.resolve('skills.say_hi')).toBeDefined();
    expect(agent.tools.resolve('tools.echo')).toBeDefined();
  });

  it('resolves lazy skill factories during application', async () => {
    const agent = new TestAgent();
    agent.markReady();
    const skill: SkillContribution = {
      kind: 'skill',
      id: 'skills.lazy',
      skill: () => ({
        manifest: {
          id: 'skills.lazy',
          name: 'lazy',
          description: 'Lazy skill',
          capabilityIds: [],
          toolIds: [],
          autonomyTier: 'supervised',
          requiresApproval: false,
        },
        execute: async () => ({ ok: true as const, output: 'lazy' }),
      }),
    };
    const count = await applyAgentContributions(agent, [skill]);
    expect(count).toBe(1);
    expect(agent.skills.size).toBe(1);
  });

  it('applies nothing for an empty contribution list', async () => {
    const agent = new TestAgent();
    expect(await applyAgentContributions(agent, [])).toBe(0);
  });

  it('registers contributions so the agent can execute the skill', async () => {
    const agent = new TestAgent();
    agent.markReady();
    const skill: SkillContribution = {
      kind: 'skill',
      id: 'skills.greet',
      skill: {
        manifest: {
          id: 'skills.greet',
          name: 'greet',
          description: 'Greets',
          capabilityIds: [],
          toolIds: [],
          autonomyTier: 'autonomous',
          requiresApproval: false,
        },
        execute: async (input: { args: Record<string, unknown> }) => ({
          ok: true as const,
          output: `hello ${String(input.args.name)}`,
        }),
      },
    };
    await applyAgentContributions(agent, [skill]);
    const result = await agent.run('x', fakeExecutionContext());
    expect(result.ok).toBe(true);
  });
});
