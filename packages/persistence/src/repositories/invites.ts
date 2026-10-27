/**
 * @nexora/persistence — team invitations.
 *
 * Drizzle implementation of `WorkspaceInviteRepository`. Using and taking
 * back an invitation are conditional updates: of two people opening the same
 * link at once, exactly one gets the seat.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { TenantId } from '@nexora/contracts/common';
import type { WorkspaceInvite, WorkspaceInviteRepository } from '@nexora/domain-workspaces';

import type { NexoraDatabase } from '../db.js';
import { workspaceInvites } from '../schema/index.js';

type InviteRow = typeof workspaceInvites.$inferSelect;

function toInvite(row: InviteRow): WorkspaceInvite {
  return {
    id: row.id,
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId,
    seat: row.seat as WorkspaceInvite['seat'],
    tokenHash: row.tokenHash,
    label: row.label,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    ...(row.usedBy === null ? {} : { usedBy: row.usedBy }),
    ...(row.usedAt === null ? {} : { usedAt: row.usedAt.toISOString() }),
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt.toISOString() }),
  };
}

/** Drizzle {@link WorkspaceInviteRepository} implementation. */
export class PgWorkspaceInviteRepository implements WorkspaceInviteRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async insert(invite: WorkspaceInvite): Promise<void> {
    await this.#db.insert(workspaceInvites).values({
      id: invite.id,
      organizationId: invite.organizationId,
      workspaceId: invite.workspaceId,
      seat: invite.seat,
      tokenHash: invite.tokenHash,
      label: invite.label,
      createdBy: invite.createdBy,
      createdAt: new Date(invite.createdAt),
      expiresAt: new Date(invite.expiresAt),
    });
  }

  async findById(id: string): Promise<WorkspaceInvite | undefined> {
    const rows = await this.#db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toInvite(rows[0]);
  }

  async findByTokenHash(tokenHash: string): Promise<WorkspaceInvite | undefined> {
    const rows = await this.#db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.tokenHash, tokenHash))
      .limit(1);
    return rows[0] === undefined ? undefined : toInvite(rows[0]);
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly WorkspaceInvite[]> {
    const rows = await this.#db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.organizationId, organizationId))
      .orderBy(desc(workspaceInvites.createdAt), desc(workspaceInvites.id));
    return rows.map(toInvite);
  }

  async markUsed(id: string, userId: string, at: string): Promise<boolean> {
    const updated = await this.#db
      .update(workspaceInvites)
      .set({ usedBy: userId, usedAt: new Date(at) })
      .where(
        and(
          eq(workspaceInvites.id, id),
          isNull(workspaceInvites.usedAt),
          isNull(workspaceInvites.revokedAt),
        ),
      )
      .returning({ id: workspaceInvites.id });
    return updated.length === 1;
  }

  async revoke(id: string, at: string): Promise<boolean> {
    const updated = await this.#db
      .update(workspaceInvites)
      .set({ revokedAt: new Date(at) })
      .where(
        and(
          eq(workspaceInvites.id, id),
          isNull(workspaceInvites.usedAt),
          isNull(workspaceInvites.revokedAt),
        ),
      )
      .returning({ id: workspaceInvites.id });
    return updated.length === 1;
  }
}
