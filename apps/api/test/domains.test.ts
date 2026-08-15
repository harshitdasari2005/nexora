/**
 * S24 Phase 1 — Domain → Role → Capability discovery API tests
 * (`fastify.inject`):
 *
 * - `GET /api/domains` returns the registered business domains (with their
 *   roles) and the global capability vocabulary for the authenticated user.
 * - The response is DEFINITIONS ONLY: it contains no tenant/workspace/user
 *   context and no authorization fields (permissions, scopes, approver,
 *   level) — the catalog grants nothing (ROLE ≠ PERMISSION).
 * - Unauthenticated access resolves to 401.
 * - The endpoint takes no scope parameters — there is no tenant or workspace
 *   to forge; definitions are platform-global static vocabulary.
 */

import { describe, expect, it } from 'vitest';
import type { DomainCatalogView } from '@nexora/module-domains';

import { chatClient } from './helpers.js';

describe('GET /api/domains', () => {
  it('returns the registered domains with their roles and the capability vocabulary', async () => {
    const client = await chatClient();

    const response = await client.get('/api/domains');

    expect(response.statusCode).toBe(200);
    const body = response.json() as DomainCatalogView;

    // The 8 initial domains with their roles.
    const domainIds = body.domains.map((domain) => domain.id);
    expect(domainIds).toEqual([
      'executive',
      'finance',
      'people',
      'technology',
      'security',
      'growth',
      'product',
      'delivery',
    ]);
    const technology = body.domains.find((domain) => domain.id === 'technology');
    expect(technology?.roles.map((role) => role.id)).toEqual([
      'technology.cto',
      'technology.engineering_manager',
      'technology.developer',
    ]);
    expect(
      body.domains.find((domain) => domain.id === 'people')?.roles.map((role) => role.id),
    ).toEqual(['people.hr']);

    // The 13 initial capabilities.
    expect(body.capabilities.map((capability) => capability.id)).toEqual([
      'projects.read',
      'projects.create',
      'projects.update',
      'documents.read',
      'documents.upload',
      'knowledge.read',
      'knowledge.publish',
      'employees.read',
      'employees.manage',
      'workflows.read',
      'workflows.execute',
      'approvals.read',
      'approvals.create',
    ]);
  });

  it('exposes definitions only — no tenant, workspace, user, or authorization fields', async () => {
    const client = await chatClient();

    const response = await client.get('/api/domains');
    expect(response.statusCode).toBe(200);

    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain('tenantId');
    expect(serialized).not.toContain('workspaceId');
    expect(serialized).not.toContain('organizationId');
    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('permissions');
    expect(serialized).not.toContain('scopes');
    expect(serialized).not.toContain('approver');
    expect(serialized).not.toContain('"level"');
  });

  it('rejects unauthenticated access with 401', async () => {
    const client = await chatClient();

    const response = await client.app.inject({ method: 'GET', url: '/api/domains' });

    expect(response.statusCode).toBe(401);
  });
});
