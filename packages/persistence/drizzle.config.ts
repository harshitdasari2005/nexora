/**
 * @nexora/persistence — drizzle-kit configuration.
 *
 * Generates and applies migrations for the Nexora schema (ROADMAP.md Phase 1
 * migrations; PERSISTENCE.md §4). `drizzle` points at the schema barrel; the
 * out folder keeps migrations next to the package for portability.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://nexora:nexora_dev_password@localhost:5433/nexora',
  },
  verbose: true,
  strict: true,
});
