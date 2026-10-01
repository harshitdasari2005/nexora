/**
 * WORKFLOW vertical slice REST tests (`fastify.inject`): the workflow
 * surface shares ONE execution path and ONE authorization model with the AI
 * surface — membership of the trusted organization. Starting the
 * CREATE_PROJECT_AND_ASSIGN_EMPLOYEE workflow through
 * `POST /api/workflows` runs the internal steps through the governed tool
 * pipeline (create → find → assign, dependencies respected) and persists a
 * journaled instance + step executions.
 *
 * Tenant isolation: a workflow id is only ever resolvable inside the tenant
 * that owns it — a foreign-tenant id resolves to 404, never to another
 * tenant's journal.
 */

import { describe, expect, it } from 'vitest';
import type { ResourceAssignment } from '@nexora/domain-projects';

import { MultiIdentityGateway } from './fakes.js';
import type {
  FakeEmployeeRepository,
  FakeProjectRepository,
  FakeResourceAssignmentRepository,
} from './fakes.js';
import {
  buildTestApp,
  currentUserId,
  login,
  onboardOrgAndWorkspace,
  seedEmployee,
  seedOrganizationMembership,
  seedProject,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';

/** The workflow definition key shipped with the runtime. */
const WORKFLOW_KEY = 'projects.create_and_assign_employee';

/** The `workflow` field of a workflow route response. */
interface WorkflowResponse {
  id: string;
  definitionKey: string;
  tenantId: string;
  userId: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

/** The `workflow` record (instance + step journal). */
interface WorkflowRecord {
  instance: WorkflowResponse;
  steps: {
    stepId: string;
    name: string;
    capabilityId: string;
    toolId: string;
    status: string;
    attempt: number;
    executionKey: string;
    input: Record<string, unknown>;
    error?: string;
  }[];
}

/** A workflow-test client with TWO logged-in users (alice + bob). */
interface WorkflowClient extends ChatClient {
  /** Bob's session cookie (a different user, no organization memberships). */
  bob: string;
  /** GET with bob's session. */
  getAsBob(path: string): Promise<{ statusCode: number; json: () => unknown }>;
}

/** Builds the app with two identities (alice owns the org, bob does not). */
async function workflowClient(): Promise<WorkflowClient> {
  const { app, repos, store } = await buildTestApp({
    oidc: new MultiIdentityGateway([
      {
        subject: 'sub-alex-123',
        email: 'alex@nexora.dev',
        emailVerified: true,
        displayName: 'Alex Morgan',
        issuer: 'http://keycloak.test/realms/nexora',
      },
      {
        subject: 'sub-bob-456',
        email: 'bob@nexora.dev',
        emailVerified: true,
        displayName: 'Bob Lee',
        issuer: 'http://keycloak.test/realms/nexora',
      },
    ]),
  });

  const alice = await login(app);
  const bob = await login(app);
  return {
    app,
    session: alice,
    bob,
    store,
    repos,
    get(path) {
      return app.inject({ method: 'GET', url: path, headers: { cookie: alice } });
    },
    getAsBob(path) {
      return app
        .inject({ method: 'GET', url: path, headers: { cookie: bob } })
        .then((response) => ({ statusCode: response.statusCode, json: () => response.json() }));
    },
    post(path, body) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: alice, 'content-type': 'application/json' },
        payload: body,
      });
    },
    put(path, body) {
      return app.inject({
        method: 'PUT',
        url: path,
        headers: { cookie: alice, 'content-type': 'application/json' },
        payload: body,
      });
    },
    patch(path, body) {
      return app.inject({
        method: 'PATCH',
        url: path,
        headers: { cookie: alice, 'content-type': 'application/json' },
        payload: body,
      });
    },
    postEmpty(path) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: alice, 'content-type': 'application/json' },
        payload: {},
      });
    },
  };
}

/** The fake resource-assignment repository (in-memory Map). */
function assignments(client: ChatClient): Map<string, ResourceAssignment> {
  return (client.repos.resourceAssignments as unknown as FakeResourceAssignmentRepository)
    .assignments;
}

/** Starts the demo workflow and returns the parsed response. */
async function startWorkflow(
  client: WorkflowClient,
  organizationId: string,
  input: Record<string, unknown> = { projectName: 'Mobile Banking', employeeName: 'Sarah' },
) {
  const response = await client.post('/api/workflows', {
    organizationId,
    definitionKey: WORKFLOW_KEY,
    input,
  });
  return { response, workflow: response.json().workflow as WorkflowRecord };
}

