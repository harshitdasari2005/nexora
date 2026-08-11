/**
 * @nexora/agent-sdk — barrel export.
 *
 * The canonical, provider-independent SDK for building AI Agents (AIR.md
 * §3). Re-exports every module; prefer narrow subpath imports (e.g.
 * `@nexora/agent-sdk/base`) to keep the dependency graph explicit.
 *
 * The SDK depends only on `@nexora/contracts`, `@nexora/shared`, and
 * `@nexora/config` — no domains, no platform modules, no LLM providers.
 */

export * from './approval/index.js';
export * from './base/index.js';
export * from './builders/index.js';
export * from './capabilities/index.js';
export * from './contexts/index.js';
export * from './errors/index.js';
export * from './events/index.js';
export * from './execution/index.js';
export * from './health/index.js';
export * from './knowledge/index.js';
export * from './lifecycle/index.js';
export * from './memory/index.js';
export * from './metrics/index.js';
export * from './planning/index.js';
export * from './policies/index.js';
export * from './reasoning/index.js';
export * from './registry/index.js';
export * from './skills/index.js';
export * from './testing/index.js';
export * from './tools/index.js';
export * from './types/index.js';
