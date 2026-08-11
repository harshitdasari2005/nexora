/**
 * @nexora/ai-runtime — registry.
 *
 * The platform-side discovery registries (AIR.md §1.2 R10 Capability
 * Registry, SAD.md §10): the {@link RuntimeRegistry} holds canonical
 * registry entries (from `@nexora/contracts/registry`); {@link SkillIndex}
 * and {@link ExecutableToolRegistry} hold the runtime-facing resolution
 * tables the planner and executor consume.
 *
 * The registry is the *read-model* for capability discovery: the EAO and
 * Planner never hardcode applications — they plan over these records
 * (ADR-005, AIR.md §5).
 */

export * from './executable-tools.js';
export * from './runtime-registry.js';
export * from './skill-index.js';
