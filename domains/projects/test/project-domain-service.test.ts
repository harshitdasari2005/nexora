/**
 * ProjectDomainService tests: use-case orchestration over the aggregate and
 * its repository — creation, lifecycle transitions, tenant-scoped listing,
 * and expected-failure paths (all return `Result`, never throw).
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  InvalidProjectValueError,
  ProjectNotFoundError,
  ProjectDomainService,
  ProjectStateTransitionError,
  type Project,
  type ProjectRepository,
} from '../src/index.js';
import { TENANT, userContext } from './helpers.js';

/** An in-memory {@link ProjectRepository} (test fake). */
class FakeProjectRepository implements ProjectRepository {
  readonly projects = new Map<string, Project>();

  async findById(id: Project['id']): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Project[]> {
    return [...this.projects.values()].filter(
      (project) => project.organizationId === organizationId,
    );
  }

  async findByName(organizationId: TenantId, name: string): Promise<readonly Project[]> {
    const needle = name.trim().toLowerCase();
    return [...this.projects.values()].filter(
      (project) =>
        project.organizationId === organizationId &&
        project.name.value.toLowerCase().includes(needle),
    );
  }

  async save(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }
}

/** A repository whose save fails (infrastructure failure simulation). */
class FailingProjectRepository extends FakeProjectRepository {
  override async save(): Promise<void> {
    throw new Error('simulated persistence failure');
  }
}

function service(repository: FakeProjectRepository = new FakeProjectRepository()) {
  return { repository, service: new ProjectDomainService({ projects: repository }) };
}

const context = userContext();

describe('ProjectDomainService.create', () => {
  it('creates and persists a project in `proposed` with its created event', async () => {
    const { repository, service: projects } = service();
    const result = await projects.create(
      { organizationId: TENANT, name: 'Mobile Banking', description: 'Core app' },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.project.status.value).toBe('proposed');
    expect(result.value.events).toHaveLength(1);
    expect(repository.projects.has(result.value.project.id)).toBe(true);
  });

  it('returns a validation error for an invalid name (no mutation)', async () => {
    const { repository, service: projects } = service();
    const result = await projects.create({ organizationId: TENANT, name: '   ' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(InvalidProjectValueError);
    expect(repository.projects.size).toBe(0);
  });

  it('returns a validation error for an over-long description', async () => {
    const { repository, service: projects } = service();
    const result = await projects.create(
      { organizationId: TENANT, name: 'Payroll', description: 'x'.repeat(2001) },
      context,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(InvalidProjectValueError);
    expect(repository.projects.size).toBe(0);
  });

  it('surfaces a persistence failure as an internal domain error', async () => {
    const { service: projects } = service(new FailingProjectRepository());
    const result = await projects.create({ organizationId: TENANT, name: 'Payroll' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('ProjectDomainService lifecycle', () => {
  async function seeded(service: ProjectDomainService): Promise<Project> {
    const created = await service.create(
      { organizationId: TENANT, name: 'Mobile Banking' },
      context,
    );
    if (!created.ok) throw new Error('seed failed');
    return created.value.project;
  }

  it('activates a proposed project through the service', async () => {
    const { service: projects } = service();
    const project = await seeded(projects);
    const result = await projects.activate(project.id, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.project.status.value).toBe('active');
    expect(result.value.events[0]?.type).toBe('project.activated');
  });

  it('walks the full lifecycle through the service', async () => {
    const { service: projects } = service();
    const project = await seeded(projects);
    await projects.activate(project.id, context);
    const held = await projects.hold(project.id, 'Pause', context);
    expect(held.ok && held.value.project.status.value).toBe('on_hold');
    const resumed = await projects.resume(project.id, context);
    expect(resumed.ok && resumed.value.project.status.value).toBe('active');
    const completed = await projects.complete(project.id, context);
    expect(completed.ok && completed.value.project.status.value).toBe('completed');
    const archived = await projects.archive(project.id, 'Retention', context);
    expect(archived.ok && archived.value.project.status.value).toBe('archived');
  });

  it('returns NOT_FOUND for unknown ids on every transition', async () => {
    const { service: projects } = service();
    const unknown = 'prj_00000000-0000-4000-8000-000000000000';
    for (const action of ['activate', 'hold', 'resume', 'complete', 'archive', 'cancel']) {
      const result = await projects[action as 'activate'](unknown as Project['id'], context);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBeInstanceOf(ProjectNotFoundError);
    }
  });

  it('returns a state-transition error for an illegal service transition', async () => {
    const { service: projects } = service();
    const project = await seeded(projects);
    const result = await projects.complete(project.id, context); // proposed → completed ✗
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ProjectStateTransitionError);
    // The aggregate was not mutated.
    const reloaded = await projects.findById(project.id);
    expect(reloaded.ok && reloaded.value.status.value).toBe('proposed');
  });

  it('cancels a proposed project', async () => {
    const { service: projects } = service();
    const project = await seeded(projects);
    const result = await projects.cancel(project.id, 'Charter withdrawn', context);
    expect(result.ok && result.value.project.status.value).toBe('cancelled');
  });
});

describe('ProjectDomainService reads', () => {
  it('finds a project by id', async () => {
    const { service: projects } = service();
    const created = await projects.create({ organizationId: TENANT, name: 'Payroll' }, context);
    if (!created.ok) throw new Error('seed failed');
    const found = await projects.findById(created.value.project.id);
    expect(found.ok && found.value.name.value).toBe('Payroll');
  });

  it('returns NOT_FOUND for a missing project', async () => {
    const { service: projects } = service();
    const result = await projects.findById(
      'prj_00000000-0000-4000-8000-000000000000' as Project['id'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ProjectNotFoundError);
  });

  it('lists projects scoped to the organization (tenant isolation)', async () => {
    const { service: projects } = service();
    const otherTenant = 'org_alien' as TenantId;
    await projects.create({ organizationId: TENANT, name: 'Payroll' }, context);
    await projects.create({ organizationId: TENANT, name: 'Mobile Banking' }, context);
    await projects.create(
      { organizationId: otherTenant, name: 'Alien Project' },
      userContext('usr_alex', otherTenant),
    );

    const listed = await projects.listByOrganization(TENANT);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((project) => project.name.value).sort()).toEqual([
      'Mobile Banking',
      'Payroll',
    ]);
  });
});
