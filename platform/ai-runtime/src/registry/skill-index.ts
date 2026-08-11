/**
 * @nexora/ai-runtime — skill index.
 *
 * A runtime-facing index of skills registered by agents/plugins (AIR.md §5
 * skill manifest). Skills live inside agent manifests in the canonical
 * contracts; this index flattens them for the planner's capability →
 * skill → tool resolution (AIR.md §6).
 */

import type { AgentSkill } from '@nexora/contracts/ai';

/** A skill indexed with its owning agent and plugin. */
export interface IndexedSkill {
  /** The skill contract. */
  skill: AgentSkill;
  /** The agent id owning the skill. */
  agentId: string;
  /** The plugin id that contributed the skill, when known. */
  pluginId?: string;
}

/** In-memory skill index keyed by skill id. */
export class SkillIndex {
  readonly #skills = new Map<string, IndexedSkill>();

  /** Indexes a skill. Throws on duplicate ids. */
  index(skill: AgentSkill, agentId: string, pluginId?: string): void {
    if (this.#skills.has(skill.id)) {
      throw new Error(`Skill already indexed: ${skill.id}`);
    }
    this.#skills.set(skill.id, { skill, agentId, pluginId });
  }

  /** Removes a skill. Returns true when one was removed. */
  remove(skillId: string): boolean {
    return this.#skills.delete(skillId);
  }

  /** Resolves a skill, or `undefined`. */
  resolve(skillId: string): IndexedSkill | undefined {
    return this.#skills.get(skillId);
  }

  /** All indexed skills. */
  all(): readonly IndexedSkill[] {
    return [...this.#skills.values()];
  }

  /** The number of indexed skills. */
  get size(): number {
    return this.#skills.size;
  }
}
