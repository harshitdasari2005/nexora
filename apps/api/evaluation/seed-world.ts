/**
 * The scenario world seeder lives in `src/demo/seed-world.ts` (it is shared by
 * the evaluation harness, `pnpm scenarios:seed` and the demo world, so
 * production code never depends on this evaluation-only folder). Re-exported
 * here so existing evaluation imports keep working.
 */
export * from '../src/demo/seed-world.js';
