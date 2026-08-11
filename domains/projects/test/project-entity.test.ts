/**
 * Project aggregate tests: creation and the full lifecycle
 * (DOMAIN_MODEL.md §14.2). Every transition validates the policy BEFORE
 * mutating — no partial aggregate mutation on validation failure.
 */

import { describe, expect, it } from 'vitest';

import { Project, ProjectStateTransitionError, PROJECT_EVENT_TYPES } from '../src/index.js';
import { TENANT, userContext } from './helpers.js';

const context = userContext();

/** Builds an active project (created + activated, events cleared). */
function activeProject(): Project {
  const project = Project.create({ organizationId: TENANT, name: 'Mobile Banking' }, context);
  project.pullDomainEvents();
  project.activate(context);
  project.pullDomainEvents();
  return project;
}

describe('Project.create', () => {
  it('creates a project in `proposed` with generated id and version 1', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Mobile Banking' }, context);
    expect(project.id).toMatch(/^prj_/);
    expect(project.name.value).toBe('Mobile Banking');
    expect(project.status.value).toBe('proposed');
    expect(project.organizationId).toBe(TENANT);
    expect(project.version).toBe(1);
    expect(project.createdAt).toBe(project.updatedAt);
  });

  it('records exactly one `project.created` event on creation', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Mobile Banking' }, context);
    const events = project.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(PROJECT_EVENT_TYPES.projectCreated);
    const payload = events[0]?.payload as { name: string; organizationId: string };
    expect(payload.name).toBe('Mobile Banking');
    expect(payload.organizationId).toBe(TENANT);
    expect(events[0]?.tenantId).toBe(TENANT);
    expect(events[0]?.metadata?.category).toBe('projects');
  });

  it('trims the name at creation', () => {
    const project = Project.create({ organizationId: TENANT, name: '  Payroll  ' }, context);
    expect(project.name.value).toBe('Payroll');
  });

  it('keeps an optional description', () => {
    const project = Project.create(
      { organizationId: TENANT, name: 'Payroll', description: 'Finance sprint' },
      context,
    );
    expect(project.description.value).toBe('Finance sprint');
  });

  it('rejects an invalid name with no aggregate created', () => {
    expect(() => Project.create({ organizationId: TENANT, name: '   ' }, context)).toThrow();
  });
});

describe('Project lifecycle (DOMAIN_MODEL.md §14.2)', () => {
  it('activates proposed → active (charter approved) and emits project.activated', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Mobile Banking' }, context);
    project.pullDomainEvents();
    project.activate(context);
    expect(project.status.value).toBe('active');
    expect(project.isActive()).toBe(true);
    const events = project.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(PROJECT_EVENT_TYPES.projectActivated);
    expect(project.version).toBe(2);
  });

  it('pauses active → on_hold and emits project.on_hold with a reason', () => {
    const project = activeProject();
    project.hold('Resource freeze', context);
    expect(project.status.value).toBe('on_hold');
    const events = project.pullDomainEvents();
    expect(events[0]?.type).toBe(PROJECT_EVENT_TYPES.projectOnHold);
    expect((events[0]?.payload as { reason: string }).reason).toBe('Resource freeze');
  });

  it('resumes on_hold → active and emits project.resumed', () => {
    const project = activeProject();
    project.hold('Pause', context);
    project.pullDomainEvents();
    project.resume(context);
    expect(project.status.value).toBe('active');
    expect(project.pullDomainEvents()[0]?.type).toBe(PROJECT_EVENT_TYPES.projectResumed);
  });

  it('completes active → completed (owner closes, EVT-9)', () => {
    const project = activeProject();
    project.complete(context);
    expect(project.status.value).toBe('completed');
    expect(project.pullDomainEvents()[0]?.type).toBe(PROJECT_EVENT_TYPES.projectCompleted);
  });

  it('archives completed → archived (retention policy)', () => {
    const project = activeProject();
    project.complete(context);
    project.pullDomainEvents();
    project.archive('Retention policy', context);
    expect(project.status.value).toBe('archived');
    expect(project.pullDomainEvents()[0]?.type).toBe(PROJECT_EVENT_TYPES.projectArchived);
  });

  it('cancels proposed → cancelled', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    project.pullDomainEvents();
    project.cancel('Charter withdrawn', context);
    expect(project.status.value).toBe('cancelled');
    expect(project.pullDomainEvents()[0]?.type).toBe(PROJECT_EVENT_TYPES.projectCancelled);
  });

  it('cancels active → cancelled (owner + approval)', () => {
    const project = activeProject();
    project.cancel('Sponsor cancelled', context);
    expect(project.status.value).toBe('cancelled');
  });

  it('bumps version on every mutation', () => {
    const project = activeProject();
    project.hold('Pause', context);
    expect(project.version).toBe(3);
    project.resume(context);
    expect(project.version).toBe(4);
  });
});

describe('Project transition guards (validate → mutate → event)', () => {
  it('rejects holding a proposed project (no mutation, no event)', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    project.pullDomainEvents();
    expect(() => project.hold('Pause', context)).toThrow(ProjectStateTransitionError);
    expect(project.status.value).toBe('proposed');
    expect(project.version).toBe(1);
    expect(project.pullDomainEvents()).toHaveLength(0);
  });

  it('rejects completing a proposed project', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    project.pullDomainEvents();
    expect(() => project.complete(context)).toThrow(ProjectStateTransitionError);
    expect(project.status.value).toBe('proposed');
  });

  it('rejects activating an active project', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    project.pullDomainEvents();
    project.activate(context);
    project.pullDomainEvents();
    expect(() => project.activate(context)).toThrow(ProjectStateTransitionError);
    expect(project.status.value).toBe('active');
  });

  it('rejects resuming an active project', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    project.pullDomainEvents();
    project.activate(context);
    project.pullDomainEvents();
    expect(() => project.resume(context)).toThrow(ProjectStateTransitionError);
  });

  it('rejects completing an on_hold project', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    project.pullDomainEvents();
    project.activate(context);
    project.pullDomainEvents();
    project.hold('Pause', context);
    project.pullDomainEvents();
    expect(() => project.complete(context)).toThrow(ProjectStateTransitionError);
    expect(project.status.value).toBe('on_hold');
  });

  it('rejects archiving an active project (retention requires completion)', () => {
    const project = activeProject();
    expect(() => project.archive('Retention', context)).toThrow(ProjectStateTransitionError);
  });

  it('rejects every mutation on an archived project (immutable)', () => {
    const project = activeProject();
    project.complete(context);
    project.pullDomainEvents();
    project.archive('Retention', context);
    project.pullDomainEvents();
    expect(() => project.activate(context)).toThrow(ProjectStateTransitionError);
    expect(() => project.hold('Pause', context)).toThrow(ProjectStateTransitionError);
    expect(() => project.complete(context)).toThrow(ProjectStateTransitionError);
    expect(() => project.cancel('No', context)).toThrow(ProjectStateTransitionError);
    expect(project.version).toBe(4);
  });

  it('rejects every mutation on a cancelled project (terminal)', () => {
    const project = activeProject();
    project.cancel('Sponsor cancelled', context);
    project.pullDomainEvents();
    expect(() => project.activate(context)).toThrow(ProjectStateTransitionError);
    expect(() => project.resume(context)).toThrow(ProjectStateTransitionError);
    expect(() => project.complete(context)).toThrow(ProjectStateTransitionError);
  });
});
