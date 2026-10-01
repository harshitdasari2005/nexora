import { describe, expect, it } from 'vitest';

import { buildBaseWorld } from '../src/catalog/world-v1.js';
import { buildDatasetV1, DATASET_VERSION } from '../src/catalog/scenarios-v1.js';
import { extendWorld, WorldIndex } from '../src/factories.js';
import { datasetFingerprint } from '../src/report.js';
import { SCENARIO_CATEGORIES, type ScenarioDefinition } from '../src/scenario.js';
import { validateDataset, validateScenario, validateWorld } from '../src/validate.js';

/**
 * The fingerprint of dataset v1.0.0. Changing any scenario changes it: bump
 * DATASET_VERSION (and a scenario's `revision`) and update this pin, so a
 * report's `dataset.version` always identifies exactly one scenario set.
 */
const PINNED = {
  version: '2.0.0',
  fingerprint: '74e7a94955cf4dae627101394c4092a7d4605c7e42f508e28e48671f27a792da',
};

describe('scenario dataset v1', () => {
  const dataset = buildDatasetV1();

  it('is structurally valid', () => {
    expect(validateDataset(dataset)).toEqual([]);
  });

  it('covers every required category', () => {
    const covered = new Set(dataset.scenarios.map((s) => s.category));
    for (const category of SCENARIO_CATEGORIES) expect(covered.has(category)).toBe(true);
  });

  it('is deterministic: two builds are identical', () => {
    expect(datasetFingerprint(buildDatasetV1())).toBe(datasetFingerprint(dataset));
  });

  it('is pinned to its version (edit a scenario → bump the version)', () => {
    expect(DATASET_VERSION).toBe(PINNED.version);
    expect(datasetFingerprint(dataset)).toBe(PINNED.fingerprint);
  });

  it('uses stable, never-reused scenario ids', () => {
    const ids = dataset.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^NXS-\d{3}$/);
  });

  it('never states expected UI text: facts come from the world data', () => {
    for (const scenario of dataset.scenarios) {
      const corpus = JSON.stringify(scenario.world);
      for (const fact of scenario.expected.response?.requiredFacts ?? []) {
        const inWorld = corpus.toLowerCase().includes(fact.value.toLowerCase());
        const inRequest =
          scenario.request.channel === 'chat' &&
          scenario.request.message.toLowerCase().includes(fact.value.toLowerCase());
        expect(inWorld || inRequest, `${scenario.id}: "${fact.value}"`).toBe(true);
      }
    }
  });

  it('marks every isolation/injection/unauthorized scenario as safety-critical', () => {
    const safetyCategories = new Set([
      'cross_workspace_denial',
      'cross_organization_denial',
      'unauthorized_mutation',
      'prompt_injection',
    ]);
    for (const scenario of dataset.scenarios.filter((s) => safetyCategories.has(s.category))) {
      expect(scenario.tags, scenario.id).toContain('safety');
    }
  });

  it('documents every known gap with metrics, a reason, and code references', () => {
    for (const scenario of dataset.scenarios.filter((s) => s.knownGap !== undefined)) {
      expect(scenario.knownGap?.metrics.length, scenario.id).toBeGreaterThan(0);
      expect(scenario.knownGap?.reason.length, scenario.id).toBeGreaterThan(20);
      expect(scenario.knownGap?.references.length, scenario.id).toBeGreaterThan(0);
    }
  });
});

describe('world factories', () => {
  it('builds a valid base world with platform-shaped deterministic ids', () => {
    const world = buildBaseWorld();
    expect(validateWorld(world)).toEqual([]);
    const index = new WorldIndex(world);
    expect(index.organization('aurora').id).toMatch(/^org_[0-9a-f-]{36}$/);
    expect(index.user('meera').id).toMatch(/^usr_/);
    expect(index.entityId('mobile-banking')).toMatch(/^prj_/);
  });

  it('namespaces extensions so scenario fixtures never collide', () => {
    const base = buildBaseWorld();
    const a = extendWorld(base, 'S-A', (w) =>
      w.project('shared-key', { organization: 'aurora', name: 'A', status: 'active' }),
    );
    const b = extendWorld(base, 'S-B', (w) =>
      w.project('shared-key', { organization: 'aurora', name: 'B', status: 'active' }),
    );
    expect(new WorldIndex(a).entityId('shared-key')).not.toBe(
      new WorldIndex(b).entityId('shared-key'),
    );
    expect(new WorldIndex(a).entityId('mobile-banking')).toBe(
      new WorldIndex(b).entityId('mobile-banking'),
    );
    expect(base.entities.some((e) => e.key === 'shared-key')).toBe(false);
  });
});

