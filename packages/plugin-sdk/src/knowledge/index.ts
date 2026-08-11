/**
 * @nexora/plugin-sdk — knowledge.
 *
 * Knowledge contributions: how a plugin feeds the Knowledge Runtime
 * (AIR.md §9). The provider contract is the Agent SDK's
 * `KnowledgeProvider`/`KnowledgeSource` (re-exported, never redefined); the
 * contribution wraps them with plugin context.
 */

export type { KnowledgeProvider, KnowledgeSource } from '@nexora/agent-sdk/knowledge';

import type { KnowledgeProvider, KnowledgeSource } from '@nexora/agent-sdk/knowledge';
import type { PluginId } from '../types/index.js';

/** A knowledge contribution: registers a provider and its sources. */
export interface KnowledgeContribution {
  /** Contribution kind discriminant. */
  kind: 'knowledge';
  /** The knowledge provider (AIR.md §9.2). */
  provider: KnowledgeProvider;
  /** The knowledge sources the provider serves. */
  sources: readonly KnowledgeSource[];
  /** Owning plugin id. */
  pluginId?: PluginId;
}
