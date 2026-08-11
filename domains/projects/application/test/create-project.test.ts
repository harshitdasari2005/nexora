/**
 * CreateProject application-layer tests: the use case validates input,
 * creates + activates through the domain, publishes events once, and maps
 * failures to the canonical error vocabulary.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@nexora/shared/errors';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { CreateProjectCommand } from '@nexora/application-projects';

import { CreateProjectHandler } from '../src/index.js';
import { buildApplication, domainService, FakeProjectRepository, TENANT } from './helpers.js';

function service() {
  const { app, projects, publisher } = buildApplication();
  return { app, repository: projects, publisher };
}

const command: CreateProjectCommand = {
  organizationId: TENANT,
  name: 'Mobile Banking',
  description: 'Core banking app',
  actorId: 'usr_alex' as UserId,
  correlationId: 'corr_1',
};

describe('ProjectApplicationService.createProject', () => {
  it('creates an active project and publishes created + activated events', async () => {
    const { app, repository, publisher } = service();
    const result = await app.createProject(command);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.project.status.value).toBe('active');
    expect(result.value.project.name.value).toBe('Mobile Banking');
    expect(repository.projects.size).toBe(1);
    expect(publisher.published.map((event) => event.type)).toEqual([
      'project.created',
      'project.activated',
    ]);
    expect(publisher.published.every((event) => event.tenantId === TENANT)).toBe(true);
  });

  it('returns a validation error for an invalid name without any mutation', async () => {
    const { app, repository, publisher } = service();
    const result = await app.createProject({ ...command, name: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(repository.projects.size).toBe(0);
    expect(publisher.published).toHaveLength(0);
  });

  it('returns a validation error for an over-long name', async () => {
    const { app } = service();
    const result = await app.createProject({ ...command, name: 'x'.repeat(81) });
    expect(result.ok).toBe(false);
  });

  it('returns a validation error for an over-long description', async () => {
    const { app } = service();
    const result = await app.createProject({ ...command, description: 'x'.repeat(2001) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('propagates a domain validation failure (repo untouched, no events)', async () => {
    const { app, repository, publisher } = service();
    const result = await app.createProject({ ...command, name: '' });
    expect(result.ok).toBe(false);
    expect(repository.projects.size).toBe(0);
    expect(publisher.published).toHaveLength(0);
  });

  it('surfaces a repository failure without publishing events', async () => {
    const failing = new (class extends FakeProjectRepository {
      override async save(): Promise<void> {
        throw new Error('simulated persistence failure');
      }
    })();
    const { app, publisher } = buildApplication({ projectsService: domainService(failing) });
    const result = await app.createProject(command);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(publisher.published).toHaveLength(0);
  });

  it('is tenant-scoped: the project belongs to the trusted organization', async () => {
    const { app, repository } = service();
    const result = await app.createProject(command);
    expect(result.ok).toBe(true);
    const created = [...repository.projects.values()][0];
    expect(created?.organizationId).toBe(TENANT);
  });
});

describe('CreateProjectHandler', () => {
  it('delegates to the application service', async () => {
    const { app, repository } = service();
    const handler = new CreateProjectHandler(app);
    const result = await handler.handle(command);
    expect(result.ok).toBe(true);
    expect(repository.projects.size).toBe(1);
  });
});

describe('tenant isolation', () => {
  it('never crosses the tenant boundary when creating', async () => {
    const { app, repository } = service();
    await app.createProject(command);
    await app.createProject({
      ...command,
      organizationId: 'org_alien' as TenantId,
      name: 'Alien',
    });
    const tenants = new Set([...repository.projects.values()].map((p) => p.organizationId));
    expect(tenants).toEqual(new Set([TENANT, 'org_alien']));
    // The trusted command tenant is always the aggregate owner.
    expect([...repository.projects.values()][0]?.organizationId).toBe(TENANT);
  });
});
