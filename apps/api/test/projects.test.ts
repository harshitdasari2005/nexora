/**
 * Projects REST API tests (`fastify.inject`): create + list with membership
 * gating, tenant isolation, validation, and unauthenticated rejection.
 */

import { describe, expect, it } from 'vitest';
import type { OidcIdentity } from '../src/oidc/gateway.js';

import { FakeOidcGateway } from './fakes.js';
import type { FakeProjectRepository } from './fakes.js';
import {
  buildTestApp,
  chatClient,
  login,
  onboardOrgAndWorkspace,
  seedProject,
  type ChatClient,
} from './helpers.js';

/** A gateway that issues sessions for each identity in turn. */
class MultiIdentityGateway extends FakeOidcGateway {
  readonly #identities: readonly OidcIdentity[];
  #index = 0;

  constructor(identities: readonly OidcIdentity[]) {
    super(identities[0]);
    this.#identities = identities;
  }

  override async exchangeCode(): Promise<OidcIdentity> {
    const identity = this.#identities[this.#index % this.#identities.length]!;
    this.#index += 1;
    return identity;
  }
}

/** POST /api/projects as a second logged-in user (bob). */
async function postAs(
  client: ChatClient & { bob?: string },
  path: string,
  body: Record<string, unknown>,
) {
  if (client.bob === undefined) {
    throw new Error('bob session missing');
  }
  return client.app.inject({
    method: 'POST',
    url: path,
    headers: { cookie: client.bob, 'content-type': 'application/json' },
    payload: body,
  });
}

async function twoUserClient() {
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
    client: {
      app,
      session: alice,
      bob,
      store,
      repos,
      get: (path: string) => app.inject({ method: 'GET', url: path, headers: { cookie: alice } }),
      post: (path: string, body: Record<string, unknown>) =>
        app.inject({
          method: 'POST',
          url: path,
          headers: { cookie: alice, 'content-type': 'application/json' },
          payload: body,
        }),
    } as ChatClient & { bob: string },
  };
}

describe('POST /api/projects', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      payload: { organizationId: 'org_1', name: 'Mobile Banking' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('creates a project in an organization the caller belongs to', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const response = await client.post('/api/projects', {
      organizationId,
      name: 'Mobile Banking',
      description: 'Core banking app',
    });
    expect(response.statusCode).toBe(201);
    const project = response.json().project as {
      id: string;
      name: string;
      status: string;
      organizationId: string;
      description?: string;
    };
    expect(project.id).toMatch(/^prj_/);
    expect(project.name).toBe('Mobile Banking');
    expect(project.status).toBe('active');
    expect(project.organizationId).toBe(organizationId);
    expect(project.description).toBe('Core banking app');
    await client.app.close();
  });

  it('rejects a caller who is not a member of the organization (403)', async () => {
    const { client } = await twoUserClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const response = await postAs(client, '/api/projects', {
      organizationId,
      name: 'Alien Project',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    // Nothing was created.
    expect((client.repos.projects as FakeProjectRepository).projects.size).toBe(0);
    await client.app.close();
  });

  it('rejects an empty name with a validation error', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const response = await client.post('/api/projects', { organizationId, name: '  ' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await client.app.close();
  });

  it('rejects an over-long name (400)', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const response = await client.post('/api/projects', {
      organizationId,
      name: 'x'.repeat(81),
    });
    expect(response.statusCode).toBe(400);
    await client.app.close();
  });

  it('ignores forged identity fields in the body (identity stays server-side)', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const response = await client.post('/api/projects', {
      organizationId,
      name: 'Mobile Banking',
      // The client can never set identity or tenant — the route only reads
      // the trusted session and the body's business fields.
      userId: 'usr_hacker',
      tenantId: 'org_alien',
      actorId: 'usr_hacker',
    });
    expect(response.statusCode).toBe(201);
    const project = response.json().project as { organizationId: string; id: string };
    expect(project.organizationId).toBe(organizationId);
    // The project is owned by the trusted tenant, not the forged one.
    const stored = [...(client.repos.projects as FakeProjectRepository).projects.values()].find(
      (p) => p.id === project.id,
    );
    expect(stored?.organizationId).toBe(organizationId);
    await client.app.close();
  });

  it('requires the organizationId field', async () => {
    const client = await chatClient();
    const response = await client.post('/api/projects', { name: 'Mobile Banking' });
    expect(response.statusCode).toBe(400);
    await client.app.close();
  });

  it('surfaces domain validation failures safely', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const response = await client.post('/api/projects', {
      organizationId,
      name: 'x'.repeat(200),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await client.app.close();
  });
});

describe('GET /api/projects', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/projects?organizationId=org_1' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('requires the organizationId query parameter', async () => {
    const client = await chatClient();
    const response = await client.get('/api/projects');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await client.app.close();
  });

  it('lists the caller’s organization projects', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await client.post('/api/projects', { organizationId, name: 'Mobile Banking' });
    await client.post('/api/projects', { organizationId, name: 'Payroll' });

    const response = await client.get(`/api/projects?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    const projects = response.json().projects as { name: string }[];
    expect(projects.map((project) => project.name).sort()).toEqual(['Mobile Banking', 'Payroll']);
    await client.app.close();
  });

  it('returns an empty list for an organization with no projects', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const response = await client.get(`/api/projects?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().projects).toEqual([]);
    await client.app.close();
  });

  it('does not leak another tenant’s projects (tenant isolation)', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await seedProject(client.repos, {
      id: 'prj_11111111-1111-4111-8111-111111111111',
      organizationId: 'org_alien',
      name: 'Alien Project',
    });
    const response = await client.get(`/api/projects?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    const names = (response.json().projects as { name: string }[]).map((p) => p.name);
    expect(names).not.toContain('Alien Project');
    await client.app.close();
  });

  it('rejects listing a foreign organization the caller does not belong to', async () => {
    const client = await chatClient();
    const response = await client.get('/api/projects?organizationId=org_alien');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    await client.app.close();
  });
});
