/**
 * @nexora/evaluation — the Nexora enterprise scenario & evaluation framework.
 *
 * - {@link buildDatasetV1} — the versioned, deterministic scenario dataset.
 * - {@link WorldBuilder} / {@link extendWorld} — reusable fixture factories.
 * - {@link validateDataset} — structural integrity before anything runs.
 * - {@link evaluateScenario} / {@link buildReport} — pure metric evaluation
 *   and the machine-readable report.
 *
 * The runner that drives the real platform lives in `@nexora/app-api`
 * (`apps/api/evaluation`); this package has no I/O and no app dependency.
 */

export * from './scenario.js';
export * from './observation.js';
export * from './ids.js';
export * from './factories.js';
export * from './grounding.js';
export * from './metrics.js';
export * from './report.js';
export * from './validate.js';
export { buildBaseWorld, BASE_WORLD_ID, REFERENCE_TIME } from './catalog/world-v1.js';
export { buildDatasetV1, DATASET_ID, DATASET_VERSION } from './catalog/scenarios-v1.js';
