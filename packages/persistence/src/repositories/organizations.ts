/**
 * @nexora/persistence — organizations repositories.
 *
 * Drizzle implementations of the Organizations domain repository interfaces
 * (`OrganizationRepository`, `MembershipRepository`). Aggregates are
 * serialized via `snapshot()` and reconstructed via `hydrate()`
 * (PERSISTENCE.md §4).
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { MembershipRepository, OrganizationRepository } from '@nexora/domain-organizations';
import {
  Organization,
  OrganizationId,
  OrganizationMembership,
  OrganizationSlug,
  OrganizationType,
} from '@nexora/domain-organizations';
import type { UserId } from '@nexora/contracts/common';

import type { NexoraDatabase } from '../db.js';
import { organizationMemberships, organizations } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type OrganizationRow = typeof organizations.$inferSelect;
type MembershipRow = typeof organizationMemberships.$inferSelect;

/** Maps an organizations row to an {@link Organization} snapshot. */
function rowToOrganizationSnapshot(row: OrganizationRow): ReturnType<typeof Organization.snapshot> {
  return {
    id: OrganizationId.from(row.id),
    slug: OrganizationSlug.create(row.slug),
    type: OrganizationType.from(row.type),
    status: row.status,
    profile: row.profile as ReturnType<typeof Organization.snapshot>['profile'],
    settings: row.settings as ReturnType<typeof Organization.snapshot>['settings'],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps an {@link Organization} snapshot to an organizations row. */
function organizationSnapshotToRow(
  snapshot: ReturnType<typeof Organization.snapshot>,
): OrganizationRow {
  return {
    id: snapshot.id,
    slug: snapshot.slug.value,
    type: snapshot.type.value,
    status: snapshot.status,
    profile: snapshot.profile,
    settings: snapshot.settings,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link OrganizationRepository} implementation. */
export class PgOrganizationRepository implements OrganizationRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: OrganizationId): Promise<Organization | undefined> {
    const row = await this.#db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });
    return row === undefined ? undefined : Organization.hydrate(rowToOrganizationSnapshot(row));
  }

  async findBySlug(slug: OrganizationSlug): Promise<Organization | undefined> {
    const row = await this.#db.query.organizations.findFirst({
      where: eq(organizations.slug, slug.value),
    });
    return row === undefined ? undefined : Organization.hydrate(rowToOrganizationSnapshot(row));
  }

  async listByIds(ids: readonly OrganizationId[]): Promise<readonly Organization[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.#db.query.organizations.findMany({
      where: inArray(organizations.id, [...ids]),
      // Deterministic order: the read model (e.g. dashboard default org)
      // relies on the earliest-created organization being first.
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    return rows.map((row) => Organization.hydrate(rowToOrganizationSnapshot(row)));
  }

  async existsBySlug(slug: OrganizationSlug): Promise<boolean> {
    const row = await this.#db.query.organizations.findFirst({
      where: eq(organizations.slug, slug.value),
    });
    return row !== undefined;
  }

  async save(organization: Organization): Promise<void> {
    const row = organizationSnapshotToRow(Organization.snapshot(organization));
    await this.#db
      .insert(organizations)
      .values(row)
      .onConflictDoUpdate({ target: organizations.id, set: row });
  }
}

/** Maps a membership row to an {@link OrganizationMembership} snapshot. */
function rowToMembershipSnapshot(
  row: MembershipRow,
): ReturnType<typeof OrganizationMembership.snapshot> {
  return {
    id: row.id,
    organizationId: OrganizationId.from(row.organizationId),
    userId: row.userId as UserId,
    role: row.role as 'owner' | 'admin' | 'member',
    joinedAt: toIso(row.joinedAt),
    version: row.version,
  };
}

/** Maps an {@link OrganizationMembership} snapshot to a membership row. */
function membershipSnapshotToRow(
  snapshot: ReturnType<typeof OrganizationMembership.snapshot>,
): MembershipRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    userId: snapshot.userId,
    role: snapshot.role,
    joinedAt: toDate(snapshot.joinedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link MembershipRepository} implementation. */
export class PgMembershipRepository implements MembershipRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<OrganizationMembership | undefined> {
    const row = await this.#db.query.organizationMemberships.findFirst({
      where: eq(organizationMemberships.id, id),
    });
    return row === undefined
      ? undefined
      : OrganizationMembership.hydrate(rowToMembershipSnapshot(row));
  }

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMembership | undefined> {
    const row = await this.#db.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
      ),
    });
    return row === undefined
      ? undefined
      : OrganizationMembership.hydrate(rowToMembershipSnapshot(row));
  }

  async listByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly OrganizationMembership[]> {
    const rows = await this.#db.query.organizationMemberships.findMany({
      where: eq(organizationMemberships.organizationId, organizationId),
    });
    return rows.map((row) => OrganizationMembership.hydrate(rowToMembershipSnapshot(row)));
  }

  async listByUser(userId: UserId): Promise<readonly OrganizationMembership[]> {
    const rows = await this.#db.query.organizationMemberships.findMany({
      where: eq(organizationMemberships.userId, userId),
    });
    return rows.map((row) => OrganizationMembership.hydrate(rowToMembershipSnapshot(row)));
  }

  async countOwners(organizationId: OrganizationId): Promise<number> {
    const rows = await this.#db.query.organizationMemberships.findMany({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, 'owner'),
      ),
    });
    return rows.length;
  }

  async save(membership: OrganizationMembership): Promise<void> {
    const row = membershipSnapshotToRow(OrganizationMembership.snapshot(membership));
    await this.#db
      .insert(organizationMemberships)
      .values(row)
      .onConflictDoUpdate({ target: organizationMemberships.id, set: row });
  }

  async remove(membership: OrganizationMembership): Promise<void> {
    await this.#db
      .delete(organizationMemberships)
      .where(eq(organizationMemberships.id, membership.id));
  }
}
