/**
 * @nexora/persistence — barrel export.
 *
 * The PostgreSQL persistence layer: Drizzle schema, migrations, and
 * repository implementations behind the domain repository interfaces
 * (PERSISTENCE.md). The application container (apps/api) wires these into
 * the domain services.
 */

export * from './db.js';
export * from './hasher/index.js';
export * from './migrate.js';
export * from './repositories/index.js';
export * from './schema/index.js';
