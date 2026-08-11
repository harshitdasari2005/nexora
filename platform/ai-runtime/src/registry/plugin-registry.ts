/**
 * @nexora/ai-runtime — plugin registry.
 *
 * The AI side of plugin registration (SAD.md §7.6 AI registration, AIR.md
 * §5): consumes plugin contributions from `@nexora/plugin-sdk` (agent,
 * skill, tool contributions) and registers the canonical discovery entries
 * into the {@link RuntimeRegistry}, the skill index, and the executable
 * tool registry. The runtime stays plugin-agnostic — it reads the manifest
 * contracts, never the plugin internals.
 */

import type {
  AgentSkill,
  AgentTool,
  CapabilityDeclaration,
  ToolContract,
} from '@nexora/contracts/ai';
import type { PluginManifest } from '@nexora/contracts/plugin';
import type { AgentContribution } from '@nexora/plugin-sdk/agents';
import type { SkillContribution } from '@nexora/plugin-sdk/skills';
import type { ToolContribution } from '@nexora/plugin-sdk/tools';
import { resolveContribution } from '@nexora/plugin-sdk/agents';

import { registryEntries } from './runtime-registry.js';
import type { RuntimeRegistry } from './runtime-registry.js';
import type { SkillIndex } from './skill-index.js';
import type { ExecutableToolRegistry } from './executable-tools.js';

/** Result of registering a plugin's AI surface. */
export interface PluginRegistrationResult {
  /** Capability ids registered. */
  capabilityIds: readonly string[];
  /** Skill ids indexed. */
  skillIds: readonly string[];
  /** Tool ids registered. */
  toolIds: readonly string[];
  /** Agent ids registered. */
  agentIds: readonly string[];
}

/**
 * Registers a plugin's manifest and contributions into the runtime
 * registries. Contributions may be lazy factories; they are resolved at
 * registration time.
 */
export async function registerPluginAiSurface(input: {
  /** The plugin manifest (contracts shape). */
  manifest: PluginManifest;
  /** The runtime registry to populate. */
  registry: RuntimeRegistry;
  /** The skill index to populate. */
  skills: SkillIndex;
  /** The executable tool registry to populate. */
  tools: ExecutableToolRegistry;
  /** Capability declarations contributed by the plugin. */
  capabilities?: readonly CapabilityDeclaration[];
  /** Skill contributions (from the plugin SDK). */
  skillContributions?: readonly SkillContribution[];
  /** Tool contributions (from the plugin SDK). */
  toolContributions?: readonly ToolContribution[];
  /** Agent contributions (from the plugin SDK). */
  agentContributions?: readonly AgentContribution[];
}): Promise<PluginRegistrationResult> {
  const { manifest, registry, skills, tools } = input;
  const owner = manifest.id;

  // Plugin entry (re-registration is idempotent: already present wins).
  if (registry.resolve('plugin', manifest.id) === undefined) {
    registry.register(
      registryEntries.plugin({
        plugin: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          state: 'active',
        },
        manifest,
        owner,
        version: manifest.version,
      }),
    );
  }

  // Capabilities (dedupe by capability id).
  const capabilityIds: string[] = [];
  for (const capability of input.capabilities ?? []) {
    if (registry.resolve('capability', capability.id) !== undefined) {
      continue;
    }
    registry.register(registryEntries.capability({ capability, owner, version: manifest.version }));
    capabilityIds.push(capability.id);
  }

  // Skills.
  const skillIds: string[] = [];
  for (const contribution of input.skillContributions ?? []) {
    const skill = await resolveContribution(contribution.skill);
    const contract: AgentSkill = {
      id: skill.manifest.id,
      description: skill.manifest.description,
      toolIds: skill.manifest.toolIds,
      autonomyTier: skill.manifest.autonomyTier,
      requiresApproval: skill.manifest.requiresApproval,
    };
    skills.index(contract, `agent:${owner}`, owner);
    skillIds.push(contract.id);
  }

  // Tools (dedupe by tool id across the executable and metadata registries).
  const toolIds: string[] = [];
  for (const contribution of input.toolContributions ?? []) {
    const tool = await resolveContribution(contribution.tool);
    if (tools.resolve(tool.manifest.id) !== undefined) {
      continue;
    }
    tools.register(tool);
    const contract = toToolContract(tool.manifest);
    registry.register(
      registryEntries.tool({
        tool: contract,
        owner,
        version: manifest.version,
        ownedByAgents: [manifest.id],
      }),
    );
    toolIds.push(contract.id);
  }

  // Agents (dedupe by agent id; skills/tools still indexed on re-registration).
  const agentIds: string[] = [];
  for (const contribution of input.agentContributions ?? []) {
    const agent = await resolveContribution(contribution.agent);
    const agentManifest = agent.manifest;
    if (registry.resolve('agent', agentManifest.identity.id) === undefined) {
      registry.register(
        registryEntries.agent({
          agent: agentManifest.identity,
          manifest: agentManifest,
          health: 'healthy',
          owner,
          version: manifest.version,
        }),
      );
      agentIds.push(agentManifest.identity.id);
    }
    // Index the agent's declared skills so discovery can resolve them.
    for (const skill of agentManifest.skills) {
      if (skills.resolve(skill.id) === undefined) {
        skills.index(skill, agentManifest.identity.id, owner);
        skillIds.push(skill.id);
      }
    }
    // Register the agent's declared tools as contracts.
    for (const tool of agentManifest.tools) {
      if (registry.resolve('tool', tool.id) === undefined) {
        registry.register(
          registryEntries.tool({
            tool: toToolContract(tool),
            owner,
            version: manifest.version,
            ownedByAgents: [agentManifest.identity.id],
          }),
        );
        toolIds.push(tool.id);
      }
    }
  }

  return { capabilityIds, skillIds, toolIds, agentIds };
}

/** Converts an agent-manifest tool shape to the tool contract shape. */
function toToolContract(
  tool: Pick<AgentTool, 'id' | 'sideEffectClass' | 'idempotent' | 'timeoutMs' | 'inputSchema'>,
): ToolContract {
  return {
    id: tool.id,
    description: tool.id,
    sideEffectClass: tool.sideEffectClass,
    idempotent: tool.idempotent,
    timeoutMs: tool.timeoutMs,
    inputSchema: tool.inputSchema,
  };
}
