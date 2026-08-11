/**
 * @nexora/app-api — durable conversation store.
 *
 * The AI Runtime's {@link ConversationStore} port backed by PostgreSQL. The
 * store lives in the application container (not @nexora/persistence) because
 * the port is owned by the AI Runtime: persistence stays domain-side, the
 * composition root adapts it (BACKEND.md §2 dependency direction).
 *
 * Conversations are stored one row per aggregate; turns are a JSONB array
 * written atomically with the root (PERSISTENCE.md §2.2 document classes).
 */

import { eq } from 'drizzle-orm';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { NexoraDatabase } from '@nexora/persistence';
import { conversations } from '@nexora/persistence';
import type {
  Conversation,
  ConversationStore,
  ConversationTurn,
} from '@nexora/ai-runtime/conversation';

/** A {@link ConversationStore} persisted in PostgreSQL. */
export class PgConversationStore implements ConversationStore {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async load(conversationId: string): Promise<Conversation | undefined> {
    const row = await this.#db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      tenantId: row.tenantId as TenantId,
      userId: row.userId,
      workspaceId: (row.workspaceId ?? undefined) as WorkspaceId | undefined,
      turns: (row.turns as ConversationTurn[] | null) ?? [],
      createdAt: row.createdAt.toISOString(),
    };
  }

  async save(conversation: Conversation): Promise<void> {
    await this.#db.insert(conversations).values({
      id: conversation.id,
      tenantId: conversation.tenantId,
      userId: conversation.userId,
      workspaceId: conversation.workspaceId ?? null,
      turns: [...conversation.turns],
      createdAt: new Date(conversation.createdAt),
      updatedAt: new Date(),
    });
  }

  async appendTurn(conversationId: string, turn: ConversationTurn): Promise<void> {
    const existing = await this.load(conversationId);
    if (existing === undefined) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    await this.#db
      .update(conversations)
      .set({
        turns: [...existing.turns, turn],
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  }
}
