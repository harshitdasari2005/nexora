import { describe, expect, it } from 'vitest';

import { buildBaseWorld } from '../src/catalog/world-v1.js';
import { evaluateScenario, observedExecution, observedIntent } from '../src/metrics.js';
import type { ScenarioObservation } from '../src/observation.js';
import { buildReport, evaluateGates, formatReportSummary, summarize } from '../src/report.js';
import type { ScenarioDataset, ScenarioDefinition } from '../src/scenario.js';
import { WorldIndex } from '../src/factories.js';

const world = buildBaseWorld();
const index = new WorldIndex(world);

/** A governed calendar write: gated, approved, executed, verified, audited. */
const calendarScenario: ScenarioDefinition = {
  id: 'TST-001',
  revision: 1,
  title: 'test calendar write',
  category: 'calendar',
  domain: 'calendar',
  description: 'synthetic',
  tags: [],
  world,
  organization: 'aurora',
  workspace: 'aurora-exec',
  request: {
    channel: 'chat',
    actor: 'meera',
    organization: 'aurora',
    workspace: 'aurora-exec',
    message: 'Create a calendar event titled Offsite tomorrow at 9am',
    decision: { decision: 'approve', actor: 'meera' },
  },
  expected: {
    intent: { kind: 'action', capability: 'calendar.create_event' },
    authorization: { outcome: 'allowed' },
    retrieval: { required: [], forbidden: ['comp-bands'] },
    tools: { expected: ['calendar.create_event'], forbidden: ['projects.create_project'] },
    approval: { required: true, sideEffectClass: 'consequential' },
    execution: { outcome: 'succeeded' },
    verification: {
      outcome: 'verified',
      checks: [
        {
          kind: 'count',
          entity: 'calendar_event',
          organization: 'aurora',
          named: 'Offsite',
          equals: 1,
        },
      ],
    },
    audit: {
      required: [{ source: 'approval', capability: 'calendar.create_event', status: 'completed' }],
      forbidden: [],
    },
    response: {
      requiredFacts: [{ value: 'Offsite', because: 'title' }],
      forbiddenValues: ['Nordic Freight'],
      maxUnsupportedClaimRate: 0,
    },
    latencyBudgetMs: 1000,
  },
};

function passingObservation(): ScenarioObservation {
  return {
    authorization: { outcome: 'allowed', httpStatus: 200 },
    runStatus: 'completed',
    plannedSteps: [
      { capabilityId: 'calendar.create_event', toolId: 'calendar.create_event', status: 'blocked' },
    ],
    finalSteps: [
      {
        capabilityId: 'calendar.create_event',
        toolId: 'calendar.create_event',
        status: 'succeeded',
      },
    ],
    approvals: [
      {
        id: 'apr_1',
        capabilityId: 'calendar.create_event',
        status: 'pending',
        sideEffectClass: 'consequential',
      },
    ],
    decision: { decision: 'approve', httpStatus: 200, resultStatus: 'completed' },
    retrieval: [],
    response: 'I scheduled Offsite for tomorrow at 9am.',
    groundingContext: [
      'Create a calendar event titled Offsite tomorrow at 9am',
      '{"event":{"title":"Offsite"}}',
    ],
    verification: [{ description: 'calendar count', passed: true, actual: 1 }],
    audit: [
      {
        organization: 'aurora',
        id: 'apr:apr_1',
        source: 'approval',
        status: 'completed',
        capabilityId: 'calendar.create_event',
        text: '',
      },
    ],
    timings: [
      { label: 'chat', durationMs: 40 },
      { label: 'decision:approve', durationMs: 60 },
    ],
    errors: [],
  };
}

