/**
 * Projects domain event tests: envelope shape, category, tenant scoping, and
 * actor attribution (EVT-* catalog; PERSISTENCE.md §13 audit).
 */

import { describe, expect, it } from 'vitest';

import { Project, PROJECT_EVENT_TYPES, PROJECTS_EVENT_CATEGORY } from '../src/index.js';
import { TENANT, userContext } from './helpers.js';

describe('project events', () => {
  it('rides the canonical envelope with tenant scope and category `projects`', () => {
    const project = Project.create(
      { organizationId: TENANT, name: 'Mobile Banking' },
      userContext('usr_alex'),
    );
    const [event] = project.pullDomainEvents();
    expect(event).toBeDefined();
    expect(event?.id).toMatch(/^evt_/);
    expect(event?.type).toBe(PROJECT_EVENT_TYPES.projectCreated);
    expect(event?.version).toBe(1);
    expect(event?.tenantId).toBe(TENANT);
    expect(event?.occurredAt).toBeTruthy();
    expect(event?.metadata).toMatchObject({
      category: PROJECTS_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    });
  });

  it('attributes the actor (user) and correlation id', () => {
    const project = Project.create(
      { organizationId: TENANT, name: 'Payroll' },
      userContext('usr_alex', TENANT, 'corr_42'),
    );
    const [event] = project.pullDomainEvents();
    expect(event?.actor).toEqual({ kind: 'user', id: 'usr_alex' });
    expect(event?.correlationId).toBe('corr_42');
  });

  it('carries the created payload (name, organization, initial status)', () => {
    const project = Project.create(
      { organizationId: TENANT, name: 'Payroll', description: 'Finance sprint' },
      userContext('usr_alex'),
    );
    const [event] = project.pullDomainEvents();
    const payload = event?.payload as {
      projectId: string;
      name: string;
      organizationId: string;
      status: string;
    };
    expect(payload.projectId).toBe(project.id);
    expect(payload.name).toBe('Payroll');
    expect(payload.organizationId).toBe(TENANT);
    expect(payload.status).toBe('proposed');
  });

  it('lists the complete project event type catalog', () => {
    expect(PROJECT_EVENT_TYPES).toEqual({
      projectCreated: 'project.created',
      projectActivated: 'project.activated',
      projectOnHold: 'project.on_hold',
      projectResumed: 'project.resumed',
      projectCompleted: 'project.completed',
      projectArchived: 'project.archived',
      projectCancelled: 'project.cancelled',
      resourceAssigned: 'project.resource_assigned',
    });
  });
});
