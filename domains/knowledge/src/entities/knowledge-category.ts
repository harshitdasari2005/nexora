/**
 * @nexora/domain-knowledge — KnowledgeCategory aggregate.
 *
 * A flat, workspace-scoped knowledge base category (S18 Knowledge Base).
 * Owned by exactly one tenant + one workspace (immutable scope); an article
 * references AT MOST ONE category. The S18 category model is intentionally
 * minimal: no nesting, no many-to-many, no hierarchy — those are deferred.
 *
 * Lifecycle: `active → archived` (archived is terminal in v1; archiving a
 * category does not archive its articles — the category reference simply
 * becomes optional).
 */

import { nowIso } from '@nexora/shared/time';
import type { EventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  categoryArchivedEvent,
  categoryCreatedEvent,
  type KnowledgeEventContext,
} from '../events/index.js';
import { InvalidKnowledgeValueError } from '../errors/index.js';
import type { KnowledgeCategoryId } from '../value-objects/knowledge-category-id.js';
import { KnowledgeCategoryId as KnowledgeCategoryIdFactory } from '../value-objects/knowledge-category-id.js';

/** The maximum category name length. */
export const KNOWLEDGE_CATEGORY_NAME_MAX_LENGTH = 100;

/** Input for creating a new {@link KnowledgeCategory}. */
export interface CreateKnowledgeCategoryInput {
  /** The owning organization (tenant) id — immutable scope. */
  tenantId: TenantId;
  /** The owning workspace id — immutable scope. */
  workspaceId: WorkspaceId;
  /** The category name (validated). */
  name: string;
}

/** A persistence snapshot of the {@link KnowledgeCategory}. */
export interface KnowledgeCategorySnapshot {
  /** The category id. */
  id: KnowledgeCategoryId;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The category name. */
  name: string;
  /** Whether the category is archived (terminal). */
  archived: boolean;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link KnowledgeCategory} aggregate root.
 */
export class KnowledgeCategory {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: KnowledgeCategoryId;
  readonly #tenantId: TenantId;
  readonly #workspaceId: WorkspaceId;
  #name: string;
  #archived: boolean;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateKnowledgeCategoryInput, createdAt: string) {
    this.#id = KnowledgeCategoryIdFactory.create();
    this.#tenantId = input.tenantId;
    this.#workspaceId = input.workspaceId;
    this.#name = normalizeName(input.name);
    this.#archived = false;
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link KnowledgeCategory} (`active`) and records a
   * {@link categoryCreatedEvent}.
   */
  static create(
    input: CreateKnowledgeCategoryInput,
    context: KnowledgeEventContext,
    now = nowIso(),
  ): KnowledgeCategory {
    const category = new KnowledgeCategory(input, now);
    category.#events.push(
      categoryCreatedEvent(context, {
        categoryId: category.#id,
        tenantId: category.#tenantId,
        workspaceId: category.#workspaceId,
        name: category.#name,
        status: 'active',
      }),
    );
    return category;
  }

  /** The category id. */
  get id(): KnowledgeCategoryId {
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

  /** The category name. */
  get name(): string {
    return this.#name;
  }

  /** Whether the category is archived (terminal). */
  get archived(): boolean {
    return this.#archived;
  }

  /** Whether the category is active (usable in the picker). */
  isActive(): boolean {
    return !this.#archived;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency. */
  get version(): number {
    return this.#version;
  }

  /**
   * Archives the category (`active` → `archived`, terminal). Existing
   * articles keep their reference; the category simply leaves the picker.
   * Records a {@link categoryArchivedEvent}.
   *
   * @throws {InvalidKnowledgeValueError} when the category is already archived.
   */
  archive(context: KnowledgeEventContext, now = nowIso()): void {
    if (this.#archived) {
      throw new InvalidKnowledgeValueError('Cannot archive an archived category', [
        { path: 'status', message: 'Category is already archived' },
      ]);
    }
    this.#archived = true;
    this.#bump(now);
    this.#events.push(
      categoryArchivedEvent(context, {
        categoryId: this.#id,
        tenantId: this.#tenantId,
        workspaceId: this.#workspaceId,
      }),
    );
  }

  /** Produces a persistence snapshot of the category. */
  static snapshot(category: KnowledgeCategory): KnowledgeCategorySnapshot {
    return {
      id: category.id,
      tenantId: category.tenantId,
      workspaceId: category.workspaceId,
      name: category.name,
      archived: category.archived,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      version: category.version,
    };
  }

  /** Reconstructs a {@link KnowledgeCategory} from a snapshot (no events). */
  static hydrate(snapshot: KnowledgeCategorySnapshot): KnowledgeCategory {
    const category = new KnowledgeCategory(
      {
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        name: snapshot.name,
      },
      snapshot.createdAt,
    );
    category.#id = snapshot.id;
    category.#archived = snapshot.archived;
    category.#updatedAt = snapshot.updatedAt;
    category.#version = snapshot.version;
    return category;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now: string): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}

/** Validates + normalizes the category name. */
function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new InvalidKnowledgeValueError('Invalid knowledge category name', [
      { path: 'name', message: 'A name is required' },
    ]);
  }
  if (trimmed.length > KNOWLEDGE_CATEGORY_NAME_MAX_LENGTH) {
    throw new InvalidKnowledgeValueError('Invalid knowledge category name', [
      {
        path: 'name',
        message: `Name must be at most ${KNOWLEDGE_CATEGORY_NAME_MAX_LENGTH} characters`,
      },
    ]);
  }
  return trimmed;
}