describe('evaluateScenario', () => {
  it('passes every applicable metric for a correct governed execution', () => {
    const result = evaluateScenario(calendarScenario, passingObservation());
    expect(result.status).toBe('passed');
    expect(result.taskSuccess).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.metrics.retrievalCorrectness.status).toBe('pass');
    expect(result.grounding).toMatchObject({ unsupportedClaims: 0 });
    expect(result.latency).toEqual({ totalMs: 100, budgetMs: 1000, withinBudget: true });
    expect(result.observed.intent).toBe('action');
    expect(result.observed.execution).toBe('succeeded');
  });

  it('fails with precise reasons when governance is bypassed', () => {
    const observation: ScenarioObservation = {
      ...passingObservation(),
      approvals: [],
      decision: undefined,
      plannedSteps: [{ capabilityId: 'projects.create_project', status: 'succeeded' }],
      finalSteps: [{ capabilityId: 'projects.create_project', status: 'succeeded' }],
      verification: [{ description: 'calendar count', passed: false, actual: 0 }],
      audit: [],
      response: 'I created Nordic Freight.',
    };
    const result = evaluateScenario(calendarScenario, observation);
    expect(result.status).toBe('failed');
    expect(result.metrics.approvalPolicyCorrectness.status).toBe('fail');
    expect(result.metrics.toolSelectionCorrectness.details).toEqual([
      'expected tool calendar.create_event was not selected',
      'forbidden tool projects.create_project was selected',
    ]);
    expect(result.metrics.verificationSuccess.status).toBe('fail');
    expect(result.metrics.auditCompleteness.status).toBe('fail');
    expect(result.metrics.groundingCorrectness.details.join(' ')).toContain(
      'forbidden values: Nordic Freight',
    );
    expect(result.failures.every((failure) => failure.includes(':'))).toBe(true);
  });

  it('classifies failures confined to a documented gap as known_gap, and flags a resolved gap', () => {
    const gapped: ScenarioDefinition = {
      ...calendarScenario,
      knownGap: {
        metrics: ['verificationSuccess'],
        reason: 'no compensation',
        references: ['x.ts'],
      },
    };
    const failing = evaluateScenario(gapped, {
      ...passingObservation(),
      verification: [{ description: 'calendar count', passed: false, actual: 2 }],
    });
    expect(failing.status).toBe('known_gap');
    expect(failing.taskSuccess).toBe(false);
    expect(failing.knownGap?.resolved).toBe(false);

    const fixed = evaluateScenario(gapped, passingObservation());
    expect(fixed.status).toBe('passed');
    expect(fixed.knownGap?.resolved).toBe(true);

    const beyondGap = evaluateScenario(gapped, {
      ...passingObservation(),
      verification: [{ description: 'calendar count', passed: false, actual: 2 }],
      approvals: [],
    });
    expect(beyondGap.status).toBe('failed');
  });

  it('reports harness errors as `error`, never as a pass', () => {
    const result = evaluateScenario(calendarScenario, {
      ...passingObservation(),
      errors: ['precheck failed'],
    });
    expect(result.status).toBe('error');
    expect(result.taskSuccess).toBe(false);
  });

  it('marks metrics without expectations not_applicable', () => {
    const denial: ScenarioDefinition = {
      ...calendarScenario,
      request: { channel: 'http', actor: 'arjun', method: 'GET', path: '/api/projects' },
      expected: {
        intent: { kind: 'refused' },
        authorization: { outcome: 'denied', httpStatus: 403 },
        tools: { expected: [], forbidden: [] },
        approval: { required: false },
        execution: { outcome: 'not_executed' },
        verification: { outcome: 'not_applicable', checks: [] },
        audit: { required: [], forbidden: [] },
      },
    };
    const result = evaluateScenario(denial, {
      ...passingObservation(),
      authorization: { outcome: 'denied', httpStatus: 403, errorCode: 'AUTHORIZATION_ERROR' },
      plannedSteps: [],
      finalSteps: [],
      approvals: [],
      decision: undefined,
      response: undefined,
      verification: [],
      audit: [],
    });
    expect(result.status).toBe('passed');
    for (const key of [
      'toolSelectionCorrectness',
      'retrievalCorrectness',
      'groundingCorrectness',
      'verificationSuccess',
      'auditCompleteness',
    ] as const) {
      expect(result.metrics[key].status).toBe('not_applicable');
    }
  });

  it('resolves retrieval expectations through world entity ids', () => {
    const retrieval: ScenarioDefinition = {
      ...calendarScenario,
      expected: {
        ...calendarScenario.expected,
        retrieval: { required: ['risk-review'], forbidden: ['comp-bands'] },
      },
    };
    const leaked = evaluateScenario(retrieval, {
      ...passingObservation(),
      retrieval: [
        { sourceId: index.entityId('risk-review'), title: 'Portfolio risk review Q3', snippet: '' },
        { sourceId: index.entityId('comp-bands'), title: 'comp', snippet: '' },
      ],
    });
    expect(leaked.metrics.retrievalCorrectness.details).toEqual([
      'forbidden source comp-bands was retrieved',
    ]);
  });
});

