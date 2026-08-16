/**
 * @nexora/module-detection — problem lifecycle tests (S27).
 *
 * S27 §20 PROBLEMS 6–9: creation, lifecycle transitions, correlation
 * identity (dedupe), tenant isolation of the store port.
 */

import { describe, expect, it } from 'vitest';

import {
  BusinessProblem,
  buildCorrelationId,
  DetectionStateTransitionError,
} from '../src/domain/problem.js';

describe('BusinessProblem lifecycle', () => {
  it('creates a problem in DETECTED with a stable correlation identity', () => {
    const problem = BusinessProblem.create({
      id: 'prb_1',
      correlationId: 'workflow_failure:org_tenant_a:org:wf_auth',
      signalId: 'workflow_failure',
      tenantId: 'org_tenant_a',
      title: 'wf_auth requires attention',
      description: 'wf_auth failed 6 times.',
      severity: 'high',
      detectedAt: '2026-08-16T12:00:00.000Z',
      affectedEntities: [],
    });
    expect(problem.status).toBe('DETECTED');
    expect(problem.isOpen()).toBe(true);
    expect(problem.snapshot()).toMatchObject({
      id: 'prb_1',
      status: 'DETECTED',
      updatedAt: '2026-08-16T12:00:00.000Z',
    });
  });

  it('follows the explicit transition table and rejects illegal jumps', () => {
    const problem = BusinessProblem.create({
      id: 'prb_1',
      correlationId: 'c',
      signalId: 'workflow_failure',
      tenantId: 'org_tenant_a',
      title: 't',
      description: 'd',
      severity: 'high',
      detectedAt: '2026-08-16T12:00:00.000Z',
      affectedEntities: [],
    });

    // Illegal jump DETECTED → SOLUTION_FOUND throws.
    expect(() => problem.transitionTo('SOLUTION_FOUND', '2026-08-16T12:01:00.000Z')).toThrow(
      DetectionStateTransitionError,
    );
    expect(problem.status).toBe('DETECTED');

    problem.transitionTo('INVESTIGATING', '2026-08-16T12:01:00.000Z');
    expect(problem.status).toBe('INVESTIGATING');
    problem.transitionTo('UNDERSTOOD', '2026-08-16T12:02:00.000Z');
    problem.transitionTo('SOLUTION_FOUND', '2026-08-16T12:03:00.000Z');
    expect(problem.isOpen()).toBe(true);
    expect(problem.updatedAt).toBe('2026-08-16T12:03:00.000Z');

    // A resolved problem may only re-open to DETECTED (new episode).
    problem.transitionTo('ACTION_PROPOSED', '2026-08-16T12:04:00.000Z');
    problem.transitionTo('RESOLVED', '2026-08-16T12:05:00.000Z');
    expect(problem.isOpen()).toBe(false);
    problem.transitionTo('DETECTED', '2026-08-16T12:06:00.000Z');
    expect(problem.status).toBe('DETECTED');
  });

  it('builds a deterministic correlation identity per signal + scope + entity', () => {
    const a = buildCorrelationId({
      signalId: 'workflow_failure',
      tenantId: 'org_t',
      suffix: 'wf_auth',
    });
    const b = buildCorrelationId({
      signalId: 'workflow_failure',
      tenantId: 'org_t',
      suffix: 'wf_auth',
    });
    expect(a).toBe(b);

    // Different tenant / workspace / entity → different identity (isolation).
    expect(
      buildCorrelationId({ signalId: 'workflow_failure', tenantId: 'org_t2', suffix: 'wf_auth' }),
    ).not.toBe(a);
    expect(
      buildCorrelationId({
        signalId: 'workflow_failure',
        tenantId: 'org_t',
        workspaceId: 'ws_dev',
        suffix: 'wf_auth',
      }),
    ).not.toBe(a);
    expect(
      buildCorrelationId({ signalId: 'workflow_failure', tenantId: 'org_t', suffix: 'wf_other' }),
    ).not.toBe(a);
  });
});
