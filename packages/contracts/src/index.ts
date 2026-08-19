/**
 * @nexora/contracts — canonical contracts, barrel export.
 *
 * The single source of truth for all cross-module contracts. Prefer narrow
 * subpath imports (e.g. `@nexora/contracts/events`) to keep the dependency
 * graph explicit; the barrel is provided for convenience.
 *
 * The package is type-only with zero runtime dependencies. Runtime constant
 * VALUES (e.g. `ERROR_CODES`, `SIDE_EFFECT_CLASSES`) and ID factories live
 * in `@nexora/shared`; contracts declares the canonical TYPE surface.
 */

export * from './common/index.js';
export * from './api/index.js';
export * from './events/index.js';
export * from './commands/index.js';
export * from './queries/index.js';
export * from './messages/index.js';
export * from './ai/index.js';
export * from './workflow/index.js';
export * from './plugin/index.js';
export * from './approval/index.js';
export * from './notification/index.js';
export * from './identity/index.js';
export * from './registry/index.js';
export * from './domain/index.js';
export * from './command-center/index.js';
export * from './agent/index.js';
export * from './detection/index.js';
export * from './remediation/index.js';
export * from './versioning/index.js';
export * from './guards/index.js';