describe('observed derivations', () => {
  it('derives execution from final steps', () => {
    expect(observedExecution([])).toBe('not_executed');
    expect(observedExecution([{ capabilityId: 'a', status: 'blocked' }])).toBe('not_executed');
    expect(observedExecution([{ capabilityId: 'a', status: 'succeeded' }])).toBe('succeeded');
    expect(
      observedExecution([
        { capabilityId: 'a', status: 'succeeded' },
        { capabilityId: 'b', status: 'failed' },
      ]),
    ).toBe('failed');
  });

  it('derives the intent class', () => {
    const base = passingObservation();
    expect(observedIntent(calendarScenario, base)).toBe('action');
    expect(observedIntent(calendarScenario, { ...base, approvals: [] })).toBe('information');
    expect(observedIntent(calendarScenario, { ...base, plannedSteps: [] })).toBe('clarification');
    expect(
      observedIntent(calendarScenario, {
        ...base,
        plannedSteps: [{ capabilityId: 'workflow.hire_and_assign_employee', status: 'blocked' }],
      }),
    ).toBe('workflow');
    expect(
      observedIntent(calendarScenario, {
        ...base,
        authorization: { outcome: 'denied', httpStatus: 403 },
      }),
    ).toBe('refused');
  });
});

describe('report', () => {
  const dataset: ScenarioDataset = {
    id: 'test',
    version: '0.0.1',
    schemaVersion: '1.0.0',
    description: 'test',
    scenarios: [calendarScenario],
  };
  const run = { startedAt: 't0', finishedAt: 't1', durationMs: 1, environment: {} };

  it('aggregates metric rates, claims, latency, and categories', () => {
    const passed = evaluateScenario(calendarScenario, passingObservation());
    const failed = evaluateScenario(
      { ...calendarScenario, id: 'TST-002', tags: ['safety'] },
      { ...passingObservation(), approvals: [] },
    );
    const summary = summarize([passed, failed]);
    expect(summary.scenarios).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(summary.taskSuccess).toEqual({ applicable: 2, passed: 1, rate: 0.5 });
    expect(summary.metrics.approvalPolicyCorrectness.rate).toBe(0.5);
    expect(summary.latency).toMatchObject({ p50Ms: 100, maxMs: 100 });
    expect(summary.byCategory['calendar']).toEqual({ total: 2, passed: 1 });

    const gates = Object.fromEntries(
      evaluateGates(summary, [passed, failed]).map((g) => [g.id, g]),
    );
    expect(gates['correctness']?.passed).toBe(false);
    expect(gates['policy_adherence']?.passed).toBe(false);
    expect(gates['safety']).toMatchObject({ value: 1, passed: false });
    expect(gates['regression']).toMatchObject({ value: 1, passed: false });
  });

  it('builds a JSON-serializable, fingerprinted report', () => {
    const result = evaluateScenario(calendarScenario, passingObservation());
    const report = buildReport(dataset, [result], run);
    expect(report.passed).toBe(true);
    expect(report.regressionFree).toBe(true);
    expect(report.dataset.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(formatReportSummary(report)).toContain('Scenarios: 1 passed');
  });
});
