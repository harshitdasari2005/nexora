/**
 * @nexora/app-api — SearchDocumentsTool.
 *
 * The documents-only retrieval capability exposed to the Nexora MCP server
 * (MCP adapter). It searches the DOCUMENT references of the caller's
 * workspace through the Knowledge **application layer** (permission-filtered
 * retrieval) and returns only `document`-kind references — the same
 * authorization path as `knowledge.search`, narrowed to documents.
 *
 * Security contract (same model as every tool):
 * - Input accepts ONLY the user's search question — `additionalProperties:
 *   false`. The tenant and workspace come exclusively from the trusted
 *   execution context; the model cannot widen retrieval scope.
 * - Retrieval is permission-filtered BEFORE any content is presented, and
 *   the workspace scope is mandatory (fails closed without one).
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { RetrieveKnowledgeHandler } from '@nexora/application-knowledge';
import type { KnowledgeReferenceDto } from '@nexora/application-knowledge';

/** Input contract: ONLY the user's question. */
export interface SearchDocumentsInput {
  /** The user's search question (the retrieval query). */
  question: string;
}

/** Output contract of {@link SearchDocumentsTool}. */
export interface SearchDocumentsOutput {
  /** The authorized document references (most relevant first, bounded). */
  documents: readonly KnowledgeReferenceDto[];
  /** True when at least one authorized document matched. */
  found: boolean;
}

/** The tool manifest (read-only, idempotent). */
export const SEARCH_DOCUMENTS_MANIFEST: ToolManifest = {
  id: 'documents.search',
  name: 'Search Documents',
  description:
    'Searches the documents available to the current user in the current workspace and returns grounded references with citations',
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
 * The read tool that performs permission-filtered document retrieval through
 * the Knowledge application layer under the trusted execution context,
 * returning only document-kind references.
 */
export class SearchDocumentsTool implements Tool<SearchDocumentsInput, SearchDocumentsOutput> {
  readonly manifest = SEARCH_DOCUMENTS_MANIFEST;

  readonly #retrieveKnowledge: RetrieveKnowledgeHandler;

  constructor(retrieveKnowledge: RetrieveKnowledgeHandler) {
    this.#retrieveKnowledge = retrieveKnowledge;
  }

  async execute(
    input: SearchDocumentsInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<SearchDocumentsOutput>> {
    const question = typeof input?.question === 'string' ? input.question.trim() : '';
    if (question.length === 0) {
      return this.#failure('A question is required to search documents');
    }
    if (question.length > QUESTION_MAX_LENGTH) {
      return this.#failure(`Question must be at most ${QUESTION_MAX_LENGTH} characters`);
    }
    // Workspace scope is mandatory: document retrieval is workspace-scoped.
    // Without a trusted workspace context the tool fails closed.
    const workspaceId = context.workspaceId;
    if (workspaceId === undefined) {
      return this.#failure(
        'Document search requires an active workspace — no workspace is selected',
      );
    }

    // Tenant + workspace come from the trusted execution context only.
    const result = await this.#retrieveKnowledge.handle({
      tenantId: context.tenantId as TenantId,
      workspaceId: workspaceId as WorkspaceId,
      query: question,
    });
    if (!result.ok) {
      return this.#failure('Could not search documents');
    }

    const documents = result.value.references.filter((reference) => reference.kind === 'document');
    return {
      ok: true,
      output: { documents, found: documents.length > 0 },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<SearchDocumentsOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}
