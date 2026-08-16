/**
 * @nexora/module-detection — registry + signal tests (S27).
 *
 * S27 §20 SIGNALS 1–2: registry registration, validation, duplicate
 * detection, deterministic evaluation, severity.
 */

import { describe, expect, it } from 'vitest';

import {
  BusinessSignalRegistry,
  type BusinessSignalDefinition,
} from '../src/registry/business-signal-registry.js';
import { DuplicateSignalError, InvalidSignalError } from '../src/errors.js';
import { INITIAL_SIGNALS } from '../src/seed/initial-signals.js';
import { emptySnapshot, workflowMetric } from './helpers.js';

/** A minimal valid signal for registry tests. */
function signal(overrides: Partial<BusinessSignalDefinition> = {}): BusinessSignalDefinition {
  return {
    id: 'test_signal',
    signalType: 'workflow_failure',
    name: 'Test signal',
    description: 'A test signal.',
    remediationCapabilities: ['workflow.retry_run'],
    evaluate: () => [],
    ...overrides,
  };
}

describe('BusinessSignalRegistry', () => {
  it('registers and resolves a valid signal', () => {
    const registry = new BusinessSignalRegistry();
    const def = signal();
    registry.register(def);
    expect(registry.get('test_signal')).toBe(def);
    expect(registry.has('test_signal')).toBe(true);
    expect(registry.list()).toEqual([def]);
  });

  it('rejects a duplicate signal id at registration (fail fast)', () => {
    const registry = new BusinessSignalRegistry();
    registry.register(signal());
    expect(() => registry.register(signal())).toThrow(DuplicateSignalError);
    expect(() => registry.register(signal())).toThrow(/already registered/);
  });

  it('rejects invalid definitions deterministically', () => {
    const registry = new BusinessSignalRegistry();
    expect(() => registry.register(signal({ id: '  ' }))).toThrow(InvalidSignalError);
    expect(() => registry.register(signal({ name: '' }))).toThrow(InvalidSignalError);
    expect(() => registry.register(signal({ description: ' ' }))).toThrow(InvalidSignalError);
    expect(() => registry.register(signal({ evaluate: undefined as never }))).toThrow(
      InvalidSignalError,
    );
    expect(() => registry.register(signal({ remediationCapabilities: [''] }))).toThrow(
      InvalidSignalError,
    );
  });

  it('is extensible: a new signal registers without touching the engine', () => {
    const registry = new BusinessSignalRegistry();
    for (const def of INITIAL_SIGNALS) {
      registry.register(def);
    }
    expect(registry.list()).toHaveLength(INITIAL_SIGNALS.length);
    registry.register(signal({ id: 'integration_failure', signalType: 'workflow_failure' }));
    expect(registry.has('integration_failure')).toBe(true);
  });
});

