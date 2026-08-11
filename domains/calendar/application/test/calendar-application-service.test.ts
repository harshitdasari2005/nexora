/**
 * CalendarApplicationService tests: creation, update, cancel, scoped reads,
 * event publishing, and scope enforcement (foreign/cross-workspace ids
 * resolve to NOT FOUND — never to another workspace's entry).
 */

import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@nexora/shared/events';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import {
  type CalendarEntry,
  CalendarEntryDomainService,
  type CalendarEntryRepository,
} from '@nexora/module-calendar';

import { CalendarApplicationService } from '../src/services/calendar-application-service.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'ws_engineering' as WorkspaceId;
const OTHER_WORKSPACE = 'ws_marketing' as WorkspaceId;
const USER = 'usr_alex' as UserId;

/** An in-memory {@link CalendarEntryRepository}. */
class MemoryCalendarEntryRepository implements CalendarEntryRepository {
  readonly entries = new Map<string, CalendarEntry>();

  async findById(id: string): Promise<CalendarEntry | undefined> {
    return this.entries.get(id);
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly CalendarEntry[]> {
    return [...this.entries.values()]
      .filter(
        (entry) => entry.organizationId === organizationId && entry.workspaceId === workspaceId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(entry: CalendarEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }
}

/** A publisher that records published envelopes. */
class RecordingPublisher {
  readonly published: EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    this.published.push(...events);
  }
}

function setup(): {
  service: CalendarApplicationService;
  repository: MemoryCalendarEntryRepository;
  publisher: RecordingPublisher;
} {
  const repository = new MemoryCalendarEntryRepository();
  const publisher = new RecordingPublisher();
  const entriesService = new CalendarEntryDomainService({ entries: repository });
  const service = new CalendarApplicationService({ entriesService, publisher });
  return { service, repository, publisher };
}

function createCommand(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organizationId: TENANT,
    workspaceId: WORKSPACE,
    createdBy: USER,
    actorId: USER,
    correlationId: 'corr_1',
    title: 'Project Review',
    startsAt: '2026-09-01T15:00:00.000Z',
    endsAt: '2026-09-01T16:00:00.000Z',
    ...overrides,
  };
}

describe('CalendarApplicationService.createCalendarEvent', () => {
  it('creates a scheduled entry and publishes exactly one created event', async () => {
    const { service, repository, publisher } = setup();
    const result = await service.createCalendarEvent(
      createCommand() as Parameters<typeof service.createCalendarEvent>[0],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entry.status.value).toBe('scheduled');
    expect(repository.entries.size).toBe(1);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.type).toBe('calendar.event.created');
    // The workspace scope rides the envelope (notification scoping).
    expect(publisher.published[0]?.workspaceId).toBe(WORKSPACE);
  });

  it('rejects an invalid title with no mutation and no publication', async () => {
    const { service, repository, publisher } = setup();
    const result = await service.createCalendarEvent(
      createCommand({ title: '  ' }) as Parameters<typeof service.createCalendarEvent>[0],
    );
    expect(result.ok).toBe(false);
    expect(repository.entries.size).toBe(0);
    expect(publisher.published).toHaveLength(0);
  });

  it('rejects an invalid time window with no mutation', async () => {
    const { service, repository, publisher } = setup();
    const result = await service.createCalendarEvent(
      createCommand({ startsAt: '2026-09-01T16:00:00.000Z' }) as Parameters<
        typeof service.createCalendarEvent
      >[0],
    );
    expect(result.ok).toBe(false);
    expect(repository.entries.size).toBe(0);
    expect(publisher.published).toHaveLength(0);
  });
});

