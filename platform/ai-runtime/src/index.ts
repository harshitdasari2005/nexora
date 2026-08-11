/**
 * @nexora/ai-runtime — barrel export.
 *
 * The Enterprise AI Runtime (AIR.md §1): the orchestration layer between the
 * UI and every business capability. Exports the orchestrator, planner,
 * reasoning, execution, registry, discovery, verification, conversation,
 * memory, context, prompting, providers, adapters, telemetry, and event
 * modules. Prefer narrow subpath imports (e.g. `@nexora/ai-runtime/planner`)
 * to keep the dependency graph explicit.
 *
 * The runtime depends only on `@nexora/contracts`, `@nexora/shared`,
 * `@nexora/config`, `@nexora/agent-sdk`, and `@nexora/plugin-sdk` — no
 * domains, no business logic, no LLM-provider coupling (providers are
 * injected through the provider registry).
 */

export * from './adapters/index.js';
export * from './approval/index.js';
export * from './context/index.js';
export * from './conversation/index.js';
export * from './discovery/index.js';
export * from './errors/index.js';
export * from './events/index.js';
export * from './execution/index.js';
export * from './memory/index.js';
export * from './orchestrator/index.js';
export * from './planner/index.js';
export * from './prompting/index.js';
export * from './providers/index.js';
export * from './reasoning/index.js';
export * from './registry/index.js';
export * from './telemetry/index.js';
export * from './verification/index.js';
