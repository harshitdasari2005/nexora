/**
 * Employees API tests (`fastify.inject`, in-memory fakes): create and list
 * employee records with membership gating, plus the project-members endpoint
 * that joins employee names through the HR application layer. Every surface
 * shares ONE business execution path with the AI tools.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';
import type { ProjectStatusValue } from '@nexora/domain-projects';

import {
  buildTestApp,
  chatClient,
  onboardOrgAndWorkspace,
  seedEmployee,
  seedProject,
  type ChatClient,
} from './helpers.js';
import type { FakeEmployeeRepository } from './fakes.js';

/** Creates an employee through the API and returns the DTO. */
async function createEmployee(
  client: ChatClient,
  organizationId: string,
  name: string,
): Promise<{ id: string; name: string; status: string }> {
  const response = await client.post('/api/employees', { organizationId, name });
  expect(response.statusCode).toBe(201);
  const employee = response.json().employee as { id: string; name: string; status: string };
  expect(employee.name).toBe(name);
  expect(employee.status).toBe('active');
  return employee;
}

describe('POST /api/employees', () => {
  it('creates an active employee record in the caller’s organization', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const employee = await createEmployee(client, organizationId, 'Sarah Chen');

    const stored = await client.repos.employees.findById(employee.id as never);
    expect(stored?.name.value).toBe('Sarah Chen');
    expect(stored?.isActive()).toBe(true);
    await client.app.close();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: { 'content-type': 'application/json' },
      payload: { organizationId: 'org_1', name: 'Sarah' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects invalid input with 400', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const response = await client.post('/api/employees', {
      organizationId,
      name: '   ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await client.app.close();
  });

  it('rejects an employee for an organization the caller does not belong to (403)', async () => {
    const client = await chatClient();
    const response = await client.post('/api/employees', {
      organizationId: 'org_alien',
      name: 'Sarah',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    await client.app.close();
  });
});

describe('GET /api/employees', () => {
  it('lists the employees of the caller’s organization', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await createEmployee(client, organizationId, 'Sarah Chen');
    await createEmployee(client, organizationId, 'Priya Patel');

    const response = await client.get(`/api/employees?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    const names = (response.json().employees as { name: string }[]).map((e) => e.name).sort();
    expect(names).toEqual(['Priya Patel', 'Sarah Chen']);
    await client.app.close();
  });

  it('requires the organizationId query parameter (400)', async () => {
    const client = await chatClient();
    const response = await client.get('/api/employees');
    expect(response.statusCode).toBe(400);
    await client.app.close();
  });

  it('never lists employees of an organization the caller cannot access', async () => {
    const client = await chatClient();
    await seedEmployee(client.repos, {
      id: 'emp_alien',
      organizationId: 'org_alien',
      name: 'Alien',
    });
    const response = await client.get('/api/employees?organizationId=org_alien');
    expect(response.statusCode).toBe(403);
    await client.app.close();
  });
});

describe('GET /api/projects/:projectId/members', () => {
  it('returns the members of a project with joined employee names', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await createEmployee(client, organizationId, 'Sarah Chen');
    const employees = [...(client.repos.employees as FakeEmployeeRepository).employees.values()];
    const sarah = employees.find((e) => e.name.value === 'Sarah Chen');
    expect(sarah).toBeDefined();

    // Seed an active project directly (fixed id) for a deterministic URL.
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });

    // Assign Sarah through the domain assignment service (bypasses AI).
    const { ResourceAssignmentDomainService } = await import('@nexora/domain-projects');
    const service = new ResourceAssignmentDomainService({
      projects: client.repos.projects,
      assignments: client.repos.resourceAssignments,
    });
    const assigned = await service.assign(
      {
        projectId: 'prj_12345678-1234-1234-1234-123456789012' as never,
        employeeId: sarah!.id,
      },
      {
        actor: { kind: 'user', id: 'usr_test' },
        correlationId: 'corr_test',
        organizationId: organizationId as TenantId,
      },
    );
    expect(assigned.ok).toBe(true);

    const response = await client.get(
      `/api/projects/prj_12345678-1234-1234-1234-123456789012/members?organizationId=${organizationId}`,
    );
    expect(response.statusCode).toBe(200);
    const members = response.json().members as {
      employeeId: string;
      employeeName: string | null;
    }[];
    expect(members).toHaveLength(1);
    expect(members[0]?.employeeName).toBe('Sarah Chen');
    await client.app.close();
  });

  it('returns an empty member list for a project without members', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Empty',
      status: 'active',
    });

    const response = await client.get(
      `/api/projects/prj_12345678-1234-1234-1234-123456789012/members?organizationId=${organizationId}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().members).toEqual([]);
    await client.app.close();
  });

  it('never leaks members of a project the caller cannot access', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active' as ProjectStatusValue,
    });
    // The caller is not a member of the foreign organization.
    const response = await client.get(
      '/api/projects/prj_12345678-1234-1234-1234-123456789012/members?organizationId=org_alien',
    );
    expect(response.statusCode).toBe(403);
    await client.app.close();
  });
});
