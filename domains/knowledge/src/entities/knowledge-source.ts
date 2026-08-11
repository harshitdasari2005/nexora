/**
 * @nexora/domain-knowledge — KnowledgeSource aggregate.
 *
 * The indexed source of the Knowledge bounded context (DOMAIN_MODEL.md §14
 * Knowledge: KnowledgeIndexEntry / ContentSource). One {@link KnowledgeSource}
 * is the searchable projection of a document's latest content version —
 * owned by exactly one tenant + workspace (immutable scope). Re-indexing a
 * document version REPLACES the source (id reused), so stale index entries
 * never answer a later query.
 *
 * The source carries normalized searchable text (never raw file bytes) and
 * the display title used for citations. It is pure domain state — the
 * permission-filtered retrieval behavior lives in the Search platform port
 * (BR-7: the caller's trusted tenant + workspace are the only scope).
 */

import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import { InvalidKnowledgeValueError } from '../errors/index.js';
import type { KnowledgeSourceId } from '../value-objects/knowledge-source-id.js';
import { KnowledgeSourceId as KnowledgeSourceIdFactory } from '../value-objects/knowledge-source-id.js';

/** The maximum title length (mirrors the document title). */
export const KNOWLEDGE_TITLE_MAX_LENGTH = 200;
/** The maximum indexed text length (safety bound). */
export const KNOWLEDGE_TEXT_MAX_LENGTH = 200_000;

/** Input for creating a new {@link KnowledgeSource}. */
export interface CreateKnowledgeSourceInput {
  /** The owning organization (tenant) id — immutable scope. */
  tenantId: TenantId;
  /** The owning workspace id — immutable scope. */
  workspaceId: WorkspaceId;
  /** The owning document id (the source of the content). */
  documentId: string;
  /** The display title (used for citations). */
  title: string;
  /** The normalized searchable text. */
  text: string;
  /** The indexed content version of the source document. */
  version: number;
}

/** A persistence snapshot of the {@link KnowledgeSource}. */
export interface KnowledgeSourceSnapshot {
  /** The source id. */
  id: KnowledgeSourceId;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The owning document id. */
  documentId: string;
  /** The display title. */
  title: string;
  /** The normalized searchable text. */
  text: string;
  /** The indexed content version. */
  version: number;
  /** ISO-8601 UTC index time. */
  indexedAt: string;
}

/**
 * The {@link KnowledgeSource} aggregate root.
 */
export class KnowledgeSource {
  #id: KnowledgeSourceId;
  readonly #tenantId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #documentId: string;
  readonly #title: string;
  readonly #text: string;
  readonly #version: number;
  readonly #indexedAt: string;

  private constructor(input: CreateKnowledgeSourceInput, indexedAt: string) {
    this.#id = KnowledgeSourceIdFactory.create();
    this.#tenantId = input.tenantId;
    this.#workspaceId = input.workspaceId;
    this.#documentId = input.documentId;
    this.#title = input.title.trim();
    this.#text = input.text.trim();
    this.#version = input.version;
    this.#indexedAt = indexedAt;
    validateKnowledgeSource(this);
  }

  /**
   * Creates a new {@link KnowledgeSource} for a document version.
   */
  static create(input: CreateKnowledgeSourceInput, now = nowIso()): KnowledgeSource {
    return new KnowledgeSource(input, now);
  }

  /** The source id. */
  get id(): KnowledgeSourceId {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable scope. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** The owning workspace id — immutable scope. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The owning document id. */
  get documentId(): string {
    return this.#documentId;
  }

  /** The display title (used for citations). */
  get title(): string {
    return this.#title;
  }

  /** The normalized searchable text. */
  get text(): string {
    return this.#text;
  }

  /** The indexed content version. */
  get version(): number {
    return this.#version;
  }

  /** ISO-8601 UTC index time. */
  get indexedAt(): string {
    return this.#indexedAt;
  }

  /** Produces a persistence snapshot (PERSISTENCE.md §4). */
  static snapshot(source: KnowledgeSource): KnowledgeSourceSnapshot {
    return {
      id: source.id,
      tenantId: source.tenantId,
      workspaceId: source.workspaceId,
      documentId: source.documentId,
      title: source.title,
      text: source.text,
      version: source.version,
      indexedAt: source.indexedAt,
    };
  }

  /** Reconstructs a {@link KnowledgeSource} from a snapshot (no events). */
  static hydrate(snapshot: KnowledgeSourceSnapshot): KnowledgeSource {
    const source = new KnowledgeSource(
      {
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        documentId: snapshot.documentId,
        title: snapshot.title,
        text: snapshot.text,
        version: snapshot.version,
      },
      snapshot.indexedAt,
    );
    source.#id = snapshot.id;
    return source;
  }
}

/** Validates a {@link KnowledgeSource} (title + text bounds). */
function validateKnowledgeSource(source: KnowledgeSource): void {
  const issues: { path: string; message: string }[] = [];
  if (source.title.length === 0) {
    issues.push({ path: 'title', message: 'A title is required' });
  } else if (source.title.length > KNOWLEDGE_TITLE_MAX_LENGTH) {
    issues.push({
      path: 'title',
      message: `Title must be at most ${KNOWLEDGE_TITLE_MAX_LENGTH} characters`,
    });
  }
  if (source.text.length === 0) {
    issues.push({ path: 'text', message: 'Indexed text must not be empty' });
  } else if (source.text.length > KNOWLEDGE_TEXT_MAX_LENGTH) {
    issues.push({
      path: 'text',
      message: `Indexed text must be at most ${KNOWLEDGE_TEXT_MAX_LENGTH} characters`,
    });
  }
  if (source.documentId.trim().length === 0) {
    issues.push({ path: 'documentId', message: 'A source document is required' });
  }
  if (issues.length > 0) {
    throw new InvalidKnowledgeValueError('Invalid knowledge source', issues);
  }
}