describe('CalendarApplicationService.updateCalendarEvent', () => {
  it('reschedules an entry and publishes exactly one updated event', async () => {
    const { service, publisher } = setup();
    const created = await service.createCalendarEvent(
      createCommand() as Parameters<typeof service.createCalendarEvent>[0],
    );
    if (!created.ok) {
      throw new Error('expected create to succeed');
    }
    const entryId = created.value.entry.id;

    const result = await service.updateCalendarEvent({
      calendarEntryId: entryId,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_2',
      title: 'Mobile Banking Review',
      startsAt: '2026-09-02T10:00:00.000Z',
      endsAt: '2026-09-02T11:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entry.title.value).toBe('Mobile Banking Review');
    expect(publisher.published.map((event) => event.type)).toEqual([
      'calendar.event.created',
      'calendar.event.updated',
    ]);
  });

  it('returns NOT FOUND for a foreign workspace entry id (no data leak)', async () => {
    const { service } = setup();
    // Create the entry in WORKSPACE but try to update it under OTHER_WORKSPACE.
    const created = await service.createCalendarEvent(
      createCommand() as Parameters<typeof service.createCalendarEvent>[0],
    );
    if (!created.ok) {
      throw new Error('expected create to succeed');
    }
    const entryId = created.value.entry.id;

    const result = await service.updateCalendarEvent({
      calendarEntryId: entryId,
      organizationId: TENANT,
      workspaceId: OTHER_WORKSPACE,
      actorId: USER,
      correlationId: 'corr_3',
      title: 'Hijacked',
      startsAt: '2026-09-02T10:00:00.000Z',
      endsAt: '2026-09-02T11:00:00.000Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns NOT FOUND for an unknown entry id', async () => {
    const { service } = setup();
    const result = await service.updateCalendarEvent({
      calendarEntryId: 'cal_00000000-0000-4000-8000-000000000000',
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_4',
      title: 'Late',
      startsAt: '2026-09-02T10:00:00.000Z',
      endsAt: '2026-09-02T11:00:00.000Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('CalendarApplicationService.cancelCalendarEvent', () => {
  it('cancels an entry and publishes exactly one cancelled event', async () => {
    const { service, publisher } = setup();
    const created = await service.createCalendarEvent(
      createCommand() as Parameters<typeof service.createCalendarEvent>[0],
    );
    if (!created.ok) {
      throw new Error('expected create to succeed');
    }
    const entryId = created.value.entry.id;

    const result = await service.cancelCalendarEvent({
      calendarEntryId: entryId,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_5',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entry.status.value).toBe('cancelled');
    expect(publisher.published.map((event) => event.type)).toEqual([
      'calendar.event.created',
      'calendar.event.cancelled',
    ]);
  });

  it('returns NOT FOUND for a foreign organization entry id', async () => {
    const { service } = setup();
    const created = await service.createCalendarEvent(
      createCommand() as Parameters<typeof service.createCalendarEvent>[0],
    );
    if (!created.ok) {
      throw new Error('expected create to succeed');
    }
    const entryId = created.value.entry.id;

    const result = await service.cancelCalendarEvent({
      calendarEntryId: entryId,
      organizationId: 'org_alien' as TenantId,
      workspaceId: WORKSPACE,
      actorId: USER,
      correlationId: 'corr_6',
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('CalendarApplicationService reads', () => {
  it('lists only the entries of the requested workspace', async () => {
    const { service } = setup();
    await service.createCalendarEvent(
      createCommand({ title: 'Engineering Review' }) as Parameters<
        typeof service.createCalendarEvent
      >[0],
    );
    await service.createCalendarEvent(
      createCommand({
        title: 'Marketing Review',
        workspaceId: OTHER_WORKSPACE,
      }) as Parameters<typeof service.createCalendarEvent>[0],
    );

    const engineering = await service.listCalendarEvents(TENANT, WORKSPACE);
    expect(engineering.ok).toBe(true);
    if (!engineering.ok) {
      return;
    }
    expect(engineering.value.map((entry) => entry.title)).toEqual(['Engineering Review']);
  });

  it('gets one entry within the trusted scope, or NOT FOUND cross-scope', async () => {
    const { service } = setup();
    const created = await service.createCalendarEvent(
      createCommand() as Parameters<typeof service.createCalendarEvent>[0],
    );
    if (!created.ok) {
      throw new Error('expected create to succeed');
    }
    const entryId = created.value.entry.id;

    const found = await service.getCalendarEvent(TENANT, WORKSPACE, entryId);
    expect(found.ok).toBe(true);
    if (!found.ok) {
      return;
    }
    expect(found.value.title).toBe('Project Review');

    const foreign = await service.getCalendarEvent(TENANT, OTHER_WORKSPACE, entryId);
    expect(foreign.ok).toBe(false);
    if (foreign.ok) {
      return;
    }
    expect(foreign.error.code).toBe('NOT_FOUND');
  });
});
