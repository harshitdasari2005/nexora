/**
 * @nexora/mcp — capability-aware tool discovery.
 *
 * MCP tool listing is capability-aware (S24 Phase 5): a caller sees only
 * the tools whose `requiredCapability` is in their trusted capability
 * affinity. This mirrors the AI Runtime's `CapabilityDiscovery` narrowing
 * and uses the SAME affinity source (the Phase 1 catalog bridged to
 * executable AI capability ids) — there is no second role → capability
 * mapping for MCP.
 *
 * Security contract:
 * - Discovery is NOT authorization: a visible tool still runs through the
 *   existing governed execution path, and `canCallTool` re-checks the
 *   capability at invocation time (a guessed tool name never becomes
 *   available just because the caller guesses it).
 * - An empty/absent capability affinity exposes NO tools (fail closed).
 */

import type { NexoraMCPTool } from './tool.js';

/** Whether a tool is visible to a caller with the given capability ids. */
export function isToolVisible(tool: NexoraMCPTool, capabilityIds: readonly string[]): boolean {
  return capabilityIds.includes(tool.definition.requiredCapability);
}

/**
 * Filters the tool set by the caller's capability affinities. A caller with
 * no (or unknown) capabilities sees no tools — the surface fails closed.
 */
export function filterToolsByCapabilities(
  tools: readonly NexoraMCPTool[],
  capabilityIds: readonly string[],
): readonly NexoraMCPTool[] {
  const allowed = new Set(capabilityIds);
  return tools.filter((tool) => allowed.has(tool.definition.requiredCapability));
}

/**
 * Whether a caller may invoke a tool by name. The capability check is
 * re-applied at call time (defense in depth): an unlisted tool is
 * indistinguishable from a nonexistent one.
 */
export function canCallTool(tool: NexoraMCPTool, capabilityIds: readonly string[]): boolean {
  return capabilityIds.includes(tool.definition.requiredCapability);
}
