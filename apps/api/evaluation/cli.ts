/**
 * @nexora/app-api — `pnpm eval:run`: runs the scenario dataset against the
 * real platform (in-memory harness) and writes the machine-readable report.
 *
 * Usage:
 *   pnpm eval:run                                   # all scenarios → evaluation-results/
 *   pnpm eval:run --scenario NXS-003,NXS-013        # a subset
 *   pnpm eval:run --out ./my-report.json            # explicit report path
 *   pnpm eval:run --export-dataset ./dataset.json   # also write the scenario dataset as JSON
 *   pnpm eval:run --use-env-ai                      # narrate with AI_PROVIDER/AI_* from .env
 *   pnpm eval:run --strict                          # exit 1 unless every quality gate passes
 *
 * Exit code: 1 on a regression (a scenario failed outside a documented known
 * gap, or errored); with --strict, 1 unless every quality gate passes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { buildDatasetV1, formatReportSummary } from '@nexora/evaluation';

import { runDataset } from './runner.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Narration-provider variables forwarded with --use-env-ai (nothing else leaks in). */
const AI_ENV_KEYS = [
  'AI_PROVIDER',
  'AI_BASE_URL',
  'AI_API_KEY',
  'AI_MODEL',
  'GROQ_API_KEY',
] as const;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string' },
      out: { type: 'string' },
      'export-dataset': { type: 'string' },
      'use-env-ai': { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
    },
  });

  const env: Record<string, string> = {};
  if (values['use-env-ai']) {
    loadEnv({ path: resolve(REPO_ROOT, '.env') });
    for (const key of AI_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined && value.length > 0) env[key] = value;
    }
  }

  const dataset = buildDatasetV1();
  if (values['export-dataset'] !== undefined) {
    const path = resolve(process.cwd(), values['export-dataset']);
    write(path, dataset);
    process.stdout.write(`Dataset written to ${path}\n`);
  }

  const only = values.scenario
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const report = await runDataset(dataset, { env, ...(only === undefined ? {} : { only }) });

  const stamp = report.run.startedAt.replace(/[:.]/g, '-');
  const outPath =
    values.out === undefined
      ? resolve(
          REPO_ROOT,
          'evaluation-results',
          `${report.dataset.id}-${report.dataset.version}-${stamp}.json`,
        )
      : resolve(process.cwd(), values.out);
  write(outPath, report);
  if (values.out === undefined)
    write(resolve(REPO_ROOT, 'evaluation-results', 'latest.json'), report);

  process.stdout.write(`${formatReportSummary(report)}\n\nReport written to ${outPath}\n`);
  if (values.strict) return report.passed ? 0 : 1;
  return report.regressionFree ? 0 : 1;
}

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(
      `eval:run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
