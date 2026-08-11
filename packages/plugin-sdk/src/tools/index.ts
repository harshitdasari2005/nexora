/**
 * @nexora/plugin-sdk — tools.
 *
 * Tool contributions: the Agent SDK tools a plugin makes available to agents
 * (AIR.md §10). The `Tool` contract is the Agent SDK's — never redefined —
 * and contributions are applied onto agents via
 * `@nexora/plugin-sdk/agents`.
 */

export type { Tool, ToolManifest, ToolResult, ToolExecutionContext } from '@nexora/agent-sdk/tools';

import type { Tool } from '@nexora/agent-sdk/tools';
import type { PluginId } from '../types/index.js';

/** A tool factory: constructs a tool instance (lazy, per runtime). */
export type PluginToolFactory = () => Tool<unknown, unknown>;

/** A tool contribution: a ready tool or a factory producing one. */
export interface ToolContribution {
  /** Contribution kind discriminant. */
  kind: 'tool';
  /** The tool id (must match the manifest). */
  id: string;
  /** The tool, or a factory constructing it. */
  tool: Tool<unknown, unknown> | PluginToolFactory;
  /** Owning plugin id. */
  pluginId?: PluginId;
}
