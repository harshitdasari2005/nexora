/**
 * @nexora/ai-runtime — capability resolver.
 *
 * Resolves a matched capability into its implementation chain — the skill
 * that implements it and the tool(s) that skill may invoke (AIR.md §6.4,
 * SAD.md §10). Resolution is registry-driven only: nothing is hardcoded.
 */

import type { AgentSkill, CapabilityDeclaration, ToolContract } from '@nexora/contracts/ai';
import { CapabilityNotResolvedError } from '../errors/index.js';
import type { RuntimeRegistry } from '../registry/runtime-registry.js';
import type { SkillIndex } from '../registry/skill-index.js';

/** The resolved implementation chain of a capability. */
export interface ResolvedCapability {
  /** The capability declaration. */
  capability: CapabilityDeclaration;
  /** The skill implementing the capability. */
  skill?: AgentSkill;
  /** The tool(s) the skill may invoke. */
  tools: readonly ToolContract[];
}

/** Resolves capabilities against the runtime registries. */
export class CapabilityResolver {
  /**
   * @param registry - the platform capability registry.
   * @param skills   - the runtime skill index.
   */
  constructor(
    private readonly registry: RuntimeRegistry,
    private readonly skills: SkillIndex,
  ) {}

  /**
   * Resolves a capability id into its implementation chain.
   *
   * @throws {CapabilityNotResolvedError} when the capability is unknown.
   */
  resolve(capabilityId: string): ResolvedCapability {
    const entry = this.registry.resolve('capability', capabilityId);
    if (entry === undefined || entry.registry !== 'capability') {
      throw new CapabilityNotResolvedError(`Capability not found: ${capabilityId}`);
    }

    const capability = entry.capability;
    const skill = this.skills.resolve(capability.skillId);
    const tools = this.registry
      .tools()
      .filter((toolEntry) => skill?.skill.toolIds.includes(toolEntry.tool.id))
      .map((toolEntry) => toolEntry.tool);

    return { capability, skill: skill?.skill, tools };
  }
}
