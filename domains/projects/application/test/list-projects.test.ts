/**
 * ListProjects application-layer tests: the tenant-scoped read query maps
 * aggregates to DTOs and never leaks another tenant's projects.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import { ListProjectsHandler } from '../src/index.js';
import { buildApplication, domainService, FakeProjectRepository, TENANT } from './helpers.js';

async function seedProjects(tenantId: TenantId): Promise<FakeProjectRepository> {
  const repository = new FakeProjectRepository();
  const service = domainService(repository);
  await service.create(
    { organizationId: tenantId, name: 'Mobile Banking', description: 'Core app' },
    { actor: { kind: 'user', id: 'usr_alex' }, correlationId: 'corr_1', organizationId: tenantId },
  );
  await service.create(
    { organizationId: tenantId, name: 'Payroll' },
    { actor: { kind: 'user', id: 'usr_alex' }, correlationId: 'corr_2', organizationId: tenantId },
  );
  return repository;
}

describe('ProjectApplicationService.listProjectsByOrganization', () => {
  it('lists the projects of an organization as DTOs', async () => {
    const repository = await seedProjects(TENANT);
    const app = buildApplication({ projectsService: domainService(repository) }).app;
    const result = await app.listProjectsByOrganization(TENANT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((project) => project.name).sort()).toEqual([
      'Mobile Banking',
      'Payroll',
    ]);
    expect(result.value[0]).toMatchObject({
      organizationId: TENANT,
      status: 'proposed',
      createdAt: expect.any(String),
    });
  });

  it('returns an empty list when the organization has no projects', async () => {
    const app = buildApplication({
      projectsService: domainService(new FakeProjectRepository()),
    }).app;
    const result = await app.listProjectsByOrganization(TENANT);
    expect(result.ok && result.value).toEqual([]);
  });

  it('does not leak another tenant’s projects (tenant isolation)', async () => {
    const repository = await seedProjects(TENANT);
    const service = domainService(repository);
    const alien = 'org_alien' as TenantId;
    await service.create(
      { organizationId: alien, name: 'Alien Project' },
      { actor: { kind: 'user', id: 'usr_alex' }, correlationId: 'corr_3', organizationId: alien },
    );

    const app = buildApplication({ projectsService: service }).app;
    const result = await app.listProjectsByOrganization(TENANT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.value.map((project) => project.name);
    expect(names).not.toContain('Alien Project');
    expect(names).toHaveLength(2);
  });
});

describe('ListProjectsHandler', () => {
  it('delegates to the application service', async () => {
    const repository = await seedProjects(TENANT);
    const app = buildApplication({
      projectsService: domainService(repository),
    }).app;
    const handler = new ListProjectsHandler(app);
    const result = await handler.handle({ organizationId: TENANT });
    expect(result.ok && result.value).toHaveLength(2);
  });
});
