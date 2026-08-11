/**
 * ResourceAssignment domain tests: the assign-employee-to-project use case
 * (DOMAIN_MODEL.md §14.2 `assign_resource`) — project lifecycle validation,
 * tenant isolation, duplicate-assignment protection, validate-before-mutate,
 * and event recording.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import { Project, type ProjectId } from '../src/index.js';
import type { ProjectRepository, ResourceAssignmentRepository } from '../src/repositories/index.js';
import {
  DuplicateAssignmentError,
  ProjectNotAssignableError,
  ProjectNotFoundError,
  ResourceAssignment,
  ResourceAssignmentDomainService,
  type AssignmentId,
} from '../src/index.js';
import { TENANT, userContext } from './helpers.js';

/** In-memory {@link ResourceAssignmentRepository}. */
class FakeResourceAssignmentRepository implements ResourceAssignmentRepository {
  readonly assignments = new Map<string, ResourceAssignment>();

  async findByProjectAndEmployee(
    projectId: ProjectId,
    employeeId: string,
  ): Promise<ResourceAssignment | undefined> {
    return [...this.assignments.values()].find(
      (assignment) => assignment.projectId === projectId && assignment.employeeId === employeeId,
    );
  }

  async findById(id: AssignmentId): Promise<ResourceAssignment | undefined> {
    return this.assignments.get(id);
  }

  async listByProject(projectId: ProjectId): Promise<readonly ResourceAssignment[]> {
    return [...this.assignments.values()].filter(
      (assignment) => assignment.projectId === projectId,
    );
  }

  async save(assignment: ResourceAssignment): Promise<void> {
    this.assignments.set(assignment.id, assignment);
  }
}

/** An in-memory {@link ProjectRepository} over a Map. */
class FakeProjectRepository implements ProjectRepository {
  readonly projects = new Map<string, Project>();

  async findById(id: ProjectId): Promise<Project | undefined> {
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

function build() {
  const projects = new FakeProjectRepository();
  const assignments = new FakeResourceAssignmentRepository();
  const service = new ResourceAssignmentDomainService({ projects, assignments });
  return { projects, assignments, service };
}

/** Seeds a project with a fixed id and status within an organization. */
function seedProject(
  projects: FakeProjectRepository,
  id: string,
  status: 'proposed' | 'active' | 'completed' | 'archived' | 'cancelled' | 'on_hold',
  organizationId: TenantId = TENANT,
): void {
  const created = Project.create(
    { organizationId, name: `Project ${id}` },
    userContext('usr_alex', organizationId),
  );
  created.pullDomainEvents();
  projects.save(Project.hydrate({ ...Project.snapshot(created), id: id as ProjectId, status }));
}

describe('ResourceAssignmentDomainService.assign', () => {
  it('assigns an employee to an active project and records the event', async () => {
    const { projects, assignments, service } = build();
    seedProject(projects, 'prj_1', 'active');

    const result = await service.assign(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1' },
      userContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.assignment.projectId).toBe('prj_1' as ProjectId);
      expect(result.value.assignment.employeeId).toBe('emp_1');
      expect(result.value.assignment.organizationId).toBe(TENANT);
      expect(result.value.events.map((event) => event.type)).toEqual(['project.resource_assigned']);
      expect((result.value.events[0]?.payload as { employeeId: string }).employeeId).toBe('emp_1');
      expect(assignments.assignments.size).toBe(1);
    }
  });

  it('rejects a missing project (not found)', async () => {
    const { service } = build();
    const result = await service.assign(
      { projectId: 'prj_missing' as ProjectId, employeeId: 'emp_1' },
      userContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ProjectNotFoundError);
    }
  });

  it('rejects a project outside the caller tenant (cross-tenant impossible)', async () => {
    const { projects, service } = build();
    seedProject(projects, 'prj_alien', 'active', 'org_alien' as TenantId);
    const result = await service.assign(
      { projectId: 'prj_alien' as ProjectId, employeeId: 'emp_1' },
      userContext(), // caller is in TENANT, project in org_alien
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ProjectNotFoundError);
    }
  });

  it('rejects assignment to a non-active project (assignable lifecycle)', async () => {
    const { projects, service } = build();
    seedProject(projects, 'prj_1', 'proposed');
    const result = await service.assign(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1' },
      userContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ProjectNotAssignableError);
    }
  });

  it('rejects assignment to completed/archived/cancelled/on-hold projects', async () => {
    for (const status of ['completed', 'archived', 'cancelled', 'on_hold'] as const) {
      const { projects, service } = build();
      seedProject(projects, 'prj_1', status);
      const result = await service.assign(
        { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1' },
        userContext(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ProjectNotAssignableError);
      }
    }
  });

  it('rejects a duplicate assignment (an employee is assigned at most once)', async () => {
    const { projects, assignments, service } = build();
    seedProject(projects, 'prj_1', 'active');

    const first = await service.assign(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1' },
      userContext(),
    );
    expect(first.ok).toBe(true);

    const second = await service.assign(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1' },
      userContext(),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBeInstanceOf(DuplicateAssignmentError);
    }
    // Exactly one assignment was persisted.
    expect(assignments.assignments.size).toBe(1);
  });

  it('allows different employees on the same project', async () => {
    const { projects, assignments, service } = build();
    seedProject(projects, 'prj_1', 'active');

    const a = await service.assign(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1' },
      userContext(),
    );
    const b = await service.assign(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_2' },
      userContext(),
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(assignments.assignments.size).toBe(2);
  });

  it('no mutation on a failed check (validate-before-mutate)', async () => {
    const { projects, assignments, service } = build();
    seedProject(projects, 'prj_1', 'proposed');
    const result = await service.assign(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1' },
      userContext(),
    );
    expect(result.ok).toBe(false);
    expect(assignments.assignments.size).toBe(0);
  });

  it('surfaces a persistence failure as an internal domain error', async () => {
    const { projects } = build();
    seedProject(projects, 'prj_1', 'active');
    const failing = new ResourceAssignmentDomainService({
      projects,
      assignments: {
        async findByProjectAndEmployee() {
          return undefined;
        },
        async findById() {
          return undefined;
        },
        async listByProject() {
          return [];
        },
        async save() {
          throw new Error('simulated persistence failure');
        },
      },
    });
    const result = await failing.assign(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1' },
      userContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});

describe('ResourceAssignment snapshot / hydrate', () => {
  it('round-trips through snapshot and hydrate without re-emitting events', () => {
    const assignment = ResourceAssignment.create(
      { projectId: 'prj_1' as ProjectId, employeeId: 'emp_1', organizationId: TENANT },
      userContext(),
    );
    assignment.pullDomainEvents();
    const restored = ResourceAssignment.hydrate(ResourceAssignment.snapshot(assignment));
    expect(restored.id).toBe(assignment.id);
    expect(restored.projectId).toBe(assignment.projectId);
    expect(restored.employeeId).toBe('emp_1');
    expect(restored.organizationId).toBe(TENANT);
    expect(restored.assignedAt).toBe(assignment.assignedAt);
    expect(restored.version).toBe(assignment.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });
});
