/**
 * @nexora/persistence — migration runner.
 *
 * Applies the drizzle migrations from `./drizzle` against a connection
 * string. Used by the application container at startup (ROADMAP.md Phase 1
 * migrations) and by tests. Idempotent: drizzle records applied migrations
 * in `__drizzle_migrations`.
 */

import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

import { createDatabaseFromPool } from './db.js';

/**
 * Absolute path to the migrations folder (`<pkg>/drizzle`, colocated with
 * the package). The compiled module lives at `<pkg>/dist/src/migrate.js` and
 * the source at `<pkg>/src/migrate.ts`, so the folder is resolved by walking
 * up to the package root rather than a fixed relative depth.
 */
function resolveMigrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate the drizzle migrations folder (drizzle/meta/_journal.json).');
}

const MIGRATIONS_FOLDER = resolveMigrationsFolder();

/**
 * Applies all pending migrations.
 *
 * @param connectionString - PostgreSQL connection string.
 * @param options          - optional pool lifecycle (defaults to `close`).
 */
export async function runMigrations(
  connectionString: string,
  options: { closePool?: boolean } = {},
): Promise<void> {
  const pool = new pg.Pool({ connectionString });
  try {
    const db = createDatabaseFromPool(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    if (options.closePool !== false) {
      await pool.end();
    }
  }
}

/** CLI entry: `node dist/src/migrate.js <connectionString>`. */
async function main(): Promise<void> {
  const connectionString = process.argv[2] ?? process.env.DATABASE_URL;
  if (connectionString === undefined) {
    throw new Error('Missing connection string: pass it as argv[2] or set DATABASE_URL.');
  }
  await runMigrations(connectionString);
  process.stdout.write('Migrations applied.\n');
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Migration failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
