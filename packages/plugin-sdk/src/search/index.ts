/**
 * @nexora/plugin-sdk — search.
 *
 * Search contributions: how a plugin participates in global search
 * (FRONTEND.md §9, SAD.md §5.7). Search is a projection concern — plugins
 * provide indexers and result providers, the Search Platform aggregates.
 */

import type { PluginId } from '../types/index.js';

/** A search index: a document collection a plugin owns. */
export interface SearchIndex {
  /** Index id, e.g. `com.nexora.projects.tasks`. */
  id: string;
  /** Index name shown in search result headers. */
  name: string;
  /** Document fields available for search. */
  fields: readonly string[];
  /** Whether the index is tenant-scoped (always true in Nexora). */
  tenantScoped: true;
}

/** A search result entry. */
export interface SearchResult {
  /** Index id the result belongs to. */
  indexId: string;
  /** Document id. */
  documentId: string;
  /** Result title. */
  title: string;
  /** Snippet with matched terms highlighted. */
  snippet: string;
  /** Route the result navigates to. */
  route: string;
  /** Relevance score, 0..1. */
  score: number;
}

/** A search provider: executes a query against one or more indexes. */
export interface SearchProvider {
  /** The provider name, for observability. */
  readonly name: string;
  /** The indexes this provider serves. */
  readonly indexes: readonly SearchIndex[];
  /** Searches the provider's indexes. */
  search(query: string, context: SearchContext): Promise<SearchResult[]>;
}

/** The context of a search request. */
export interface SearchContext {
  /** Tenant scope. */
  tenantId: string;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: string;
  /** The searching user id (permission filtering). */
  userId: string;
  /** Maximum results to return. */
  limit: number;
}

/** A search contribution: registers the provider with the Search Platform. */
export interface SearchContribution {
  /** Contribution kind discriminant. */
  kind: 'search';
  /** The search provider. */
  provider: SearchProvider;
  /** Owning plugin id. */
  pluginId?: PluginId;
}
