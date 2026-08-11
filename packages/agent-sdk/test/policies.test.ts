/**
 * Policy evaluation tests (deny-wins).
 */

import { describe, expect, it } from 'vitest';

import { evaluatePolicies, type PolicyEvaluationContext } from '../src/policies/index.js';

const context = (
  requirements: { policyId: string; description: string }[],
): PolicyEvaluationContext => ({
  tenantId: 't1',
  action: 'skills.test',
  actor: 'agt_1',
  requirements,
});

describe('evaluatePolicies', () => {
  it('allows when every requirement is satisfied', () => {
    const evaluation = evaluatePolicies(
      context([{ policyId: 'p1', description: 'must be in office' }]),
      () => true,
    );
    expect(evaluation.allowed).toBe(true);
    expect(evaluation.deniedBy).toBeUndefined();
    expect(evaluation.decisions).toHaveLength(1);
  });

  it('denies when any requirement is unsatisfied (deny-wins)', () => {
    const evaluation = evaluatePolicies(
      context([
        { policyId: 'p1', description: 'a' },
        { policyId: 'p2', description: 'b' },
      ]),
      (requirement) => requirement.policyId !== 'p2',
    );
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.deniedBy).toBe('p2');
  });

  it('reports the denial reason', () => {
    const evaluation = evaluatePolicies(
      context([{ policyId: 'p1', description: 'must be verified' }]),
      () => false,
    );
    expect(evaluation.decisions[0]?.reason).toMatch(/must be verified/);
  });

  it('allows empty requirement sets', () => {
    const evaluation = evaluatePolicies(context([]), () => true);
    expect(evaluation.allowed).toBe(true);
    expect(evaluation.decisions).toHaveLength(0);
  });

  it('evaluates each requirement exactly once', () => {
    let calls = 0;
    evaluatePolicies(
      context([
        { policyId: 'p1', description: 'a' },
        { policyId: 'p2', description: 'b' },
      ]),
      () => {
        calls += 1;
        return true;
      },
    );
    expect(calls).toBe(2);
  });
});
