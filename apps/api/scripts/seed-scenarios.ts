/**
 * @nexora/app-api — deterministic scenario seed / reset for PostgreSQL.
 *
 * Seeds the Nexora enterprise scenario dataset (Aurora Fintech + Borealis
 * Logistics, and every scenario's own fixtures) into the database in
 * DATABASE_URL — the same state `pnpm eval:run` evaluates against.
 *
 * Usage:
 *   pnpm scenarios:seed                                    # idempotent seed
 *   pnpm scenarios:reset                                   # delete the dataset's rows, then seed
 *   pnpm scenarios:seed --attach-user alex@nexora.dev      # let a signed-in account see Aurora as Meera (CEO)
 *   pnpm scenarios:seed --attach-user alex@nexora.dev --as rahul   # …or as another persona
 *   pnpm scenarios:seed --dry-run                          # print the plan; touch nothing
 *
 * Scope: only rows belonging to the dataset's own deterministic
 * organizations, workspaces, and users are ever written or deleted. The
 * existing demo seed (`pnpm demo:reset`, org `nexora-demo`) is untouched.
 *
 * Scenario users authenticate through the IdP only. The local Keycloak realm
 * does not contain them, so to browse a scenario tenant in the web app use
 * --attach-user with an account that has signed in once.
 */

import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { createDatabase } from '@nexora/persistence';
import { buildBaseWorld, buildDatasetV1, validateDataset } from '@nexora/evaluation';

import {
  attachUserAsPersona,
  distinctWorlds,
  planScenarioReset,
  resetScenarioData,
  scenarioScope,
  seedScenarioDataset,
} from '../evaluation/postgres.js';

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      reset: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'attach-user': { type: 'string' },
      as: { type: 'string', default: 'meera' },
    },
  });

  const dataset = buildDatasetV1();
  const issues = validateDataset(dataset);
  if (issues.length > 0) throw new Error(`Invalid scenario dataset:\n- ${issues.join('\n- ')}`);
  const scope = scenarioScope(dataset);
  const worlds = distinctWorlds(dataset);
  log(
    `Dataset ${dataset.id}@${dataset.version}: ${dataset.scenarios.length} scenarios, ${worlds.length} worlds`,
  );
  log(
    `Scope: ${scope.organizationIds.length} organizations, ${scope.workspaceIds.length} workspaces, ${scope.userIds.length} users`,
  );

  if (values['dry-run']) {
    if (values.reset) {
      log('Reset plan (table ← scope columns):');
      for (const rule of planScenarioReset()) log(`  ${rule.table} ← ${rule.by.join(' | ')}`);
    }
    for (const world of worlds) {
      log(`World ${world.id}: ${world.entities.length} entities`);
    }
    log('Dry run — nothing written.');
    return;
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Configure the repo-root .env (see .env.example) and start PostgreSQL (`pnpm dev:infra`).',
    );
  }
  const db = createDatabase(databaseUrl);

  if (values.reset) {
    const deleted = await resetScenarioData(db, scope);
    const total = Object.values(deleted).reduce((sum, n) => sum + n, 0);
    log(`Reset: deleted ${total} row(s) owned by the dataset`);
    for (const [table, count] of Object.entries(deleted)) {
      if (count > 0) log(`  ${table}: ${count}`);
    }
  }

  const { repositories, summaries } = await seedScenarioDataset(db, dataset);
  for (const summary of summaries) {
    const counts = Object.entries(summary.counts)
      .map(([kind, n]) => `${kind}=${n}`)
      .join(' ');
    log(`Seeded ${summary.worldId}: ${counts}`);
    for (const note of summary.skipped) log(`  skipped ${note}`);
  }

  const attach = values['attach-user'];
  if (attach !== undefined) {
    const persona = values.as ?? 'meera';
    const attached = await attachUserAsPersona(repositories, buildBaseWorld(), attach, persona);
    log(
      `Attached ${attach} (${attached.userId}) as persona "${persona}": ${attached.memberships} membership(s)`,
    );
  }

  log(
    'Scenario data ready. Sign in and switch to "Aurora Fintech" (requires --attach-user for a real login).',
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(
      `\nscenarios:seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
