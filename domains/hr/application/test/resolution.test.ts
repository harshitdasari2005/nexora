/**
 * Employee resolution tests: the deterministic, tenant-scoped name
 * resolution (FindEmployeeByName) and the by-id lookup (ListEmployeesByIds)
 * used by the AI assignment tooling. Resolution must be permission-aware —
 * it never sees records outside the trusted organization.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { CreateEmployeeCommand } from '@nexora/application-hr';

const ACTOR = 'usr_a' as UserId;

import { EmployeeApplicationService } from '../src/index.js';
import {
  domainService,
  FakeEmployeeRepository,
  RecordingEventPublisher,
  TENANT,
} from './helpers.js';

const ALIEN = 'org_alien' as TenantId;

function seeded() {
  const repository = new FakeEmployeeRepository();
  const app = new EmployeeApplicationService({
    employeesService: domainService(repository),
    publisher: new RecordingEventPublisher(),
  });
  return { app, repository };
}

async function seed(app: EmployeeApplicationService, command: CreateEmployeeCommand) {
  const result = await app.createEmployee(command);
  if (!result.ok) throw new Error('seed failed');
  return result.value.employee;
}

describe('FindEmployeeByName', () => {
  it('resolves exactly one employee with a case-insensitive substring match', async () => {
    const { app } = seeded();
    await seed(app, {
      organizationId: TENANT,
      name: 'Sarah Chen',
      actorId: ACTOR,
      correlationId: 'c1',
    });
    await seed(app, {
      organizationId: TENANT,
      name: 'Priya Patel',
      actorId: ACTOR,
      correlationId: 'c2',
    });

    const result = await app.findEmployeeByName(TENANT, 'sarah');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.name).toBe('Sarah Chen');
  });

  it('returns every candidate when the name is ambiguous (never guesses)', async () => {
    const { app } = seeded();
    await seed(app, {
      organizationId: TENANT,
      name: 'Sarah Chen',
      actorId: ACTOR,
      correlationId: 'c1',
    });
    await seed(app, {
      organizationId: TENANT,
      name: 'Sarah Kim',
      actorId: ACTOR,
      correlationId: 'c2',
    });

    const result = await app.findEmployeeByName(TENANT, 'Sarah');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it('returns no candidates when the employee does not exist', async () => {
    const { app } = seeded();
    const result = await app.findEmployeeByName(TENANT, 'Nobody');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('is tenant-scoped: a foreign organization never leaks into resolution', async () => {
    const { app } = seeded();
    await seed(app, {
      organizationId: ALIEN,
      name: 'Sarah Chen',
      actorId: ACTOR,
      correlationId: 'c1',
    });

    const result = await app.findEmployeeByName(TENANT, 'Sarah');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});

describe('ListEmployeesByIds', () => {
  it('loads only the requested ids within the organization', async () => {
    const { app } = seeded();
    const sarah = await seed(app, {
      organizationId: TENANT,
      name: 'Sarah Chen',
      actorId: ACTOR,
      correlationId: 'c1',
    });
    await seed(app, {
      organizationId: TENANT,
      name: 'Priya Patel',
      actorId: ACTOR,
      correlationId: 'c2',
    });

    const result = await app.listEmployeesByIds(TENANT, [sarah.id]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.name)).toEqual(['Sarah Chen']);
  });

  it('returns an empty list for an empty id set', async () => {
    const { app } = seeded();
    const result = await app.listEmployeesByIds(TENANT, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('never resolves a foreign-tenant id to a record', async () => {
    const { app } = seeded();
    const alien = await seed(app, {
      organizationId: ALIEN,
      name: 'Sarah Chen',
      actorId: ACTOR,
      correlationId: 'c1',
    });

    const result = await app.listEmployeesByIds(TENANT, [alien.id]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('ignores unknown ids instead of erroring', async () => {
    const { app } = seeded();
    const result = await app.listEmployeesByIds(TENANT, ['emp_does_not_exist']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});
