/**
 * @nexora/module-detection — investigation engine tests (S27).
 *
 * S27 §20 INVESTIGATION 10–13: evidence collection, evidence scoping
 * (bounded), root-cause candidates, FACT vs INFERENCE distinction.
 */

import { describe, expect, it } from 'vitest';

import { InvestigationEngine } from '../src/application/investigation-engine.js';
import { BusinessProblem } from '../src/domain/problem.js';
import { emptySnapshot, entity, workflowMetric } from './helpers.js';

function problem(overrides: { entity?: ReturnType<typeof entity> } = {}) {
  return BusinessProblem.create({
    id: 'prb_1',
    correlationId: 'workflow_failure:org_tenant_a:org:wf_auth',
    signalId: 'workflow_failure',
    tenantId: 'org_tenant_a',
    title: 'wf_auth requires attention',
    description: 'wf_auth failed 6 times.',
    severity: 'high',
    detectedAt: '2026-08-16T12:00:00.000Z',
    affectedEntities: overrides.entity === undefined ? [] : [overrides.entity],
  });
}

describe('InvestigationEngine', () => {
  const engine = new InvestigationEngine();

  it('gathers grounded evidence from the trusted snapshot sources', () => {
    const snapshot = emptySnapshot({
      workflowHealth: [workflowMetric({ definitionKey: 'wf_auth', total: 10, failed: 6 })],
      activity: [
        {
          id: 'act_1',
          type: 'workflow.failed',
          title: 'wf_auth failed',
          occurredAt: '2026-08-16T11:46:00.000Z',
        },
      ],
      notifications: [{ id: 'ntf_1', title: 'wf_auth failing', body: '' }],
      agentExecutions: [
        {
          id: 'run_1',
          agentId: 'executive',
          status: 'completed',
          proposalAction: 'review wf_auth',
          createdAt: '2026-08-16T10:00:00.000Z',
        },
      ],
    });
    const outcome = engine.investigate(
      problem({ entity: entity({ id: 'wf_auth', title: 'wf_auth' }) }),
      snapshot,
    );

    const sources = new Set(outcome.evidence.map((item) => item.source));
    expect(sources.has('measurements')).toBe(true);
    expect(sources.has('activity')).toBe(true);
    expect(sources.has('notifications')).toBe(true);
    expect(sources.has('agent_executions')).toBe(true);
    // Facts are grounded text, never empty.
    for (const item of outcome.evidence) {
      expect(item.fact.length).toBeGreaterThan(0);
    }
  });

  it('bounds evidence (never unbounded source dumps)', () => {
    const manyActivity = Array.from({ length: 10 }, (_, i) => ({
      id: `act_${i}`,
      type: 'workflow.failed',
      title: `wf_auth failed ${i}`,
      occurredAt: `2026-08-16T11:${i}:00.000Z`,
    }));
    const snapshot = emptySnapshot({ activity: manyActivity });
    const outcome = engine.investigate(problem(), snapshot);
    expect(outcome.evidence.filter((item) => item.source === 'activity')).toHaveLength(3);
  });

  it('separates FACT from INFERENCE with controlled confidence', () => {
    const snapshot = emptySnapshot({
      workflowHealth: [
        workflowMetric({
          definitionKey: 'wf_auth',
          total: 10,
          failed: 6,
          unrecoverableErrorRate: 60,
        }),
      ],
      activity: [
        {
          id: 'act_1',
          type: 'workflow.failed',
          title: 'wf_auth failed',
          occurredAt: '2026-08-16T11:46:00.000Z',
        },
      ],
    });
    const outcome = engine.investigate(
      problem({ entity: entity({ id: 'wf_auth', title: 'wf_auth' }) }),
      snapshot,
    );

    const facts = outcome.rootCauses.filter((cause) => cause.kind === 'FACT');
    const inferences = outcome.rootCauses.filter((cause) => cause.kind === 'INFERENCE');
    expect(facts.length).toBeGreaterThan(0);
    expect(inferences.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(fact.confidence);
      expect(fact.explanation.length).toBeGreaterThan(0);
    }
    // The high-confidence FACT names the failure; the medium one the rate.
    expect(facts[0]?.explanation).toContain('failed');
    expect(facts[1]?.explanation).toContain('success rate');
    for (const inference of inferences) {
      expect(inference.confidence).toBe('LOW');
      expect(inference.explanation.toLowerCase()).toContain('inferred');
      expect(inference.nextStep.length).toBeGreaterThan(0);
    }
  });

  it('never fabricates evidence when no entity matches', () => {
    const snapshot = emptySnapshot({
      workflowHealth: [workflowMetric({ definitionKey: 'wf_other', total: 4, failed: 1 })],
    });
    const outcome = engine.investigate(
      problem({ entity: entity({ id: 'wf_auth', title: 'wf_auth' }) }),
      snapshot,
    );
    expect(outcome.evidence.filter((item) => item.source === 'measurements')).toHaveLength(0);
  });
});
