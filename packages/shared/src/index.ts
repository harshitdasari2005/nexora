/**
 * @nexora/shared — barrel export.
 *
 * Re-exports the shared platform foundation for the default entry point.
 * Consumers may also import from subpaths (e.g. `@nexora/shared/result`) to
 * keep their module graph explicit.
 */

export * from './constants/index.js';
export * from './errors/index.js';
export * from './events/index.js';
export * from './ids/index.js';
export * from './logger/index.js';
export * from './result/index.js';
export * from './time/index.js';
export * from './utils/index.js';
export * from './validation/index.js';
