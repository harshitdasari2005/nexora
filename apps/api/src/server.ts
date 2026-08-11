/**
 * @nexora/app-api — process entry.
 *
 * Loads the environment (repo-root `.env`), applies pending migrations,
 * builds the application, and listens. Run locally with
 * `pnpm --filter @nexora/app-api dev` or `pnpm dev:api`.
 */

import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { createDatabase, runMigrations } from '@nexora/persistence';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { KeycloakOidcGateway } from './oidc/gateway.js';

/** Boots the API container. */
async function main(): Promise<void> {
  const config = loadConfig();

  if (config.autoMigrate) {
    await runMigrations(config.databaseUrl);
  }
  const database = createDatabase(config.databaseUrl);
  const oidc = new KeycloakOidcGateway(config.oidc);

  const app = await buildApp({ config, database, oidc });
  await app.listen({ port: config.port, host: config.host });
}

void main().catch((error: unknown) => {
  process.stderr.write(`Failed to start Nexora API: ${String(error)}\n`);
  process.exitCode = 1;
});
