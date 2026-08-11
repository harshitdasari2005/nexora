/**
 * @nexora/ai-runtime — discovery.
 *
 * Capability discovery (AIR.md §5): matching, resolution, and the discovery
 * service the orchestrator queries. The EAO and Planner never hardcode
 * applications — everything they can do is discovered from the registry
 * (ADR-005).
 */

export * from './capability-discovery.js';
export * from './capability-matcher.js';
export * from './capability-resolver.js';
