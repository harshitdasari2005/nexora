/**
 * @nexora/ai-runtime — planner tests.
 */

import { describe, expect, it } from 'vitest';
import type { AIContext } from '../src/context/index.js';
import type { DiscoveryOutcome } from '../src/discovery/capability-discovery.js';

import { SequentialPlanner, requiresApprovalFor } from '../src/planner/sequential-planner.js';
import type { PlannerContext } from '../src/planner/planner-context.js';

function outcome(capabilityIds: readonly string[]): DiscoveryOutcome {
  const capabilities = capabilityIds.map((id, index) => ({
    id,
    name: id,
    description: `Capability ${index}`,
    skillId: `skill.${id}`,
    sideEffectClass: index === 0 ? ('state_change' as const) : ('read_only' as const),
  }));
  return {
    capabilities,
    skills: capabilityIds.map((id) => ({
      id: `skill.${id}`,
      description: `Skill ${id}`,
      toolIds: [`tool.${id}`],
      autonomyTier: 'supervised' as const,
      requiresApproval: false,
    })),
    tools: capabilityIds.map((id) => ({
      id: `tool.${id}`,
      sideEffectClass: id.includes('consequential')
        ? ('consequential' as const)
        : ('state_change' as const),
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: {},
    })),
    agents: [],
    scores: capabilityIds.map((id, index) => ({
      capabilityId: id,
      score: 1 - index * 0.1,
      matchedTerms: [],
    })),
  };
}

function context(intent: string, discovery: DiscoveryOutcome): PlannerContext {
  const aiContext = {
    execution: {
      runId: 'run_1',
      tenantId: 't',
      userId: 'u',
      startedAt: '2026-08-08T00:00:00.000Z',
    },
    user: { userId: 'u' },
    organization: { tenantId: 't' },
    permissions: { userId: 'u', autonomyTier: 'supervised' as const },
  } as AIContext;
  return { intent, discovery, aiContext, autonomyTier: 'supervised' };
}

describe('requiresApprovalFor', () => {
  it('always gates consequential actions', () => {
    expect(requiresApprovalFor('consequential', 'autonomous')).toBe(true);
    expect(requiresApprovalFor('consequential', 'supervised')).toBe(true);
  });

  it('never gates read-only actions', () => {
    expect(requiresApprovalFor('read_only', 'human_only')).toBe(false);
  });

  it('gates state changes unless autonomous', () => {
    expect(requiresApprovalFor('state_change', 'supervised')).toBe(true);
    expect(requiresApprovalFor('state_change', 'human_only')).toBe(true);
    expect(requiresApprovalFor('state_change', 'autonomous')).toBe(false);
  });
});

describe('SequentialPlanner', () => {
  it('builds a sequential plan over matched capabilities', () => {
    const planner = new SequentialPlanner();
    const result = planner.plan(context('create project', outcome(['a.create', 'b.read'])));
    expect(result.success).toBe(true);
    const plan = result.plan;
    expect(plan?.graph.steps).toHaveLength(2);
    expect(plan?.graph.steps[0]?.dependsOn).toEqual([]);
    expect(plan?.graph.steps[1]?.dependsOn).toEqual(['step_1']);
    expect(plan?.authorityEnvelope).toContain('user:u@tenant:t');
  });

  it('attaches approval gates for consequential steps', () => {
    const planner = new SequentialPlanner();
    const discovery = outcome(['x.consequential_create']);
    discovery.tools = discovery.tools.map((tool) => ({
      ...tool,
      sideEffectClass: 'consequential' as const,
    }));
    const result = planner.plan(context('do it', discovery));
    expect(result.plan?.gates.length).toBe(1);
    expect(result.plan?.graph.steps[0]?.gate?.requiresApproval).toBe(true);
  });

  it('respects the allowed capability list', () => {
    const planner = new SequentialPlanner({ allowedCapabilityIds: ['a.create'] });
    const result = planner.plan(context('create project', outcome(['a.create', 'b.read'])));
    expect(result.plan?.graph.steps).toHaveLength(1);
    expect(result.plan?.graph.steps[0]?.capabilityId).toBe('a.create');
  });

  it('respects maxSteps', () => {
    const planner = new SequentialPlanner({ maxSteps: 1 });
    const result = planner.plan(context('lots', outcome(['a', 'b', 'c'])));
    expect(result.plan?.graph.steps).toHaveLength(1);
  });

  it('fails gracefully when no capability resolves', () => {
    const planner = new SequentialPlanner();
    const empty = outcome([]);
    const result = planner.plan(context('nothing', empty));
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/No executable capability/);
  });

  it('skips capabilities without an executable skill/tool', () => {
    const planner = new SequentialPlanner();
    const discovery = outcome(['a.create']);
    discovery.skills = [];
    const result = planner.plan(context('create', discovery));
    expect(result.success).toBe(false);
  });

  it('sets confidence deterministically', () => {
    const planner = new SequentialPlanner();
    const result = planner.plan(context('create project', outcome(['a.create'])));
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence ?? 0).toBeGreaterThan(0);
  });
});