describe('workflow REST routes', () => {
  it('starts the demo workflow and completes it through the governed pipeline', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    // Seed Sarah so the find + assign steps resolve in the trusted tenant.
    await seedEmployee(client.repos, {
      id: 'emp_sarah',
      organizationId,
      name: 'Sarah Chen',
    });
    const projectBefore = (client.repos.projects as FakeProjectRepository).projects.size;

    const { response, workflow } = await startWorkflow(client, organizationId);
    expect(response.statusCode).toBe(201);

    // The instance journaled to a terminal state with the definition key.
    expect(workflow.instance).toMatchObject({
      definitionKey: WORKFLOW_KEY,
      tenantId: organizationId,
      status: 'succeeded',
    });
    expect(workflow.instance.id).toMatch(/^wfi_/);

    // Every step succeeded — create → find → assign, dependencies respected.
    const byStep = new Map(workflow.steps.map((step) => [step.stepId, step]));
    expect(workflow.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(byStep.get('create_project')?.capabilityId).toBe('projects.create_project');
    expect(byStep.get('find_employee')?.capabilityId).toBe('hr.find_employee');
    expect(byStep.get('assign_employee')?.capabilityId).toBe('projects.assign_employee');

    // The business mutation really happened (one execution path).
    const project = [...(client.repos.projects as FakeProjectRepository).projects.values()].find(
      (p) => p.name.value === 'Mobile Banking',
    );
    expect(project).toBeDefined();
    expect(project?.organizationId).toBe(organizationId);
    const assignment = [...assignments(client).values()].find((a) => a.projectId === project?.id);
    expect(assignment).toBeDefined();
    expect(assignment?.employeeId).toBe('emp_sarah');
    expect(projectBefore).toBe(0);
    await client.app.close();
  });

  it('records a FAILED workflow when the employee cannot be assigned (no false success)', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    // No employee named Sarah exists — assign_employee fails, the workflow
    // must report failure (never a misleading success). find_employee
    // returns a "not found" resolution (no fabrication), so the failure
    // surfaces at the assignment step.
    const { response, workflow } = await startWorkflow(client, organizationId);
    expect(response.statusCode).toBe(201);
    expect(workflow.instance.status).toBe('failed');
    expect(workflow.instance.error).toContain('assign_employee');
    const failed = workflow.steps.find((step) => step.status === 'failed');
    expect(failed?.stepId).toBe('assign_employee');
    expect(failed?.error).toContain('No employee named');
    // No assignment was created (no partial success claim).
    expect(assignments(client).size).toBe(0);
    await client.app.close();
  });

  it('runs the flagship HIRE workflow through the operator path (same governed pipeline)', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    // The hire workflow RESOLVES an existing project.
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });
    const employeesBefore = (client.repos.employees as FakeEmployeeRepository).employees.size;

    const response = await client.post('/api/workflows', {
      organizationId,
      definitionKey: 'hr.hire_and_assign_employee',
      input: { employeeName: 'Sarah Chen', projectName: 'Mobile Banking' },
    });
    expect(response.statusCode).toBe(201);
    const workflow = response.json().workflow as WorkflowRecord;

    expect(workflow.instance).toMatchObject({
      definitionKey: 'hr.hire_and_assign_employee',
      tenantId: organizationId,
      status: 'succeeded',
    });
    // Every step succeeded — hire → find project → assign.
    const byStep = new Map(workflow.steps.map((step) => [step.stepId, step]));
    expect(workflow.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(byStep.get('hire_employee')?.capabilityId).toBe('hr.create_employee');
    expect(byStep.get('find_project')?.capabilityId).toBe('projects.find_project');
    expect(byStep.get('assign_employee')?.capabilityId).toBe('projects.assign_employee');

    // The business mutation is real: Sarah is an active employee assigned
    // to the seeded project.
    const employees = [...(client.repos.employees as FakeEmployeeRepository).employees.values()];
    expect(employees.length).toBe(employeesBefore + 1);
    const sarah = employees.find((e) => e.name.value === 'Sarah Chen');
    expect(sarah).toBeDefined();
    expect(sarah?.organizationId).toBe(organizationId);
    expect(sarah?.isActive()).toBe(true);
    const assignment = [...assignments(client).values()].find((a) => a.employeeId === sarah?.id);
    expect(assignment).toBeDefined();
    expect(assignment?.projectId).toBe('prj_12345678-1234-1234-1234-123456789012');
    await client.app.close();
  });

  it('rejects an unknown definition key with 400', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const response = await client.post('/api/workflows', {
      organizationId,
      definitionKey: 'sales.create_quote',
      input: { projectName: 'X', employeeName: 'Y' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await client.app.close();
  });

  it('rejects undeclared input keys (step-id / reserved keys cannot shadow workflow state) with 400', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await seedEmployee(client.repos, { id: 'emp_sarah', organizationId, name: 'Sarah Chen' });
    const projectsBefore = (client.repos.projects as FakeProjectRepository).projects.size;

    // A REST caller trying to pre-seed a step's output (so a later step
    // would consume attacker-chosen data) or the reserved compensation
    // ledger key is refused before any instance or step exists.
    for (const forged of [
      { create_project: { projectId: 'prj_attacker' } },
      { hire_employee: { employeeId: 'emp_attacker' } },
      { __compensations: [{ toolId: 'projects.assign_employee' }] },
    ]) {
      const refused = await client.post('/api/workflows', {
        organizationId,
        definitionKey: WORKFLOW_KEY,
        input: { projectName: 'Mobile Banking', employeeName: 'Sarah Chen', ...forged },
      });
      expect(refused.statusCode).toBe(400);
      expect(JSON.stringify(refused.json())).toContain('undeclared');
    }
    expect((client.repos.projects as FakeProjectRepository).projects.size).toBe(projectsBefore);

    // Positive control: exactly the declared keys start the workflow.
    const accepted = await client.post('/api/workflows', {
      organizationId,
      definitionKey: WORKFLOW_KEY,
      input: { projectName: 'Mobile Banking', employeeName: 'Sarah Chen' },
    });
    expect(accepted.statusCode).toBe(201);
    await client.app.close();
  });

  it('rejects missing workflow input with 400', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const response = await client.post('/api/workflows', {
      organizationId,
      definitionKey: WORKFLOW_KEY,
      input: { projectName: 'Mobile Banking' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await client.app.close();
  });

  it('forbids starting a workflow in an organization the caller does not belong to', async () => {
    const client = await workflowClient();
    await onboardOrgAndWorkspace(client);

    const response = await client.post('/api/workflows', {
      organizationId: 'org_alien',
      definitionKey: WORKFLOW_KEY,
      input: { projectName: 'X', employeeName: 'Y' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    await client.app.close();
  });

  it('lists only the workflows of the requested tenant', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    // A SECOND organization the caller also belongs to — the workflow
    // started in org1 must never appear under org2 (tenant isolation).
    const org2 = await client.post('/api/organizations', {
      name: 'Beta Inc.',
      slug: 'beta',
      type: 'startup',
    });
    expect(org2.statusCode).toBe(201);
    const organization2 = (org2.json().organization as { id: string }).id;
    await seedEmployee(client.repos, { id: 'emp_sarah', organizationId, name: 'Sarah Chen' });
    await startWorkflow(client, organizationId);

    const listed = await client.get(`/api/workflows?organizationId=${organizationId}`);
    expect(listed.statusCode).toBe(200);
    const workflows = listed.json().workflows as WorkflowResponse[];
    expect(workflows.length).toBe(1);
    expect(workflows[0]).toMatchObject({ definitionKey: WORKFLOW_KEY, status: 'succeeded' });

    // The other tenant sees none of org1's workflows (no cross-tenant leak).
    const other = await client.get(`/api/workflows?organizationId=${organization2}`);
    expect(other.statusCode).toBe(200);
    expect(other.json().workflows).toEqual([]);
    await client.app.close();
  });

  it('reads a workflow record and returns 404 for a foreign-tenant id (tenant isolation)', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const org2 = await client.post('/api/organizations', {
      name: 'Beta Inc.',
      slug: 'beta',
      type: 'startup',
    });
    const organization2 = (org2.json().organization as { id: string }).id;
    await seedEmployee(client.repos, { id: 'emp_sarah', organizationId, name: 'Sarah Chen' });
    const { workflow } = await startWorkflow(client, organizationId);
    const workflowId = workflow.instance.id;

    const own = await client.get(`/api/workflows/${workflowId}?organizationId=${organizationId}`);
    expect(own.statusCode).toBe(200);
    expect((own.json().workflow as WorkflowRecord).instance.status).toBe('succeeded');

    // The SAME id queried under another tenant the caller belongs to
    // resolves to NOT FOUND — the journal is never readable across tenants.
    const foreign = await client.get(
      `/api/workflows/${workflowId}?organizationId=${organization2}`,
    );
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

    // A forged id also resolves to NOT FOUND.
    const forged = await client.get(`/api/workflows/wfi_forged?organizationId=${organizationId}`);
    expect(forged.statusCode).toBe(404);
    await client.app.close();
  });

  it('cannot cancel a workflow of another tenant (no cross-tenant control)', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const org2 = await client.post('/api/organizations', {
      name: 'Beta Inc.',
      slug: 'beta',
      type: 'startup',
    });
    const organization2 = (org2.json().organization as { id: string }).id;
    await seedEmployee(client.repos, { id: 'emp_sarah', organizationId, name: 'Sarah Chen' });
    const { workflow } = await startWorkflow(client, organizationId);

    const response = await client.post(
      `/api/workflows/${workflow.instance.id}/cancel?organizationId=${organization2}`,
      {},
    );
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await client.app.close();
  });

  it('refuses to cancel a completed workflow (no silent success)', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await seedEmployee(client.repos, { id: 'emp_sarah', organizationId, name: 'Sarah Chen' });
    const { workflow } = await startWorkflow(client, organizationId);
    expect(workflow.instance.status).toBe('succeeded');

    const response = await client.post(
      `/api/workflows/${workflow.instance.id}/cancel?organizationId=${organizationId}`,
      {},
    );
    expect(response.statusCode).toBe(404);
    await client.app.close();
  });

  it('forbids a non-member from listing or reading workflows', async () => {
    const client = await workflowClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const list = await client.getAsBob(`/api/workflows?organizationId=${organizationId}`);
    expect(list.statusCode).toBe(403);
    const read = await client.getAsBob(`/api/workflows/wfi_any?organizationId=${organizationId}`);
    expect(read.statusCode).toBe(403);
    await client.app.close();
  });

  it('rejects unauthenticated workflow requests with 401', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { 'content-type': 'application/json' },
      payload: {
        organizationId: 'org_1',
        definitionKey: WORKFLOW_KEY,
        input: {},
      },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('workflow cancel ownership scope (Prompt 9)', () => {
  it('an org admin outside the instance workspace cannot cancel another user’s instance; sharing the workspace can', async () => {
    const { WorkflowInstance } = await import('@nexora/module-workflow');
    const client = await workflowClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const alice = currentUserId(client);
    const bobUser = [
      ...(
        client.repos.users as unknown as {
          users: Map<string, { id: string; email: { value: string } }>;
        }
      ).users.values(),
    ].find((user) => user.email.value === 'bob@nexora.dev');
    const bobId = (bobUser as { id: string }).id;
    await seedOrganizationMembership(client.repos, {
      organizationId,
      userId: bobId,
      role: 'admin',
    });
    const cancelAsBob = (id: string) =>
      client.app.inject({
        method: 'POST',
        url: `/api/workflows/${id}/cancel?organizationId=${organizationId}`,
        headers: { cookie: client.bob, 'content-type': 'application/json' },
        payload: {},
      });
    const running = async () => {
      const context = {
        actor: { kind: 'user', id: alice },
        correlationId: 'corr_seed',
        tenantId: organizationId,
      } as never;
      const instance = WorkflowInstance.create(
        {
          definitionId: 'wfd_scope',
          definitionKey: 'scope.test',
          definitionVersion: 1,
          tenantId: organizationId as never,
          userId: alice,
          workspaceId: workspaceId as never,
          correlationId: `corr_${Math.random().toString(16).slice(2)}` as never,
          input: {},
        },
        context,
      );
      instance.plan();
      instance.ready();
      instance.start(context);
      await client.repos.workflowInstances.save(instance);
      return instance.id;
    };

    // Bob holds workflows.execute at the organization level but is not in the workspace.
    const foreign = await running();
    const denied = await cancelAsBob(foreign);
    expect(denied.statusCode).toBe(404);
    // Control: the initiator can cancel it (the instance really was cancellable).
    const own = await client.post(
      `/api/workflows/${foreign}/cancel?organizationId=${organizationId}`,
      {},
    );
    expect(own.statusCode).toBe(200);

    // Control: once Bob shares the instance's workspace he may cancel another user's instance.
    await seedWorkspaceMembership(client.repos, {
      workspaceId,
      userId: bobId,
      role: 'admin',
      organizationId,
    });
    expect((await cancelAsBob(await running())).statusCode).toBe(200);
    await client.app.close();
  });
});
