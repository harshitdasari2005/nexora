/**
 * @nexora/config — barrel export.
 *
 * Re-exports the configuration framework for the default entry point.
 * Consumers may also import from subpaths (e.g. `@nexora/config/providers`).
 */

export * from './environment/index.js';
export * from './feature-flags/index.js';
export * from './loader/index.js';
export * from './manager/index.js';
export * from './merging/index.js';
export * from './providers/index.js';
export * from './schema/index.js';
export * from './secrets/index.js';
export * from './types/index.js';
export * from './validation/index.js';
