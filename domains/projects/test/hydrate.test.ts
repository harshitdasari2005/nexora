/**
 * Project snapshot/hydrate tests: persistence round-trip fidelity
 * (PERSISTENCE.md §4 aggregate ownership) — no events are emitted on
 * reconstitution, ids and versions are preserved, and values re-validate.
 */

import { describe, expect, it } from 'vitest';

import { Project, ProjectId } from '../src/index.js';
import { TENANT, userContext } from './helpers.js';

const context = userContext();

describe('Project.snapshot / hydrate', () => {
  it('round-trips a fresh project without emitting events', () => {
    const project = Project.create(
      { organizationId: TENANT, name: 'Mobile Banking', description: 'Core app' },
      context,
    );
    const snapshot = Project.snapshot(project);
    const restored = Project.hydrate(snapshot);
    expect(restored.id).toBe(project.id);
    expect(restored.name.value).toBe('Mobile Banking');
    expect(restored.description.value).toBe('Core app');
    expect(restored.organizationId).toBe(TENANT);
    expect(restored.status.value).toBe('proposed');
    expect(restored.version).toBe(project.version);
    expect(restored.createdAt).toBe(project.createdAt);
    expect(restored.pullDomainEvents()).toHaveLength(0);
  });

  it('round-trips a fully-transitioned project preserving status and version', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    project.pullDomainEvents();
    project.activate(context);
    project.hold('Pause', context);
    project.resume(context);
    project.complete(context);
    project.pullDomainEvents();

    const restored = Project.hydrate(Project.snapshot(project));
    expect(restored.status.value).toBe('completed');
    expect(restored.version).toBe(project.version);
    expect(restored.updatedAt).toBe(project.updatedAt);
    expect(restored.isActive()).toBe(false);
  });

  it('preserves a custom id across hydrate (reconstitution boundary)', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    const customId = ProjectId.create();
    const restored = Project.hydrate({ ...Project.snapshot(project), id: customId });
    expect(restored.id).toBe(customId);
  });

  it('re-validates status on hydrate', () => {
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, context);
    expect(() => Project.hydrate({ ...Project.snapshot(project), status: 'bogus' })).toThrow();
  });
});
