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

  // State the narration provider at boot: it is the only component that can
  // send prompt content (and therefore tenant data) out of this process, so
  // an operator must be able to see at a glance where that content goes.
  app.log.info(
    {
      provider: config.ai.provider,
      model: config.ai.model,
      endpoint:
        config.ai.provider === 'none'
          ? 'none (deterministic narration)'
          : (config.ai.baseUrl ?? 'provider default'),
    },
    'AI narration provider',
  );

  await app.listen({ port: config.port, host: config.host });
}

void main().catch((error: unknown) => {
  process.stderr.write(`Failed to start Nexora API: ${String(error)}\n`);
  process.exitCode = 1;
});
