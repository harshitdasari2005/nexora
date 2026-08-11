/**
 * @nexora/module-calendar — repository interfaces.
 *
 * The persistence ports of the Calendar bounded context (BACKEND.md §2
 * dependency direction; PERSISTENCE.md §4 aggregate ownership). The domain
 * depends on these interfaces; the infrastructure layer (PostgreSQL/Drizzle)
 * implements them. No ORM, no SQL, no persistence here.
 *
 * Every read is scope-bound: the workspace is always part of the query, so
 * a calendar-entry id alone grants nothing (a foreign or cross-workspace id
 * resolves to NOT FOUND — never to another workspace's entry).
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { CalendarEntry } from '../entities/calendar-entry.js';
import type { CalendarEntryId } from '../value-objects/calendar-entry-id.js';

/**
 * The persistence port of the {@link CalendarEntry} aggregate.
 */
export interface CalendarEntryRepository {
  /** Loads an entry by id, or `undefined` when it does not exist. */
  findById(id: CalendarEntryId): Promise<CalendarEntry | undefined>;

  /**
   * Lists the entries of a workspace, newest first (workspace-scoped read —
   * never cross-workspace).
   */
  listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly CalendarEntry[]>;

  /** Persists the aggregate (insert or update by id). */
  save(entry: CalendarEntry): Promise<void>;
}
