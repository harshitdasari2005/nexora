/**
 * @nexora/application-knowledge — knowledge reference DTO.
 *
 * The retrieval result (DOMAIN_MODEL.md §14 Knowledge retrieval): a citation
 * to an AUTHORIZED source plus a bounded snippet of the matching content.
 * Citations only ever reference sources the caller's trusted tenant +
 * workspace can access — the permission filter runs BEFORE any content
 * reaches the model.
 */

/** A retrieval citation to an authorized source. */
export interface KnowledgeReferenceDto {
  /** The indexed source id (the document or article id). */
  sourceId: string;
  /** The scope id (the document id or article id — for deep links). */
  documentId: string;
  /** The corpus member kind (`document` | `article`). */
  kind: string;
  /** The cited content version (document revision or article contentVersion). */
  version: number;
  /** The display title (the citation label). */
  title: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** A bounded snippet around the first match (safe display text). */
  snippet: string;
}

/** A grounded retrieval result. */
export interface RetrieveKnowledgeResult {
  /** The authorized references, most relevant first (bounded). */
  references: readonly KnowledgeReferenceDto[];
}

/** The maximum snippet length returned to callers. */
export const KNOWLEDGE_SNIPPET_MAX_LENGTH = 240;

/**
 * Builds a bounded snippet around the first query-token match in the text
 * (deterministic; falls back to a prefix when nothing matches).
 */
export function buildSnippet(
  text: string,
  query: string,
  max = KNOWLEDGE_SNIPPET_MAX_LENGTH,
): string {
  const needle = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0)[0];
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (needle === undefined) {
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
  }
  const index = normalized.toLowerCase().indexOf(needle);
  if (index === -1) {
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
  }
  const start = Math.max(0, index - Math.floor(max / 3));
  const slice = normalized.slice(start, start + max);
  const prefix = start > 0 ? '…' : '';
  const suffix = start + max < normalized.length ? '…' : '';
  return `${prefix}${slice}${suffix}`;
}
