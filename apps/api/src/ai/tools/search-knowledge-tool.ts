/**
 * @nexora/app-api — SearchKnowledgeTool.
 *
 * The Knowledge read capability exposed to the Enterprise AI Runtime: the
 * permission-filtered retrieval use case (DOMAIN_MODEL.md BR-7). The tool
 * delegates to the Knowledge **application layer**, which applies the scope
 * filter (trusted tenant + workspace) in the search index FIRST — only
 * authorized references ever reach the caller, and therefore the model.
 *
 * Security contract (same model as every other tool):
 * - Input accepts ONLY the user's search question — `additionalProperties:
 *   false`. The tenant and workspace come exclusively from the trusted
 *   execution context; the model cannot widen retrieval scope, and a
 *   poisoned document or an injection prompt cannot change it either.
 * - The model is never the authorization boundary: retrieval is
 *   permission-filtered BEFORE any content is presented.
 * - The workspace-scoped answer requires a workspace context; without one
 *   the tool fails closed (no cross-workspace fallback).
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { RetrieveKnowledgeHandler } from '@nexora/application-knowledge';
import type { KnowledgeReferenceDto } from '@nexora/application-knowledge';

/** Input contract: ONLY the user's question. */
export interface SearchKnowledgeInput {
  /** The user's question (the retrieval query). */
  question: string;
}

/** Output contract of {@link SearchKnowledgeTool}. */
export interface SearchKnowledgeOutput {
  /** The authorized references (most relevant first, bounded). */
  references: readonly KnowledgeReferenceDto[];
  /** True when at least one authorized reference matched. */
  found: boolean;
}

/** The tool manifest (read-only, idempotent). */
export const SEARCH_KNOWLEDGE_MANIFEST: ToolManifest = {
  id: 'knowledge.search',
  name: 'Search workspace knowledge',
  description:
    'Searches the documents and published knowledge base articles available to the current user in the current workspace and returns grounded references with citations',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 15_000,
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    required: ['question'],
    additionalProperties: false,
  },
};

/** The maximum question length (mirrors the application validator). */
const QUESTION_MAX_LENGTH = 1000;

/**
 * The read tool that performs permission-filtered knowledge retrieval
 * through the Knowledge application layer under the trusted execution
 * context.
 */
export class SearchKnowledgeTool implements Tool<SearchKnowledgeInput, SearchKnowledgeOutput> {
  readonly manifest = SEARCH_KNOWLEDGE_MANIFEST;

  readonly #retrieveKnowledge: RetrieveKnowledgeHandler;

  constructor(retrieveKnowledge: RetrieveKnowledgeHandler) {
    this.#retrieveKnowledge = retrieveKnowledge;
  }

  async execute(
    input: SearchKnowledgeInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<SearchKnowledgeOutput>> {
    const question = typeof input?.question === 'string' ? input.question.trim() : '';
    if (question.length === 0) {
      return this.#failure('A question is required to search knowledge');
    }
    if (question.length > QUESTION_MAX_LENGTH) {
      return this.#failure(`Question must be at most ${QUESTION_MAX_LENGTH} characters`);
    }
    // Workspace scope is mandatory: knowledge retrieval is workspace-scoped.
    // Without a trusted workspace context the tool fails closed — there is
    // no cross-workspace fallback.
    const workspaceId = context.workspaceId;
    if (workspaceId === undefined) {
      return this.#failure(
        'Knowledge search requires an active workspace — no workspace is selected',
      );
    }

    // Tenant + workspace come from the trusted execution context only.
    const result = await this.#retrieveKnowledge.handle({
      tenantId: context.tenantId as TenantId,
      workspaceId: workspaceId as WorkspaceId,
      query: question,
    });
    if (!result.ok) {
      return this.#failure('Could not search knowledge');
    }

    const references = result.value.references;
    return {
      ok: true,
      output: {
        references,
        found: references.length > 0,
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<SearchKnowledgeOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}