describe('initial signals — deterministic evaluation', () => {
  const registry = new BusinessSignalRegistry();
  for (const def of INITIAL_SIGNALS) {
    registry.register(def);
  }

  it('workflow_failure fires only when failed or below the success-rate threshold', () => {
    const evaluator = registry.get('workflow_failure')?.evaluate;
    expect(evaluator).toBeDefined();
    const healthy = evaluator?.(
      emptySnapshot({
        workflowHealth: [
          workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 0, successRate: 100 }),
        ],
      }),
    );
    expect(healthy).toEqual([]);

    const failing = evaluator?.(
      emptySnapshot({
        workflowHealth: [
          workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6, successRate: 40 }),
        ],
      }),
    );
    expect(failing).toHaveLength(1);
    expect(failing?.[0]).toMatchObject({
      affectedEntity: { type: 'workflow', id: 'wf_auth', title: 'wf_auth' },
      severity: 'high',
      correlationSuffix: 'wf_auth',
    });
    expect(failing?.[0]?.facts[0]).toContain('6 failed');

    const degraded = evaluator?.(
      emptySnapshot({
        workflowHealth: [
          workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 0, successRate: 50 }),
        ],
      }),
    );
    expect(degraded).toHaveLength(1);
    expect(degraded?.[0]?.severity).toBe('medium');
  });

  it('workflow_degradation never double-reports a hard failure', () => {
    const evaluator = registry.get('workflow_degradation')?.evaluate;
    const withFailure = evaluator?.(
      emptySnapshot({
        workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 2 })],
      }),
    );
    expect(withFailure).toEqual([]);

    const degrading = evaluator?.(
      emptySnapshot({
        workflowHealth: [
          workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 0, successRate: 90 }),
        ],
      }),
    );
    expect(degrading).toHaveLength(1);
    expect(degrading?.[0]?.severity).toBe('medium');

    // Too few runs to be meaningful → no detection.
    const sparse = evaluator?.(
      emptySnapshot({
        workflowHealth: [
          workflowMetric({ definitionKey: 'wf_auth', total: 2, failed: 0, successRate: 50 }),
        ],
      }),
    );
    expect(sparse).toEqual([]);
  });

  it('project_attention fires when active projects exist with unread notifications', () => {
    const evaluator = registry.get('project_attention')?.evaluate;
    const none = evaluator?.(
      emptySnapshot({
        projects: [{ id: 'prj_a', name: 'Mobile Banking', status: 'active' }],
        notifications: [],
      }),
    );
    expect(none).toEqual([]);

    const attention = evaluator?.(
      emptySnapshot({
        projects: [{ id: 'prj_a', name: 'Mobile Banking', status: 'active' }],
        notifications: [{ id: 'ntf_1', title: 'Decision needed', body: 'Approve the release.' }],
      }),
    );
    expect(attention).toHaveLength(1);
    expect(attention?.[0]).toMatchObject({ severity: 'low', correlationSuffix: 'prj_a' });
  });

  it('onboarding_delay fires only after the deterministic window', () => {
    const evaluator = registry.get('onboarding_delay')?.evaluate;
    const recent = evaluator?.(
      emptySnapshot({
        generatedAt: '2026-08-16T12:00:00.000Z',
        onboarding: [
          { userId: 'usr_new', signedUpAt: '2026-08-14T12:00:00.000Z', firstWorkflowAt: null },
        ],
      }),
    );
    expect(recent).toEqual([]);

    const delayed = evaluator?.(
      emptySnapshot({
        generatedAt: '2026-08-16T12:00:00.000Z',
        onboarding: [
          { userId: 'usr_new', signedUpAt: '2026-08-01T12:00:00.000Z', firstWorkflowAt: null },
        ],
      }),
    );
    expect(delayed).toHaveLength(1);
    expect(delayed?.[0]?.title).toContain('usr_new');
    expect(delayed?.[0]?.description).toContain('15 day(s)');

    const onboarded = evaluator?.(
      emptySnapshot({
        generatedAt: '2026-08-16T12:00:00.000Z',
        onboarding: [
          {
            userId: 'usr_new',
            signedUpAt: '2026-08-01T12:00:00.000Z',
            firstWorkflowAt: '2026-08-05T12:00:00.000Z',
          },
        ],
      }),
    );
    expect(onboarded).toEqual([]);
  });

  it('audit_completeness fires when the traceable share is below the target', () => {
    const evaluator = registry.get('audit_completeness')?.evaluate;
    const complete = evaluator?.(
      emptySnapshot({ auditCompleteness: { traceableShare: 100, totalEvents: 12 } }),
    );
    expect(complete).toEqual([]);

    const gap = evaluator?.(
      emptySnapshot({ auditCompleteness: { traceableShare: 66, totalEvents: 12 } }),
    );
    expect(gap).toHaveLength(1);
    expect(gap?.[0]?.severity).toBe('medium');
    expect(gap?.[0]?.correlationSuffix).toBe('audit');
  });
});
