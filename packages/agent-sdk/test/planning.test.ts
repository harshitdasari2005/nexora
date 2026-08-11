/**
 * Planning and plan-execution tests.
 */

import { describe, expect, it } from 'vitest';

import { executePlan } from '../src/execution/index.js';
import { SequentialPlanningStrategy } from '../src/planning/index.js';
import { SkillRegistry } from '../src/skills/index.js';
import { MockSkill } from '../src/testing/index.js';

const skillManifest = (id: string, approval = false) => ({
  id,
  name: id,
  description: 'd',
  capabilityIds: [],
  toolIds: [],
  autonomyTier: 'supervised' as const,
  requiresApproval: approval,
});

describe('SequentialPlanningStrategy', () => {
  it('produces a sequential plan from ordered steps', () => {
    const strategy = new SequentialPlanningStrategy([
      { skillId: 's1', input: { a: 1 } },
      { skillId: 's2', input: { b: 2 } },
    ]);
    const result = strategy.plan('do things', { tenantId: 't1', executionId: 'e1' });
    expect(result.success).toBe(true);
    expect(result.plan.graph.steps).toHaveLength(2);
    expect(result.plan.graph.entryPointIds).toEqual(['step_1']);
    expect(result.plan.graph.steps[1]?.dependsOn).toEqual(['step_1']);
  });

  it('exposes its strategy name', () => {
    const strategy = new SequentialPlanningStrategy([]);
    expect(strategy.name).toBe('sequential');
  });

  it('produces an empty plan for no steps', () => {
    const strategy = new SequentialPlanningStrategy([]);
    const result = strategy.plan('none', { tenantId: 't1', executionId: 'e1' });
    expect(result.plan.graph.steps).toHaveLength(0);
  });
});

describe('executePlan', () => {
  it('executes sequential steps in order', async () => {
    const strategy = new SequentialPlanningStrategy([
      { skillId: 's1', input: { a: 1 } },
      { skillId: 's2', input: { b: 2 } },
    ]);
    const plan = strategy.plan('do', { tenantId: 't1', executionId: 'e1' });
    const skills = new SkillRegistry();
    const order: string[] = [];
    skills.register({
      manifest: skillManifest('s1'),
      execute: async () => {
        order.push('s1');
        return { ok: true, output: 'one' };
      },
    });
    skills.register({
      manifest: skillManifest('s2'),
      execute: async () => {
        order.push('s2');
        return { ok: true, output: 'two' };
      },
    });
    const result = await executePlan(plan.plan, skills, { tenantId: 't1', executionId: 'e1' });
    expect(result.ok).toBe(true);
    expect(order).toEqual(['s1', 's2']);
    expect(result.steps).toHaveLength(2);
  });

  it('fails the plan when a skill is missing', async () => {
    const strategy = new SequentialPlanningStrategy([{ skillId: 'nope', input: {} }]);
    const plan = strategy.plan('do', { tenantId: 't1', executionId: 'e1' });
    const result = await executePlan(plan.plan, new SkillRegistry(), {
      tenantId: 't1',
      executionId: 'e1',
    });
    expect(result.ok).toBe(false);
    expect(result.steps[0]?.error).toMatch(/Skill not found/);
  });

  it('fails the plan when a skill fails and stops further steps', async () => {
    const strategy = new SequentialPlanningStrategy([
      { skillId: 's1', input: {} },
      { skillId: 's2', input: {} },
    ]);
    const plan = strategy.plan('do', { tenantId: 't1', executionId: 'e1' });
    const skills = new SkillRegistry();
    skills.register({
      manifest: skillManifest('s1'),
      execute: async () => ({ ok: false as const, error: 'boom' }),
    });
    const result = await executePlan(plan.plan, skills, { tenantId: 't1', executionId: 'e1' });
    expect(result.ok).toBe(false);
    expect(result.steps[0]?.error).toBe('boom');
    expect(result.steps).toHaveLength(1);
  });

  it('executes steps through the MockSkill', async () => {
    const strategy = new SequentialPlanningStrategy([{ skillId: 's1', input: { x: 1 } }]);
    const plan = strategy.plan('do', { tenantId: 't1', executionId: 'e1' });
    const skills = new SkillRegistry();
    const mock = new MockSkill(skillManifest('s1'));
    skills.register(mock);
    const result = await executePlan(plan.plan, skills, { tenantId: 't1', executionId: 'e1' });
    expect(result.ok).toBe(true);
    expect(mock.executions).toBe(1);
  });
});
