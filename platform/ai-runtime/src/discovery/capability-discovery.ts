/**
 * @nexora/ai-runtime — capability discovery.
 *
 * The discovery service (AIR.md §5, SAD.md §10): turns an intent into a
 * permission-filtered, ranked set of candidate capabilities, skills, tools,
 * and agents. Guarantees (AIR.md §5.3): no hardcoding, permission-filtered
 * visibility, freshness via registry state, and traceability via the
 * returned scores.
 */

import type {
  AgentIdentity,
  AgentSkill,
  AgentTool,
  CapabilityDeclaration,
  ToolContract,
} from '@nexora/contracts/ai';
import type { DiscoveryResult } from '@nexora/contracts/registry';
import type { PermissionContext } from '../context/index.js';
import { DiscoveryError } from '../errors/index.js';
import { CapabilityMatcher, type CapabilityScore } from './capability-matcher.js';
import type { RuntimeRegistry } from '../registry/runtime-registry.js';
import type { SkillIndex } from '../registry/skill-index.js';

/** A discovery query. */
export interface DiscoveryRequest {
  /** The user intent. */
  intent: string;
  /** The effective permission context of the run. */
  permissions: PermissionContext;
  /** Optional capability-id allow-list (e.g. from a command palette). */
  allowedCapabilityIds?: readonly string[];
}

/** The outcome of a discovery query: matches plus the ranked scores. */
export interface DiscoveryOutcome extends DiscoveryResult {
  /** Ranked capability scores (best first). */
  scores: readonly CapabilityScore[];
  /** Capabilities that matched the intent. */
  capabilities: readonly CapabilityDeclaration[];
  /** Skills backing the matched capabilities. */
  skills: readonly AgentSkill[];
  /** Tools backing the matched capabilities. */
  tools: readonly AgentTool[];
  /** Agents owning the matched skills. */
  agents: readonly AgentIdentity[];
}

/**
 * The discovery service: permission-filters the registry, ranks capabilities
 * for the intent, and assembles the canonical {@link DiscoveryResult}.
 */
export class CapabilityDiscovery {
  /**
   * @param registry - the platform capability registry.
   * @param skills   - the runtime skill index.
   * @param matcher  - the intent matcher; defaults to a token-overlap matcher.
   */
  constructor(
    private readonly registry: RuntimeRegistry,
    private readonly skills: SkillIndex,
    private readonly matcher: CapabilityMatcher = new CapabilityMatcher(),
  ) {}

  /**
   * Discovers capabilities for an intent under the run's permissions.
   *
   * @throws {DiscoveryError} when discovery cannot complete (registry empty
   *         results are a valid outcome, not an error).
   */
  discover(request: DiscoveryRequest): DiscoveryOutcome {
    try {
      const candidates = this.#filterByPermissions(request);
      if (request.allowedCapabilityIds !== undefined) {
        const allowed = new Set(request.allowedCapabilityIds);
        return this.#assemble(
          candidates.filter((capability) => allowed.has(capability.id)),
          request,
        );
      }
      return this.#assemble(candidates, request);
    } catch (error) {
      throw new DiscoveryError('Capability discovery failed', undefined, error);
    }
  }

  /** The ranked capability scores for an intent (for observability). */
  rank(request: DiscoveryRequest): readonly CapabilityScore[] {
    const candidates = this.#filterByPermissions(request);
    return this.matcher.match(request.intent, candidates);
  }

  #filterByPermissions(request: DiscoveryRequest): readonly CapabilityDeclaration[] {
    const allowed = new Set(request.permissions.allowedActions ?? []);
    const hasActionScope =
      request.permissions.allowedActions !== undefined &&
      request.permissions.allowedActions.length > 0;
    return this.registry
      .capabilities()
      .map((entry) => entry.capability)
      .filter((capability) => !hasActionScope || allowed.has(capability.id));
  }

  #assemble(
    candidates: readonly CapabilityDeclaration[],
    request: DiscoveryRequest,
  ): DiscoveryOutcome {
    const scores = this.matcher.match(request.intent, candidates);
    const matchedIds = new Set(scores.map((score) => score.capabilityId));
    const matched = candidates.filter((capability) => matchedIds.has(capability.id));

    const skillIds = new Set<string>();
    const toolIds = new Set<string>();
    const agentIds = new Set<string>();
    for (const capability of matched) {
      const skill = this.skills.resolve(capability.skillId);
      if (skill !== undefined) {
        skillIds.add(skill.skill.id);
        agentIds.add(skill.agentId);
        for (const toolId of skill.skill.toolIds) {
          toolIds.add(toolId);
        }
      }
    }

    const skills = [...skillIds]
      .map((id) => this.skills.resolve(id)?.skill)
      .filter((skill): skill is AgentSkill => skill !== undefined);
    const tools = [...toolIds]
      .map((id) => this.registry.resolve('tool', id))
      .filter((entry) => entry !== undefined && entry.registry === 'tool')
      .map((entry) => {
        const tool = (entry as { tool: ToolContract }).tool;
        return {
          id: tool.id,
          sideEffectClass: tool.sideEffectClass,
          idempotent: tool.idempotent,
          timeoutMs: tool.timeoutMs,
          inputSchema: tool.inputSchema,
        } satisfies AgentTool;
      });
    const agents = [...agentIds]
      .map((id) => this.registry.resolve('agent', id))
      .filter((entry) => entry !== undefined && entry.registry === 'agent')
      .map((entry) => (entry as { agent: AgentIdentity }).agent);

    return { capabilities: matched, skills, tools, agents, scores };
  }
}
