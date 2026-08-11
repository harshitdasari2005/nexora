/**
 * Fluent builder tests.
 */

import { describe, expect, it } from 'vitest';

import {
  CapabilityBuilder,
  IdentityBuilder,
  ManifestBuilder,
  SkillBuilder,
  ToolBuilder,
} from '../src/builders/index.js';

describe('IdentityBuilder', () => {
  it('builds an identity from parts', () => {
    const identity = new IdentityBuilder()
      .withId('agt_hr')
      .withName('hr')
      .withDisplayName('HR Agent')
      .build();
    expect(identity).toEqual({ id: 'agt_hr', name: 'hr', displayName: 'HR Agent' });
  });

  it('builds an empty identity when nothing is set', () => {
    const identity = new IdentityBuilder().build();
    expect(identity.id).toBe('');
  });
});

describe('SkillBuilder', () => {
  it('builds a skill with defaults', () => {
    const skill = new SkillBuilder()
      .withId('hr.hire_employee')
      .withDescription('Hire an employee')
      .build();
    expect(skill.id).toBe('hr.hire_employee');
    expect(skill.autonomyTier).toBe('supervised');
    expect(skill.requiresApproval).toBe(false);
    expect(skill.toolIds).toEqual([]);
  });

  it('adds tool ids and marks approval', () => {
    const skill = new SkillBuilder()
      .withId('hr.approve_leave')
      .withDescription('Approve leave')
      .withToolIds('tool_read', 'tool_write')
      .withAutonomyTier('human_only')
      .requiringApproval()
      .build();
    expect(skill.toolIds).toEqual(['tool_read', 'tool_write']);
    expect(skill.autonomyTier).toBe('human_only');
    expect(skill.requiresApproval).toBe(true);
  });
});

describe('ToolBuilder', () => {
  it('builds a tool with defaults', () => {
    const tool = new ToolBuilder().withId('tool_read').build();
    expect(tool.id).toBe('tool_read');
    expect(tool.sideEffectClass).toBe('read_only');
    expect(tool.idempotent).toBe(false);
    expect(tool.timeoutMs).toBe(10_000);
    expect(tool.inputSchema).toEqual({});
  });

  it('configures side effects, idempotency, timeout, and schema', () => {
    const tool = new ToolBuilder()
      .withId('tool_write')
      .withSideEffectClass('state_change')
      .idempotent()
      .withTimeout(5_000)
      .withInputSchema({ type: 'object' })
      .build();
    expect(tool.sideEffectClass).toBe('state_change');
    expect(tool.idempotent).toBe(true);
    expect(tool.timeoutMs).toBe(5_000);
    expect(tool.inputSchema).toEqual({ type: 'object' });
  });
});

describe('CapabilityBuilder', () => {
  it('builds a capability contract', () => {
    const capability = new CapabilityBuilder()
      .withId('projects.create_project')
      .withName('Create Project')
      .withDescription('Creates a project')
      .implementedBy('projects.create_project_skill')
      .withSideEffectClass('state_change')
      .mutatesState()
      .build();
    expect(capability.id).toBe('projects.create_project');
    expect(capability.skillId).toBe('projects.create_project_skill');
    expect(capability.mutatesState).toBe(true);
  });

  it('defaults to read-only and non-mutating', () => {
    const capability = new CapabilityBuilder().withId('c1').build();
    expect(capability.sideEffectClass).toBe('read_only');
    expect(capability.mutatesState).toBe(false);
  });
});

describe('ManifestBuilder', () => {
  it('builds a manifest from parts', () => {
    const skill = new SkillBuilder().withId('s1').withDescription('d').build();
    const tool = new ToolBuilder().withId('t1').build();
    const manifest = new ManifestBuilder()
      .withIdentity(new IdentityBuilder().withId('agt_1').withName('test').build())
      .withVersion('2.0.0')
      .withSkills(skill)
      .withTools(tool)
      .withKnowledgeScopes('public')
      .withPolicyIds('p1')
      .emitting('agent.ready')
      .subscribing('workflow.started')
      .build();
    expect(manifest.identity.id).toBe('agt_1');
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.tools).toHaveLength(1);
    expect(manifest.knowledgeScopes).toEqual(['public']);
    expect(manifest.policyIds).toEqual(['p1']);
    expect(manifest.emittedEventTypes).toEqual(['agent.ready']);
    expect(manifest.subscribedEventTypes).toEqual(['workflow.started']);
  });

  it('defaults version to 0.1.0 and empty collections', () => {
    const manifest = new ManifestBuilder().build();
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.skills).toEqual([]);
    expect(manifest.tools).toEqual([]);
  });
});
