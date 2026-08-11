/**
 * @nexora/plugin-sdk — barrel export.
 *
 * The canonical SDK for building every Nexora plugin (SAD.md §7). Re-exports
 * every module; prefer narrow subpath imports (e.g. `@nexora/plugin-sdk/base`)
 * to keep the dependency graph explicit.
 *
 * The SDK depends only on `@nexora/contracts`, `@nexora/shared`,
 * `@nexora/config`, and `@nexora/agent-sdk` — no domains, no platform
 * modules, no frameworks, no LLM providers.
 */

export * from './agents/index.js';
export * from './base/index.js';
export * from './builders/index.js';
export * from './commands/index.js';
export * from './configuration/index.js';
export * from './errors/index.js';
export * from './events/index.js';
export * from './hooks/index.js';
export * from './installer/index.js';
export * from './knowledge/index.js';
export * from './lifecycle/index.js';
export * from './loader/index.js';
export * from './manifest/index.js';
export * from './navigation/index.js';
export * from './notifications/index.js';
export * from './pages/index.js';
export * from './permissions/index.js';
export * from './registry/index.js';
export * from './search/index.js';
export * from './skills/index.js';
export * from './testing/index.js';
export * from './tools/index.js';
export * from './types/index.js';
export * from './validators/index.js';
export * from './widgets/index.js';
export * from './workflow/index.js';
