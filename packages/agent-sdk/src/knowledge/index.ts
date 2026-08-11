/**
 * @nexora/agent-sdk — knowledge.
 *
 * Knowledge retrieval contracts (AIR.md §9): sources, references, citations,
 * and the provider interface. Retrieval is permission-scoped — the provider
 * enforces workspace isolation and permission filtering (AIR.md §9.3).
 */

/** A knowledge source: where knowledge items live. */
export interface KnowledgeSource {
  /** Source id. */
  id: string;
  /** Source kind, e.g. `documents`, `knowledge_base`, `app.records`. */
  kind: string;
  /** Source name. */
  name: string;
}

/** A reference to a knowledge item. */
export interface KnowledgeReference {
  /** Knowledge item id. */
  itemId: string;
  /** The source the item belongs to. */
  source: KnowledgeSource;
  /** A short snippet for citation. */
  snippet: string;
}

/** A citation attached to a retrieval result. */
export interface Citation {
  /** Knowledge item id. */
  itemId: string;
  /** Source id. */
  sourceId: string;
  /** Snippet quoted as evidence. */
  snippet: string;
}

/** A knowledge retrieval request. */
export interface RetrievalRequest {
  /** The query text. */
  query: string;
  /** Knowledge scopes the caller is allowed to read (AIR.md §9.3). */
  allowedScopes: readonly string[];
  /** Tenant scope of the retrieval. */
  tenantId: string;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: string;
  /** Maximum number of results. */
  limit?: number;
}

/** A knowledge retrieval result. */
export interface RetrievalResult {
  /** Retrieved references, most relevant first. */
  references: readonly KnowledgeReference[];
  /** Citations for the retrieved references. */
  citations: readonly Citation[];
  /** ISO-8601 UTC time the retrieval was served. */
  servedAt: string;
}

/**
 * The knowledge provider contract. Implementations enforce permission
 * filtering and workspace isolation; the SDK stays provider-agnostic.
 */
export interface KnowledgeProvider {
  /** The provider name, for observability. */
  readonly name: string;

  /**
   * Retrieves knowledge for a request, respecting the allowed scopes.
   */
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
}
