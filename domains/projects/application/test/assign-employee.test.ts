/**
 * AssignEmployeeToProject application-layer tests: the use case assigns a
 * resolved employee to a project through the domain, publishes the
 * assignment event once, and maps expected failures (not found, not
 * assignable, duplicate, tenant) to the canonical error vocabulary.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { AssignEmployeeToProjectCommand } from '@nexora/application-projects';
import { ProjectId } from '@nexora/domain-projects';

import { AssignEmployeeToProjectHandler, ListProjectMembersHandler } from '../src/index.js';
import { buildApplication, domainService, TENANT, type FakeProjectRepository } from './helpers.js';

const ACTOR = 'usr_alex' as UserId;

function command(
  overrides: Partial<AssignEmployeeToProjectCommand> = {},
): AssignEmployeeToProjectCommand {
  return {
    organizationId: TENANT,
    projectId: 'prj_12345678-1234-1234-1234-123456789012',
    employeeId: 'emp_sarah',
    actorId: ACTOR,
    correlationId: 'corr_assign_1',
    ...overrides,
  };
}

/** Seeds an active project so it is assignable. */
async function seedActiveProject(
  projects: FakeProjectRepository,
  tenant: TenantId = TENANT,
): Promise<string> {
  const ds = domainService(projects);
  const created = await ds.create(
    { organizationId: tenant, name: 'Mobile Banking' },
    { actor: { kind: 'user', id: ACTOR }, correlationId: 'corr_seed', organizationId: tenant },
  );
  if (!created.ok) throw new Error('seed failed');
  await ds.activate(created.value.project.id, {
    actor: { kind: 'user', id: ACTOR },
    correlationId: 'corr_seed',
    organizationId: tenant,
  });
  return created.value.project.id;
}

describe('ProjectApplicationService.assignEmployeeToProject', () => {
  it('assigns an employee to an active project and publishes the assignment event once', async () => {
    const { app, projects, assignments, publisher } = buildApplication();
    const projectId = await seedActiveProject(projects);

    const result = await app.assignEmployeeToProject(command({ projectId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assignment.projectId).toBe(projectId);
    expect(result.value.assignment.employeeId).toBe('emp_sarah');
    expect(result.value.assignment.organizationId).toBe(TENANT);
    expect(assignments.assignments.size).toBe(1);
    expect(publisher.published.map((event) => event.type)).toEqual(['project.resource_assigned']);
    expect(publisher.published[0]?.tenantId).toBe(TENANT);
  });

  it('rejects a project that does not exist', async () => {
    const { app, publisher } = buildApplication();
    const result = await app.assignEmployeeToProject(command());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
    expect(publisher.published).toHaveLength(0);
  });

  it('rejects an assignment to a non-active project (not assignable)', async () => {
    const { app, projects, publisher } = buildApplication();
    // Create but never activate → stays `proposed`.
    const ds = domainService(projects);
    const created = await ds.create(
      { organizationId: TENANT, name: 'Draft' },
      { actor: { kind: 'user', id: ACTOR }, correlationId: 'c', organizationId: TENANT },
    );
    if (!created.ok) throw new Error('seed failed');

    const result = await app.assignEmployeeToProject(
      command({ projectId: created.value.project.id }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(publisher.published).toHaveLength(0);
  });

  it('rejects a duplicate assignment (employee already assigned)', async () => {
    const { app, projects } = buildApplication();
    const projectId = await seedActiveProject(projects);

    const first = await app.assignEmployeeToProject(command({ projectId }));
    expect(first.ok).toBe(true);
    const second = await app.assignEmployeeToProject(command({ projectId }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('CONFLICT');
  });

  it('never crosses the tenant boundary: a foreign project id is not assignable', async () => {
    const { app } = buildApplication();
    const alienRepo: FakeProjectRepository = new (
      await import('./helpers.js')
    ).FakeProjectRepository();
    const alienId = await seedActiveProject(alienRepo, 'org_alien' as TenantId);
    // The command tenant (TENANT) differs from the project tenant (org_alien).
    const result = await app.assignEmployeeToProject(command({ projectId: alienId }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The tenant mismatch is indistinguishable from not-found (no leak).
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed project id as a validation error', async () => {
    const { app } = buildApplication();
    const result = await app.assignEmployeeToProject(command({ projectId: 'not-an-id' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('AssignEmployeeToProjectHandler', () => {
  it('delegates to the application service', async () => {
    const { app, projects } = buildApplication();
    const projectId = await seedActiveProject(projects);
    const handler = new AssignEmployeeToProjectHandler(app);
    const result = await handler.handle(command({ projectId }));
    expect(result.ok).toBe(true);
  });
});

describe('ProjectApplicationService.listProjectMembers', () => {
  it('lists the members of a project as member DTOs', async () => {
    const { app, projects } = buildApplication();
    const projectId = await seedActiveProject(projects);
    await app.assignEmployeeToProject(
      command({ projectId, employeeId: 'emp_sarah', correlationId: 'c1' }),
    );
    await app.assignEmployeeToProject(
      command({ projectId, employeeId: 'emp_priya', correlationId: 'c2' }),
    );

    const result = await app.listProjectMembers(TENANT, projectId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((m) => m.employeeId).sort()).toEqual(['emp_priya', 'emp_sarah']);
    expect(result.value[0]).toMatchObject({ projectId, assignedAt: expect.any(String) });
  });

  it('returns an empty member list for a project without members', async () => {
    const { app, projects } = buildApplication();
    const projectId = await seedActiveProject(projects);
    const result = await app.listProjectMembers(TENANT, projectId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('never leaks members of a foreign-tenant project', async () => {
    const { app, projects } = buildApplication();
    const projectId = await seedActiveProject(projects, TENANT);
    const result = await app.listProjectMembers('org_alien' as TenantId, projectId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('returns an empty list for an unknown project id', async () => {
    const { app } = buildApplication();
    const result = await app.listProjectMembers(TENANT, ProjectId.create());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});

describe('ListProjectMembersHandler', () => {
  it('delegates to the application service', async () => {
    const { app, projects } = buildApplication();
    const projectId = await seedActiveProject(projects);
    const handler = new ListProjectMembersHandler(app);
    const result = await handler.handle({ organizationId: TENANT, projectId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});
