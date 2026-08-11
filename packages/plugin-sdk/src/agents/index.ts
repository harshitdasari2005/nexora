/**
 * @nexora/plugin-sdk — agents.
 *
 * AI contributions: the agents, skills, tools, and capabilities a plugin
 * contributes to the AI Runtime (AIR.md §3, §5). Every AI surface is the
 * Agent SDK's contract — this module wires plugin contributions onto
 * {@link BaseAgent} instances (SAD.md §7.6 AI registration).
 */

import type { BaseAgent } from '@nexora/agent-sdk/base';
import type { Capability } from '@nexora/agent-sdk/capabilities';
import type { PluginId } from '../types/index.js';
import type { SkillContribution } from '../skills/index.js';
import type { ToolContribution } from '../tools/index.js';

/** An agent factory: constructs an agent instance (lazy). */
export type PluginAgentFactory = () => BaseAgent | Promise<BaseAgent>;

/** An agent contribution: a ready agent or a factory producing one. */
export interface AgentContribution {
  /** Contribution kind discriminant. */
  kind: 'agent';
  /** The agent id (must match the manifest identity). */
  id: string;
  /** The agent, or a factory constructing it. */
  agent: BaseAgent | PluginAgentFactory;
  /** Owning plugin id. */
  pluginId?: PluginId;
}

/** A capability contribution: a discoverable capability (AIR.md §5). */
export interface CapabilityContribution {
  /** Contribution kind discriminant. */
  kind: 'capability';
  /** The capability (Agent SDK contract). */
  capability: Capability;
  /** Owning plugin id. */
  pluginId?: PluginId;
}

/**
 * Resolves a skill or tool contribution to its instance (factory or value).
 */
export function resolveContribution<T>(contribution: T | (() => T | Promise<T>)): T | Promise<T> {
  return typeof contribution === 'function'
    ? (contribution as () => T | Promise<T>)()
    : contribution;
}

/**
 * Applies a plugin's skill/tool contributions onto an agent's registries
 * (AIR.md §5). Only contributions that resolve to instances are registered;
 * errors are surfaced to the caller (the AI Runtime) for observability.
 *
 * @param agent         - the agent to apply contributions onto.
 * @param contributions - the plugin's skill and tool contributions.
 * @returns the number of contributions applied.
 */
export async function applyAgentContributions(
  agent: BaseAgent,
  contributions: readonly (SkillContribution | ToolContribution)[],
): Promise<number> {
  let applied = 0;
  for (const contribution of contributions) {
    if (contribution.kind === 'skill') {
      const skill = await resolveContribution(contribution.skill);
      agent.skills.register(skill);
      applied += 1;
    } else if (contribution.kind === 'tool') {
      const tool = await resolveContribution(contribution.tool);
      agent.tools.register(tool);
      applied += 1;
    }
  }
  return applied;
}
