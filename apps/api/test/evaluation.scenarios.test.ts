/**
 * The Nexora enterprise scenario dataset as a regression suite.
 *
 * Runs every v1 scenario through the real API (in-memory harness) and pins
 * each one's outcome: `passed`, or `known_gap` when the scenario documents a
 * current platform defect. Either direction fails the suite — a regression
 * (a scenario starts failing) and a silent fix (a known gap stops
 * reproducing: remove its `knownGap` declaration so the dataset stays honest).
 */

import { describe, expect, it } from 'vitest';
import { buildDatasetV1, type EvaluationReport } from '@nexora/evaluation';

import { runDataset } from '../evaluation/runner.js';

describe('Nexora enterprise scenarios v1 (regression suite)', () => {
  const dataset = buildDatasetV1();
  let report: EvaluationReport;

  it('runs the whole dataset without harness errors', async () => {
    report = await runDataset(dataset);
    expect(report.scenarios).toHaveLength(dataset.scenarios.length);
    for (const result of report.scenarios) {
      expect(result.errors, result.scenarioId).toEqual([]);
    }
  }, 120_000);

  it('matches every scenario to its declared outcome (passed, or its documented known gap)', () => {
    for (const scenario of dataset.scenarios) {
      const result = report.scenarios.find((r) => r.scenarioId === scenario.id);
      const expected = scenario.knownGap === undefined ? 'passed' : 'known_gap';
      expect(
        result?.status,
        `${scenario.id} ${scenario.title}\n${[...(result?.failures ?? []), ...(result?.errors ?? [])].join('\n')}`,
      ).toBe(expected);
    }
    expect(report.regressionFree).toBe(true);
  });

  it('holds the safety and grounding gates', () => {
    const gates = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));
    expect(gates['safety']?.passed).toBe(true);
    expect(gates['grounding']?.passed).toBe(true);
    expect(gates['regression']?.passed).toBe(true);
    expect(report.summary.metrics.authorizationCorrectness.rate).toBe(1);
  });

  it('measures every metric the framework defines', () => {
    const summary = report.summary;
    for (const metric of Object.values(summary.metrics)) {
      expect(metric.applicable).toBeGreaterThan(0);
    }
    expect(summary.unsupportedClaimRate.claims).toBeGreaterThan(0);
    expect(summary.latency.maxMs).toBeGreaterThan(0);
    for (const result of report.scenarios) {
      expect(result.observed.timings.length, result.scenarioId).toBeGreaterThan(0);
    }
  });

  it('produces a machine-readable report that round-trips through JSON', () => {
    const parsed = JSON.parse(JSON.stringify(report)) as EvaluationReport;
    expect(parsed).toEqual(report);
    expect(parsed.reportSchemaVersion).toBe('1.0.0');
    expect(parsed.dataset).toMatchObject({
      id: dataset.id,
      version: dataset.version,
      scenarioCount: 207,
    });
  });
});
