/**
 * CalendarEntryDomainService tests: creation, reschedule, cancel, and
 * workspace-scoped listing against an in-memory repository.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import {
  CalendarEntry,
  CalendarEntryDomainService,
  CalendarEntryId,
  CalendarEntryNotFoundError,
  type CalendarEntryRepository,
} from '../src/index.js';
import { TENANT, WORKSPACE, USER, futureWindow, userContext } from './helpers.js';

/** An in-memory {@link CalendarEntryRepository}. */
class MemoryCalendarEntryRepository implements CalendarEntryRepository {
  readonly entries = new Map<string, CalendarEntry>();

  async findById(id: CalendarEntryId): Promise<CalendarEntry | undefined> {
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

function makeService(repository = new MemoryCalendarEntryRepository()): {
  service: CalendarEntryDomainService;
  repository: MemoryCalendarEntryRepository;
} {
  return { service: new CalendarEntryDomainService({ entries: repository }), repository };
}

describe('CalendarEntryDomainService.create', () => {
  it('creates and persists a scheduled entry, publishing its created event', async () => {
    const { service, repository } = makeService();
    const result = await service.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        title: 'Project Review',
        ...futureWindow(),
      },
      userContext(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entry.status.value).toBe('scheduled');
    expect(repository.entries.size).toBe(1);
    expect(result.value.events.map((event) => event.type)).toEqual(['calendar.event.created']);
  });

  it('returns a validation error for an invalid title (no mutation)', async () => {
    const { service, repository } = makeService();
    const result = await service.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        title: '   ',
        ...futureWindow(),
      },
      userContext(),
    );
    expect(result.ok).toBe(false);
    expect(repository.entries.size).toBe(0);
  });
});

describe('CalendarEntryDomainService.reschedule', () => {
  it('reschedules an entry and records the updated event', async () => {
    const { service, repository } = makeService();
    const created = await service.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        title: 'Project Review',
        ...futureWindow(),
      },
      userContext(),
    );
    if (!created.ok) {
      throw new Error('expected create to succeed');
    }
    const entryId = created.value.entry.id;

    const result = await service.reschedule(
      entryId,
      {
        title: 'Mobile Banking Review',
        startsAt: '2026-09-02T10:00:00.000Z',
        endsAt: '2026-09-02T11:00:00.000Z',
      },
      userContext(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entry.title.value).toBe('Mobile Banking Review');
    expect(repository.entries.get(entryId)?.title.value).toBe('Mobile Banking Review');
    expect(result.value.events.map((event) => event.type)).toEqual(['calendar.event.updated']);
  });

  it('returns NOT FOUND for an unknown entry id', async () => {
    const { service } = makeService();
    const result = await service.reschedule(
      CalendarEntryId.from('cal_00000000-0000-4000-8000-000000000000'),
      {
        title: 'Late',
        startsAt: '2026-09-02T10:00:00.000Z',
        endsAt: '2026-09-02T11:00:00.000Z',
      },
      userContext(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBeInstanceOf(CalendarEntryNotFoundError);
  });
});

describe('CalendarEntryDomainService.cancel', () => {
  it('cancels an entry and records the cancelled event', async () => {
    const { service, repository } = makeService();
    const created = await service.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        title: 'Project Review',
        ...futureWindow(),
      },
      userContext(),
    );
    if (!created.ok) {
      throw new Error('expected create to succeed');
    }
    const entryId = created.value.entry.id;

    const result = await service.cancel(entryId, userContext());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entry.status.value).toBe('cancelled');
    expect(repository.entries.get(entryId)?.status.value).toBe('cancelled');
    expect(result.value.events.map((event) => event.type)).toEqual(['calendar.event.cancelled']);
  });
});

describe('CalendarEntryDomainService reads', () => {
  it('lists only the entries of the requested workspace (scope-bound)', async () => {
    const { service, repository } = makeService();
    const otherWorkspace = 'ws_marketing' as WorkspaceId;
    await service.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        title: 'Engineering Review',
        ...futureWindow(),
      },
      userContext(),
    );
    await service.create(
      {
        organizationId: TENANT,
        workspaceId: otherWorkspace,
        createdBy: USER as UserId,
        title: 'Marketing Review',
        ...futureWindow(),
      },
      userContext('usr_alex', TENANT, otherWorkspace),
    );

    const engineering = await service.listByWorkspace(TENANT, WORKSPACE);
    expect(engineering.ok).toBe(true);
    if (!engineering.ok) {
      return;
    }
    expect(engineering.value.map((entry) => entry.title.value)).toEqual(['Engineering Review']);
    expect(repository.entries.size).toBe(2);
  });

  it('finds an entry by id, or NOT FOUND', async () => {
    const { service } = makeService();
    const created = await service.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        title: 'Project Review',
        ...futureWindow(),
      },
      userContext(),
    );
    if (!created.ok) {
      throw new Error('expected create to succeed');
    }
    const found = await service.findById(created.value.entry.id);
    expect(found.ok).toBe(true);

    const missing = await service.findById(
      CalendarEntryId.from('cal_00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.ok).toBe(false);
  });
});
