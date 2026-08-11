/**
 * @nexora/plugin-sdk — skills.
 *
 * Skill contributions: the Agent SDK skills a plugin makes available
 * (AIR.md §5). The `Skill` contract is the Agent SDK's — never redefined —
 * and contributions are applied onto agents via
 * `@nexora/plugin-sdk/agents`.
 */

export type { Skill, SkillManifest, SkillInput, SkillOutput } from '@nexora/agent-sdk/skills';

import type { Skill } from '@nexora/agent-sdk/skills';
import type { PluginId } from '../types/index.js';

/** A skill factory: constructs a skill instance (lazy). */
export type PluginSkillFactory = () => Skill<unknown, unknown>;

/** A skill contribution: a ready skill or a factory producing one. */
export interface SkillContribution {
  /** Contribution kind discriminant. */
  kind: 'skill';
  /** The skill id (must match the manifest). */
  id: string;
  /** The skill, or a factory constructing it. */
  skill: Skill<unknown, unknown> | PluginSkillFactory;
  /** Owning plugin id. */
  pluginId?: PluginId;
}
