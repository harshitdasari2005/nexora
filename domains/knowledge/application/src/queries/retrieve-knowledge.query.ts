/**
 * @nexora/application-knowledge — RetrieveKnowledge query.
 *
 * The permission-filtered retrieval use case (DOMAIN_MODEL.md BR-7): the
 * caller's trusted tenant + workspace are the ONLY retrieval scope. The
 * model supplies the search QUESTION at most — never the scope.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** The maximum number of references returned. */
export const KNOWLEDGE_RETRIEVAL_LIMIT_DEFAULT = 5;
/** The hard ceiling on references per retrieval. */
export const KNOWLEDGE_RETRIEVAL_LIMIT_MAX = 10;

/** Retrieves authorized knowledge references for a question. */
export interface RetrieveKnowledgeQuery {
  /** The trusted tenant id (authenticated context). */
  tenantId: TenantId;
  /** The trusted workspace id (authenticated context). */
  workspaceId: WorkspaceId;
  /** The user's search question. */
  query: string;
  /** Max references (default 5, clamped to 10). */
  limit?: number;
}
