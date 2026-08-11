/**
 * @nexora/persistence — calendar-entry repository.
 *
 * Drizzle implementation of the Calendar bounded context repository port
 * (`CalendarEntryRepository`). Aggregates are serialized via `snapshot()`
 * and reconstructed via `hydrate()` (PERSISTENCE.md §4 aggregate ownership);
 * the hydrated aggregate RESTORES the persisted id (never regenerates one).
 *
 * Every read is organization + workspace scoped in SQL FIRST
 * (defense-in-depth): a calendar-entry id alone grants nothing, and a
 * foreign or cross-workspace entry resolves to NOT FOUND — never to another
 * workspace's entry.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import {
  CalendarEntry,
  type CalendarEntryId,
  type CalendarEntryRepository,
} from '@nexora/module-calendar';

import type { NexoraDatabase } from '../db.js';
import { calendarEvents } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type CalendarEntryRow = typeof calendarEvents.$inferSelect;

/** Maps a calendar_events row to a {@link CalendarEntry} snapshot. */
function rowToCalendarEntrySnapshot(
  row: CalendarEntryRow,
): ReturnType<typeof CalendarEntry.snapshot> {
  return {
    id: row.id as CalendarEntryId,
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    createdBy: row.createdBy as UserId,
    title: row.title,
    startsAt: toIso(row.startsAt),
    endsAt: toIso(row.endsAt),
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps a {@link CalendarEntry} snapshot to a calendar_events row. */
function calendarEntrySnapshotToRow(
  snapshot: ReturnType<typeof CalendarEntry.snapshot>,
): CalendarEntryRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    createdBy: snapshot.createdBy,
    title: snapshot.title,
    startsAt: toDate(snapshot.startsAt),
    endsAt: toDate(snapshot.endsAt),
    status: snapshot.status,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** The PostgreSQL {@link CalendarEntryRepository} implementation. */
export class PgCalendarEventRepository implements CalendarEntryRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<CalendarEntry | undefined> {
    const rows = await this.#db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : CalendarEntry.hydrate(rowToCalendarEntrySnapshot(row));
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly CalendarEntry[]> {
    const rows = await this.#db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.organizationId, organizationId),
          eq(calendarEvents.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(calendarEvents.startsAt), desc(calendarEvents.id));
    return rows.map((row) => CalendarEntry.hydrate(rowToCalendarEntrySnapshot(row)));
  }

  async save(entry: CalendarEntry): Promise<void> {
    const row = calendarEntrySnapshotToRow(CalendarEntry.snapshot(entry));
    await this.#db
      .insert(calendarEvents)
      .values(row)
      .onConflictDoUpdate({ target: calendarEvents.id, set: row });
  }
}
