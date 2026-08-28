/**
 * Backend RBAC enforcement — route coverage guard.
 *
 * Two independent checks so a mutating route can never ship un-gated:
 *
 *  1. COMPLETENESS (static): scan every `apps/api/src/routes/*.ts`, extract
 *     every mutating endpoint (`POST`/`PUT`/`PATCH`/`DELETE`), and assert
 *     each handler either runs the `authorizePermission` seam (directly or
 *     via a `require*Capability` wrapper) OR is on the documented
 *     `ALLOWLIST`. A new mutating route with no capability gate fails here.
 *
 *  2. ENFORCEMENT (runtime): drive the routes closed by this milestone as a
 *     member whose resolved role lacks the required capability, and assert
 *     `403` / `AUTHORIZATION_ERROR` — never a 2xx or 5xx.
 *
 * The per-area with/without/forged/cross-tenant matrix lives in
 * `rbac-backend-enforcement.test.ts`; this file is the tripwire.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedOrganization,
  seedOrganizationMembership,
} from './helpers.js';

const ROUTES_DIR = fileURLToPath(new URL('../src/routes/', import.meta.url));

/** Mutating endpoints that are intentionally NOT capability-gated. */
const ALLOWLIST: ReadonlySet<string> = new Set([
  // Bootstrap: you create your OWN organization — there is no membership yet
  // to resolve a role against. Every later org action is gated.
  'POST /api/organizations',
  // Self-scoped to the caller's own userId (a foreign id 404s); no role can
  // grant or deny marking your own notifications read / your own prefs.
  'POST /api/notifications/:id/read',
  'POST /api/notifications/read-all',
  'PUT /api/notifications/preferences',
  // Membership-gated; every tool the AI can invoke is itself
  // capability-gated and discovery is permission-filtered (the S34
  // boundary — a chat turn is not a privileged action on its own).
  'POST /api/ai/chat',
  // UNAUTHENTICATED signed webhook-in (HMAC over the raw body). No session,
  // so no role — the signature + sender allowlist is the control.
  'POST /api/integrations/email/inbound',
]);

/** Tokens that mean "this handler consulted the RBAC seam". */
const GATE_TOKENS = [
  'authorizePermission(',
  'requireDocumentCapability(',
  'requireKnowledgeCapability(',
];

interface MutatingRoute {
  file: string;
  method: string;
  path: string;
  /** The handler body from this `app.<verb>(` to the next route registration. */
  segment: string;
}

/** Extracts every mutating route + its handler segment from the route files. */
function collectMutatingRoutes(): MutatingRoute[] {
  const found: MutatingRoute[] = [];
  const files = readdirSync(ROUTES_DIR).filter((name) => name.endsWith('.ts'));
  for (const file of files) {
    const source = readFileSync(`${ROUTES_DIR}${file}`, 'utf8');
    // Matches `app.post(` and any encapsulated instance (`inboundApp.post(`).
    const registration = /\b(?:app|[A-Za-z]+App)\.(post|put|patch|delete)\s*\(/gi;
    let match: RegExpExecArray | null;
    const starts: { index: number; method: string }[] = [];
    while ((match = registration.exec(source)) !== null) {
      starts.push({ index: match.index, method: match[1]!.toUpperCase() });
    }
    // Also record GET starts so a mutating handler's segment stops at the
    // next endpoint of ANY verb, not just the next mutating one.
    const anyStart = [
      ...source.matchAll(/\b(?:app|[A-Za-z]+App)\.(get|post|put|patch|delete)\s*\(/gi),
    ].map((m) => m.index ?? 0);
    for (const { index, method } of starts) {
      const after = source.slice(index, index + 300);
      const pathMatch = after.match(/['"`]([^'"`\n]+)['"`]/);
      if (pathMatch === null) {
        continue;
      }
      const nextStart = anyStart.find((i) => i > index) ?? source.length;
      found.push({
        file,
        method,
        path: pathMatch[1]!,
        segment: source.slice(index, nextStart),
      });
    }
  }
  return found;
}

describe('RBAC route coverage — COMPLETENESS (static)', () => {
  const routes = collectMutatingRoutes();

  it('finds a non-trivial number of mutating routes to check', () => {
    // Guards against a broken extractor silently passing everything.
    expect(routes.length).toBeGreaterThan(30);
  });

  it('every mutating route is capability-gated or explicitly allowlisted', () => {
    const ungated = routes.filter((route) => {
      const key = `${route.method} ${route.path}`;
      if (ALLOWLIST.has(key)) {
        return false;
      }
      return !GATE_TOKENS.some((token) => route.segment.includes(token));
    });

    expect(ungated.map((route) => `${route.method} ${route.path}  (${route.file})`)).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const live = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const stale = [...ALLOWLIST].filter((entry) => !live.has(entry));
    expect(stale).toEqual([]);
  });
});

describe('RBAC route coverage — ENFORCEMENT (runtime)', () => {
  /**
   * A member of a `sales` workspace resolves to `growth.sales_manager`,
   * whose set is read-only (projects.read, problems.read, insights.read,
   * agent.use, activity.read) — it holds NONE of integrations.manage /
   * marketplace.manage / problems.investigate / knowledge.publish.
   */
  async function salesMember() {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'sales',
    });
    return { client, organizationId, workspaceId };
  }

  function expectForbidden(response: { statusCode: number; json: () => unknown }) {
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
  }

  it('integrations webhook create → 403 without integrations.manage', async () => {
    const { client, organizationId, workspaceId } = await salesMember();
    expectForbidden(
      await client.post('/api/integrations/webhooks', {
        organizationId,
        workspaceId,
        url: 'https://example.test/hook',
        eventTypes: [],
      }),
    );
    await client.app.close();
  });

  it('marketplace app install → 403 without marketplace.manage', async () => {
    const { client, organizationId, workspaceId } = await salesMember();
    expectForbidden(
      await client.post('/api/marketplace/apps/com.nexora.hr/install', {
        organizationId,
        workspaceId,
        permissionsConfirmed: true,
      }),
    );
    await client.app.close();
  });

  it('remediation plan advance → 403 without problems.investigate', async () => {
    const { client, organizationId, workspaceId } = await salesMember();
    expectForbidden(
      await client.post(
        `/api/plans/plan_none/advance?organizationId=${organizationId}&workspaceId=${workspaceId}`,
        {},
      ),
    );
    await client.app.close();
  });

  it('knowledge article publish → 403 without knowledge.publish', async () => {
    const { client, organizationId, workspaceId } = await salesMember();
    expectForbidden(
      await client.post('/api/knowledge/articles/art_none/publish', {
        organizationId,
        workspaceId,
      }),
    );
    await client.app.close();
  });

  it('workspace create → 403 for a plain org member (no workspaces.create)', async () => {
    const client = await chatClient();
    const organizationId = 'org_rbac_cov_workspaces';
    await seedOrganization(client.repos, { id: organizationId, slug: 'org-rbac-cov-workspaces' });
    await seedOrganizationMembership(client.repos, {
      organizationId,
      userId: currentUserId(client),
      role: 'member',
    });
    expectForbidden(
      await client.post('/api/workspaces', {
        organizationId,
        name: 'Sneaky',
        slug: 'sneaky',
        type: 'engineering',
      }),
    );
    await client.app.close();
  });
});