describe('validation catches broken fixtures', () => {
  const base = buildBaseWorld();

  it('rejects a self-approved expense (segregation of duties)', () => {
    const world = extendWorld(base, 'BAD', (w) =>
      w.expense('self', {
        organization: 'aurora',
        workspace: 'aurora-fin',
        budget: 'marketing-q3',
        submittedBy: 'rahul',
        decidedBy: 'rahul',
        description: 'x',
        amountMinorUnits: 1,
        currency: 'INR',
        status: 'approved',
      }),
    );
    expect(validateWorld(world).join(' ')).toContain('decider must differ');
  });

  it('rejects unknown keys and inconsistent expectations', () => {
    const scenario: ScenarioDefinition = {
      id: 'BAD-1',
      revision: 1,
      title: 'bad',
      category: 'calendar',
      domain: 'calendar',
      description: 'bad',
      tags: [],
      world: base,
      organization: 'aurora',
      request: {
        channel: 'chat',
        actor: 'nobody',
        message: 'x',
        decision: { decision: 'approve', actor: 'meera' },
      },
      expected: {
        intent: { kind: 'refused' },
        authorization: { outcome: 'denied' },
        retrieval: { required: ['missing-doc'], forbidden: [] },
        tools: { expected: [], forbidden: [] },
        approval: { required: false },
        execution: { outcome: 'succeeded' },
        verification: { outcome: 'verified', checks: [] },
        audit: { required: [], forbidden: [] },
      },
    };
    const issues = validateScenario(scenario).join('\n');
    expect(issues).toContain('Unknown user "nobody"');
    expect(issues).toContain('Unknown entity "missing-doc"');
    expect(issues).toContain('a decision step is declared but no approval is expected');
    expect(issues).toContain('a denied request cannot expect execution');
    expect(issues).toContain('verification outcome verified declares no checks');
  });

  it('rejects a workspace member without an organization membership', () => {
    const world = {
      ...base,
      organizationMemberships: base.organizationMemberships.filter((m) => m.user !== 'arjun'),
    };
    expect(validateWorld(world).join(' ')).toContain(
      'arjun is in workspace aurora-eng without an organization membership',
    );
  });
});

describe('employee lifecycle state checks', () => {
  it('accepts status filters on employee counts only', () => {
    const rollback = buildDatasetV1().scenarios.find(
      (s) => s.id === 'NXS-014',
    ) as ScenarioDefinition;
    expect(validateScenario(rollback)).toEqual([]);

    const misplaced: ScenarioDefinition = {
      ...rollback,
      expected: {
        ...rollback.expected,
        verification: {
          outcome: 'verified',
          checks: [
            {
              kind: 'count',
              entity: 'project',
              organization: 'aurora',
              status: 'active',
              equals: 0,
            },
          ],
        },
      },
    };
    expect(validateScenario(misplaced).join('\n')).toContain(
      'status filters apply to employee counts only',
    );
  });

  it('NXS-014 asserts BOTH that no live employee remains and that the record is retained', () => {
    const rollback = buildDatasetV1().scenarios.find(
      (s) => s.id === 'NXS-014',
    ) as ScenarioDefinition;
    const employeeChecks = rollback.expected.verification.checks.filter(
      (check) => check.kind === 'count' && check.entity === 'employee',
    );
    expect(employeeChecks).toEqual([
      expect.objectContaining({ statusNot: ['offboarded', 'cancelled'], equals: 0 }),
      expect.objectContaining({ status: 'offboarded', equals: 1 }),
    ]);
  });
});
