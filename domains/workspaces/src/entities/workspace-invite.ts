/**
 * @nexora/domain-workspaces — an invitation to join a team.
 *
 * A person joins an organization by opening a one-time link that someone
 * allowed to bring people in made for one seat in one team. The link carries
 * a secret; only its hash is stored, so reading the stored invitation never
 * lets anyone use it. An invitation is used once, can be taken back, and
 * stops working after a week.
 */

import type { TenantId } from '@nexora/contracts/common';

/** The seats an invitation can give. An executive's oversight seat is never invited. */
export const INVITE_SEATS = ['owner', 'admin', 'member'] as const;
export type InviteSeat = (typeof INVITE_SEATS)[number];

/** How long an invitation stays usable. */
export const INVITE_LIFETIME_DAYS = 7;

/** An invitation as stored. */
export interface WorkspaceInvite {
  id: string;
  organizationId: TenantId;
  /** The team the invitation is for. */
  workspaceId: string;
  seat: InviteSeat;
  /** The SHA-256 of the link's secret (hex). The secret itself is never stored. */
  tokenHash: string;
  /** Who the link is meant for, in the inviter's words ("Priya, new designer"). */
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
  usedAt?: string;
  revokedAt?: string;
}

export type InviteStatus = 'open' | 'used' | 'revoked' | 'expired';

/** Where an invitation stands at `now`. */
export function inviteStatus(
  invite: Pick<WorkspaceInvite, 'usedAt' | 'revokedAt' | 'expiresAt'>,
  now: string = new Date().toISOString(),
): InviteStatus {
  if (invite.usedAt !== undefined) return 'used';
  if (invite.revokedAt !== undefined) return 'revoked';
  return invite.expiresAt <= now ? 'expired' : 'open';
}

/** When an invitation made at `createdAt` stops working. */
export function inviteExpiry(createdAt: string): string {
  return new Date(
    new Date(createdAt).getTime() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** Persistence contract for invitations. */
export interface WorkspaceInviteRepository {
  insert(invite: WorkspaceInvite): Promise<void>;
  findById(id: string): Promise<WorkspaceInvite | undefined>;
  findByTokenHash(tokenHash: string): Promise<WorkspaceInvite | undefined>;
  /** The invitations of an organization, newest first. */
  listByOrganization(organizationId: TenantId): Promise<readonly WorkspaceInvite[]>;
  /**
   * Marks an invitation used, only while it is still unused and not taken
   * back. Returns whether this call was the one that used it.
   */
  markUsed(id: string, userId: string, at: string): Promise<boolean>;
  /** Takes an unused invitation back. Returns whether anything changed. */
  revoke(id: string, at: string): Promise<boolean>;
}
