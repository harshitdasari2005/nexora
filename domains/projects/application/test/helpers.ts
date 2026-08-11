/**
 * Shared test helpers for the Projects application layer tests: in-memory
 * {@link ProjectRepository} and {@link ResourceAssignmentRepository} fakes,
 * a recording {@link EventPublisher}, and a {@link ProjectApplicationService}
 * builder.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import {
  ProjectApplicationService,
  type ProjectApplicationServiceDependencies,
} from '../src/index.js';
import {
  ProjectDomainService,
  ResourceAssignmentDomainService,
  type Project,
  type ProjectRepository,
  type ResourceAssignment,
  type ResourceAssignmentRepository,
} from '@nexora/domain-projects';

/** The default test tenant. */
export const TENANT = 'org_acme' as TenantId;

/** An in-memory {@link ProjectRepository} (test fake). */
export class FakeProjectRepository implements ProjectRepository {
  readonly projects = new Map<string, Project>();

  async findById(id: Project['id']): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async findByName(organizationId: TenantId, name: string): Promise<readonly Project[]> {
    const term = name.trim().toLowerCase();
    return [...this.projects.values()].filter(
      (project) =>
        project.organizationId === organizationId &&
        project.name.value.toLowerCase().includes(term),
    );
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Project[]> {
    return [...this.projects.values()].filter(
      (project) => project.organizationId === organizationId,
    );
  }

  async save(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }
}

/** An in-memory {@link ResourceAssignmentRepository} (test fake). */
export class FakeResourceAssignmentRepository implements ResourceAssignmentRepository {
  readonly assignments = new Map<string, ResourceAssignment>();

  async findById(id: ResourceAssignment['id']): Promise<ResourceAssignment | undefined> {
    return this.assignments.get(id);
  }

  async findByProjectAndEmployee(
    projectId: ResourceAssignment['projectId'],
    employeeId: string,
  ): Promise<ResourceAssignment | undefined> {
    return [...this.assignments.values()].find(
      (assignment) => assignment.projectId === projectId && assignment.employeeId === employeeId,
    );
  }

  async listByProject(
    projectId: ResourceAssignment['projectId'],
  ): Promise<readonly ResourceAssignment[]> {
    return [...this.assignments.values()].filter(
      (assignment) => assignment.projectId === projectId,
    );
  }

  async save(assignment: ResourceAssignment): Promise<void> {
    this.assignments.set(assignment.id, assignment);
  }
}

/** A recording {@link EventPublisher} (assert what was published). */
export class RecordingEventPublisher implements EventPublisher {
  readonly published: EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    this.published.push(...events);
  }
}

/** Builds a project domain service over a fresh fake repository. */
export function domainService(
  repository: FakeProjectRepository = new FakeProjectRepository(),
): ProjectDomainService {
  return new ProjectDomainService({ projects: repository });
}

/** Builds a resource-assignment domain service over fresh fakes. */
export function assignmentService(
  projects: FakeProjectRepository = new FakeProjectRepository(),
  assignments: FakeResourceAssignmentRepository = new FakeResourceAssignmentRepository(),
): ResourceAssignmentDomainService {
  return new ResourceAssignmentDomainService({ projects, assignments });
}

/** Builds a fully wired {@link ProjectApplicationService} (test harness). */
export function buildApplication(overrides: Partial<ProjectApplicationServiceDependencies> = {}): {
  app: ProjectApplicationService;
  projects: FakeProjectRepository;
  assignments: FakeResourceAssignmentRepository;
  publisher: RecordingEventPublisher;
} {
  const projects = new FakeProjectRepository();
  const assignments = new FakeResourceAssignmentRepository();
  const publisher = new RecordingEventPublisher();
  const app = new ProjectApplicationService({
    projectsService: domainService(projects),
    assignmentsService: assignmentService(projects, assignments),
    publisher,
    ...overrides,
  });
  return { app, projects, assignments, publisher };
}
