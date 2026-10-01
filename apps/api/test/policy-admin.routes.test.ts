/**
 * Prompt 8 — policy administration routes.
 *
 * Personas (the SAME RBAC every surface uses; the org creator is the
 * workspace `owner`, and the workspace type selects the resolved role):
 * - `engineering` -> executive.ceo        : policy.read + policy.manage (+ audit.read)
 * - `finance`     -> finance.cfo          : policy.read ONLY (the read/manage split)
 * - `sales`       -> growth.sales_manager : neither
 */

import { describe, expect, it } from 'vitest';

import { chatClient, onboardOrgAndWorkspace, type ChatClient } from './helpers.js';
import { InMemoryPolicySettingsRepository } from '../src/policy/policy-settings.js';

const LIMIT = 'POLICY_FINANCE_BUDGET_LIMIT';
const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';

interface Scope {
  organizationId: string;
  workspaceId: string;
}

const q = (scope: Scope): string =>
  `organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`;

async function ceo(): Promise<{ client: ChatClient } & Scope> {
  const client = await chatClient();
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
  return { client, organizationId, workspaceId };
}

/** Adds a workspace of another type in the same organization (same user, owner tier). */
async function addWorkspace(
  client: ChatClient,
  organizationId: string,
  type: string,
): Promise<string> {
  const response = await client.post('/api/workspaces', {
    organizationId,
    name: `${type} team`,
    slug: `${type}-team`,
    type,
  });
  expect(response.statusCode).toBe(201);
  return (response.json().workspace as { id: string }).id;
}

const post = (client: ChatClient, scope: Scope, policyId: string, body: unknown) =>
  client.post(
    `/api/policy/policies/${policyId}/versions?${q(scope)}`,
    body as Record<string, unknown>,
  );

describe('policy administration — authentication and scope', () => {
  it('401 without a session', async () => {
    const { client, ...scope } = await ceo();
    const get = await client.app.inject({ method: 'GET', url: `/api/policy/policies?${q(scope)}` });
    expect(get.statusCode).toBe(401);
    const write = await client.app.inject({
      method: 'POST',
      url: `/api/policy/policies/${LIMIT}/versions?${q(scope)}`,
      headers: { 'content-type': 'application/json' },
      payload: { config: { mode: 'deny' } },
    });
    expect(write.statusCode).toBe(401);
  });

  it('400 when the scope query is missing', async () => {
    const { client } = await ceo();
    expect((await client.get('/api/policy/policies')).statusCode).toBe(400);
  });

  it('403 for a foreign organization or a forged workspace (before any RBAC or data)', async () => {
    const { client, organizationId, workspaceId } = await ceo();
    expect(
      (
        await client.get(
          `/api/policy/policies?organizationId=org_alien_0000&workspaceId=${workspaceId}`,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await client.get(
          `/api/policy/policies?organizationId=${organizationId}&workspaceId=wsp_alien_0000`,
        )
      ).statusCode,
    ).toBe(403);
    const forgedWrite = await post(
      client,
      { organizationId: 'org_alien_0000', workspaceId },
      LIMIT,
      { config: { mode: 'deny' } },
    );
    expect(forgedWrite.statusCode).toBe(403);
  });
});

describe('policy administration — read vs manage split', () => {
  it('a CEO lists the registry (configurable + platform-managed) and manages', async () => {
    const { client, ...scope } = await ceo();
    const list = await client.get(`/api/policy/policies?${q(scope)}`);
    expect(list.statusCode).toBe(200);
    const { policies } = list.json() as {
      policies: {
        policyId: string;
        configurable: boolean;
        managedBy: string;
        enabled: boolean;
        ruleVersion: string;
        scope: string;
        currentVersion?: number;
      }[];
    };
    const byId = new Map(policies.map((p) => [p.policyId, p]));
    expect(byId.get(LIMIT)).toMatchObject({
      configurable: true,
      managedBy: 'organization',
      enabled: false,
      scope: 'organization',
    });
    expect(byId.get(LIMIT)?.currentVersion).toBeUndefined();
    expect(byId.get(AUTHORITY)?.configurable).toBe(true);
    expect(byId.get('POLICY_TENANT_ISOLATION')).toMatchObject({
      configurable: false,
      managedBy: 'platform',
      enabled: true,
      ruleVersion: '1',
    });
    expect((await post(client, scope, LIMIT, { config: { mode: 'deny' } })).statusCode).toBe(201);
  });

  it('a CFO reads (policy.read) but cannot manage: 403, nothing written, attempt audited', async () => {
    const { client, organizationId, workspaceId: engWorkspace } = await ceo();
    const finance = {
      organizationId,
      workspaceId: await addWorkspace(client, organizationId, 'finance'),
    };

    expect((await client.get(`/api/policy/policies?${q(finance)}`)).statusCode).toBe(200);
    expect(
      (await client.get(`/api/policy/policies/${LIMIT}/history?${q(finance)}`)).statusCode,
    ).toBe(200);
    const denied = await post(client, finance, LIMIT, { config: { mode: 'deny' } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });

    // Nothing was written (read as the CEO).
    const history = await client.get(
      `/api/policy/policies/${LIMIT}/history?${q({ organizationId, workspaceId: engWorkspace })}`,
    );
    expect((history.json() as { versions: unknown[] }).versions).toEqual([]);

    // The refused mutation is in the audit trail (blocked, no config values).
    const audit = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${engWorkspace}`,
    );
    const events = (
      audit.json() as {
        events: { action: string; status: string; detail?: string; module: string }[];
      }
    ).events;
    const refusal = events.find((e) => e.action.startsWith('Policy administration denied'));
    expect(refusal).toMatchObject({ status: 'blocked', module: 'Policy' });
    expect(refusal?.detail).toContain('action: manage');
    expect(refusal?.detail).toContain('required capability: policy.manage');
    expect(refusal?.detail).not.toContain('deny');
  });

  it('a role with neither capability gets 403 on reads AND writes, both audited', async () => {
    const { client, organizationId, workspaceId: engWorkspace } = await ceo();
    const sales = {
      organizationId,
      workspaceId: await addWorkspace(client, organizationId, 'sales'),
    };
    expect((await client.get(`/api/policy/policies?${q(sales)}`)).statusCode).toBe(403);
    expect((await client.get(`/api/policy/policies/${LIMIT}/history?${q(sales)}`)).statusCode).toBe(
      403,
    );
    expect((await post(client, sales, LIMIT, { enabled: false })).statusCode).toBe(403);
    const audit = await client.get(
      `/api/audit/events?organizationId=${organizationId}&workspaceId=${engWorkspace}`,
    );
    const details = (audit.json() as { events: { action: string; detail?: string }[] }).events
      .filter((e) => e.action.startsWith('Policy administration denied'))
      .map((e) => e.detail ?? '');
    expect(details.some((d) => d.includes('action: read') && d.includes('policy.read'))).toBe(true);
    expect(details.some((d) => d.includes('action: manage') && d.includes('policy.manage'))).toBe(
      true,
    );
  });

  it('forged role/capability claims in query or body never grant access', async () => {
    const { client, organizationId } = await ceo();
    const sales = {
      organizationId,
      workspaceId: await addWorkspace(client, organizationId, 'sales'),
    };
    const forgedRead = await client.get(
      `/api/policy/policies?${q(sales)}&role=executive.ceo&capability=policy.read`,
    );
    expect(forgedRead.statusCode).toBe(403);
    const forgedWrite = await client.post(
      `/api/policy/policies/${LIMIT}/versions?${q(sales)}&role=executive.ceo`,
      { config: { mode: 'deny' }, role: 'executive.ceo' },
    );
    expect(forgedWrite.statusCode).toBe(403);
  });
});

describe('policy administration — 404 / 422 / 409', () => {
  it('unknown policy id -> 404 on history and on write', async () => {
    const { client, ...scope } = await ceo();
    expect(
      (await client.get(`/api/policy/policies/POLICY_NOPE/history?${q(scope)}`)).statusCode,
    ).toBe(404);
    expect((await post(client, scope, 'POLICY_NOPE', { config: {} })).statusCode).toBe(404);
  });

  it('a platform-managed policy cannot be configured: 422 POLICY_NOT_CONFIGURABLE', async () => {
    const { client, ...scope } = await ceo();
    const response = await post(client, scope, 'POLICY_TENANT_ISOLATION', { config: { any: 1 } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'POLICY_NOT_CONFIGURABLE' } });
    const history = await client.get(
      `/api/policy/policies/POLICY_TENANT_ISOLATION/history?${q(scope)}`,
    );
    expect(history.json()).toMatchObject({ versions: [] });
  });

  it('expectedVersion mismatch -> 409 and nothing is written', async () => {
    const { client, ...scope } = await ceo();
    const conflict = await post(client, scope, LIMIT, {
      config: { mode: 'deny' },
      expectedVersion: 4,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: 'POLICY_VERSION_CONFLICT', currentVersion: 0 },
    });
    expect(
      (await post(client, scope, LIMIT, { config: { mode: 'deny' }, expectedVersion: 0 }))
        .statusCode,
    ).toBe(201);
    // A stale writer (still believes 0) now conflicts.
    const stale = await post(client, scope, LIMIT, {
      config: { mode: 'require_approval' },
      expectedVersion: 0,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { currentVersion: 1 } });
    const fresh = await post(client, scope, LIMIT, {
      config: { mode: 'require_approval' },
      expectedVersion: 1,
    });
    expect(fresh.statusCode).toBe(201);
    expect(fresh.json()).toMatchObject({ version: { version: 2 } });
  });

  it('malformed bodies -> 400 (unknown field, wrong types, empty)', async () => {
    const { client, ...scope } = await ceo();
    for (const body of [
      {},
      { config: { mode: 'deny' }, extra: 1 },
      { enabled: 'yes' },
      { config: { mode: 'deny' }, reason: 'x'.repeat(501) },
      { config: { mode: 'deny' }, expectedVersion: -1 },
      { config: { mode: 'deny' }, expectedVersion: 1.5 },
    ]) {
      expect((await post(client, scope, LIMIT, body)).statusCode).toBe(400);
    }
    expect(
      (await client.post(`/api/policy/policies/${LIMIT}/versions?${q(scope)}`, [] as never))
        .statusCode,
    ).toBe(400);
  });
});

describe('policy administration — configuration is data, never code', () => {
  const marker = 'zz_marker_value';
  const cases: [string, string, unknown][] = [
    ['unknown key', LIMIT, { mode: 'deny', extra: true }],
    ['wrong type', LIMIT, { mode: 7 }],
    ['not an object', LIMIT, 'deny'],
    ['enum violation', LIMIT, { mode: marker }],
    ['unknown key (authority)', AUTHORITY, { rules: [], surprise: 1 }],
    ['rules not an array', AUTHORITY, { rules: 'x' }],
    ['ttl wrong type', AUTHORITY, { rules: [{ capabilityPrefix: 'calendar.', ttlMinutes: '5' }] }],
    [
      'ttl out of range',
      AUTHORITY,
      { rules: [{ capabilityPrefix: 'calendar.', ttlMinutes: 999999 }] },
    ],
    [
      'template expression',
      AUTHORITY,
      { rules: [{ capabilityPrefix: 'calendar.', requiredApproverRoleId: '${process.env.X}' }] },
    ],
    ['mustache', AUTHORITY, { rules: [{ capabilityPrefix: '{{marker}}' }] }],
    ['shell substitution', AUTHORITY, { rules: [{ capabilityPrefix: 'a$(id)' }] }],
    [
      'script tag',
      AUTHORITY,
      { rules: [{ capabilityPrefix: 'calendar.', requiredApproverRoleId: '<script>x' }] },
    ],
    ['sql comment', AUTHORITY, { rules: [{ capabilityPrefix: 'calendar.--x' }] }],
    ['semicolon', AUTHORITY, { rules: [{ capabilityPrefix: 'calendar.;x' }] }],
    ['backtick', AUTHORITY, { rules: [{ capabilityPrefix: '`ls`' }] }],
    ['newline', AUTHORITY, { rules: [{ capabilityPrefix: 'calendar.\nx' }] }],
    ['executable key', AUTHORITY, { 'a;b': 1, rules: [] }],
    [
      'too many rules',
      AUTHORITY,
      { rules: Array.from({ length: 21 }, (_, i) => ({ capabilityPrefix: `cap${i}.` })) },
    ],
    [
      'oversized',
      AUTHORITY,
      { rules: [{ capabilityPrefix: 'calendar.', requiredApproverRoleId: 'a'.repeat(9000) }] },
    ],
    [
      'too deep',
      AUTHORITY,
      { rules: [{ capabilityPrefix: 'calendar.', nested: { a: { b: { c: 1 } } } }] },
    ],
  ];
  for (const [name, policyId, config] of cases) {
    it(`rejects ${name}: 422 POLICY_CONFIG_INVALID, nothing written, no value echoed`, async () => {
      const { client, ...scope } = await ceo();
      const response = await post(client, scope, policyId, { config });
      expect(response.statusCode).toBe(422);
      const body = response.json() as { error: { code: string; errors: string[] } };
      expect(body.error.code).toBe('POLICY_CONFIG_INVALID');
      expect(body.error.errors.length).toBeGreaterThan(0);
      const text = JSON.stringify(body);
      expect(text).not.toContain(marker);
      expect(text).not.toContain('process.env');
      expect(text).not.toContain('ls`');
      const history = await client.get(`/api/policy/policies/${policyId}/history?${q(scope)}`);
      expect((history.json() as { versions: unknown[] }).versions).toEqual([]);
    });
  }

  it('the normalized configuration is what gets stored (allow-listed keys only)', async () => {
    const { client, ...scope } = await ceo();
    const response = await post(client, scope, AUTHORITY, {
      config: {
        rules: [{ capabilityPrefix: 'calendar.', separationOfDuties: true, ttlMinutes: 30 }],
      },
      reason: '  tighten calendar  ',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().version).toMatchObject({
      version: 1,
      enabled: true,
      changeType: 'created',
      reason: 'tighten calendar',
      config: {
        rules: [{ capabilityPrefix: 'calendar.', separationOfDuties: true, ttlMinutes: 30 }],
      },
    });
    const list = await client.get(`/api/policy/policies?${q(scope)}`);
    const authority = (
      list.json() as {
        policies: { policyId: string; approval?: unknown; currentVersion?: number }[];
      }
    ).policies.find((p) => p.policyId === AUTHORITY);
    expect(authority).toMatchObject({
      currentVersion: 1,
      approval: { separationOfDuties: true, requiredApproverRoleIds: [], ttlMinutes: 30 },
    });
  });
});

describe('policy administration — versions are immutable; enable/disable are new versions', () => {
  it('a new version never rewrites history; history is newest first with names and hashes', async () => {
    const { client, ...scope } = await ceo();
    const v1 = (
      await post(client, scope, LIMIT, { config: { mode: 'deny' }, reason: 'first' })
    ).json().version;
    const v2 = (await post(client, scope, LIMIT, { config: { mode: 'require_approval' } })).json()
      .version;
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(v1.fingerprint).not.toBe(v2.fingerprint);
    const history = (
      await client.get(`/api/policy/policies/${LIMIT}/history?${q(scope)}`)
    ).json() as {
      policyId: string;
      versions: { version: number; config: unknown; createdByName?: string; reason?: string }[];
    };
    expect(history.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(history.versions[1]).toMatchObject({ config: { mode: 'deny' }, reason: 'first' });
    expect(history.versions[1]?.createdByName).toBeTruthy();
  });

  it('the repository exposes no update or delete', () => {
    const methods = Object.getOwnPropertyNames(InMemoryPolicySettingsRepository.prototype).sort();
    expect(methods).toEqual(['append', 'constructor', 'current', 'get', 'history', 'listCurrent']);
  });

  it('enable/disable create NEW versions copying the previous configuration', async () => {
    const { client, ...scope } = await ceo();
    // No configuration yet: an enable/disable alone is refused.
    expect((await post(client, scope, LIMIT, { enabled: false })).statusCode).toBe(422);

    await post(client, scope, LIMIT, { config: { mode: 'deny' } });
    const disabled = await post(client, scope, LIMIT, { enabled: false, reason: 'pause' });
    expect(disabled.statusCode).toBe(201);
    expect(disabled.json().version).toMatchObject({
      version: 2,
      enabled: false,
      changeType: 'disabled',
      config: { mode: 'deny' },
    });
    // No-op toggles are refused.
    expect((await post(client, scope, LIMIT, { enabled: false })).statusCode).toBe(422);
    const enabled = await post(client, scope, LIMIT, { enabled: true });
    expect(enabled.json().version).toMatchObject({
      version: 3,
      enabled: true,
      changeType: 'enabled',
    });
    // The configuration hash is unchanged by toggles.
    expect(enabled.json().version.fingerprint).toBe(disabled.json().version.fingerprint);

    const list = await client.get(`/api/policy/policies?${q(scope)}`);
    const limit = (
      list.json() as { policies: { policyId: string; enabled: boolean; currentVersion: number }[] }
    ).policies.find((p) => p.policyId === LIMIT);
    expect(limit).toMatchObject({ enabled: true, currentVersion: 3 });
    const history = (
      await client.get(`/api/policy/policies/${LIMIT}/history?${q(scope)}`)
    ).json() as {
      versions: { version: number; enabled: boolean; changeType: string }[];
    };
    expect(history.versions.map((v) => [v.version, v.enabled, v.changeType])).toEqual([
      [3, true, 'enabled'],
      [2, false, 'disabled'],
      [1, true, 'created'],
    ]);
  });

  it('a config change together with enabled:false is a normal version of a disabled policy', async () => {
    const { client, ...scope } = await ceo();
    await post(client, scope, LIMIT, { config: { mode: 'deny' } });
    const changed = await post(client, scope, LIMIT, {
      config: { mode: 'require_approval' },
      enabled: true,
    });
    expect(changed.json().version).toMatchObject({
      version: 2,
      changeType: 'version',
      enabled: true,
    });
  });
});

describe('policy administration — tenant isolation', () => {
  it("one organization's configuration is invisible to (and unwritable by) another", async () => {
    const { client, ...scopeA } = await ceo();
    await post(client, scopeA, LIMIT, { config: { mode: 'deny' } });

    const orgB = await client.post('/api/organizations', {
      name: 'Beta Inc.',
      slug: 'beta',
      type: 'startup',
    });
    expect(orgB.statusCode).toBe(201);
    const organizationId = (orgB.json().organization as { id: string }).id;
    const wsB = await client.post('/api/workspaces', {
      organizationId,
      name: 'Eng B',
      slug: 'eng-b',
      type: 'engineering',
    });
    const scopeB = { organizationId, workspaceId: (wsB.json().workspace as { id: string }).id };

    const listB = (await client.get(`/api/policy/policies?${q(scopeB)}`)).json() as {
      policies: { policyId: string; currentVersion?: number; enabled: boolean }[];
    };
    expect(listB.policies.find((p) => p.policyId === LIMIT)).toMatchObject({ enabled: false });
    expect(listB.policies.find((p) => p.policyId === LIMIT)?.currentVersion).toBeUndefined();
    const historyB = (
      await client.get(`/api/policy/policies/${LIMIT}/history?${q(scopeB)}`)
    ).json() as {
      versions: unknown[];
    };
    expect(historyB.versions).toEqual([]);

    // Org B writes its own version 1; org A's history is untouched.
    const b1 = await post(client, scopeB, LIMIT, { config: { mode: 'require_approval' } });
    expect(b1.json().version).toMatchObject({ version: 1 });
    const historyA = (
      await client.get(`/api/policy/policies/${LIMIT}/history?${q(scopeA)}`)
    ).json() as {
      versions: { config: unknown }[];
    };
    expect(historyA.versions).toHaveLength(1);
    expect(historyA.versions[0]?.config).toEqual({ mode: 'deny' });

    // Mixing org A with a workspace of org B (or vice versa) is refused.
    const mixed = await client.get(
      `/api/policy/policies?organizationId=${scopeA.organizationId}&workspaceId=${scopeB.workspaceId}`,
    );
    expect(mixed.statusCode).toBe(403);
  });
});

describe('policy administration — audit events', () => {
  it('version/enable/disable events appear in /api/audit/events with hashes and no config values', async () => {
    const { client, ...scope } = await ceo();
    const secretPrefix = 'zzsecret.prefix.';
    const created = await post(client, scope, AUTHORITY, {
      config: { rules: [{ capabilityPrefix: secretPrefix, separationOfDuties: true }] },
    });
    const hash = created.json().version.fingerprint as string;
    await post(client, scope, AUTHORITY, { enabled: false });
    await post(client, scope, AUTHORITY, { enabled: true });
    await post(client, scope, AUTHORITY, {
      config: { rules: [{ capabilityPrefix: secretPrefix, ttlMinutes: 5 }] },
    });

    const audit = await client.get(`/api/audit/events?${q(scope)}&limit=100`);
    expect(audit.statusCode).toBe(200);
    const events = (
      audit.json() as {
        events: {
          action: string;
          detail?: string;
          module: string;
          status: string;
          actorName: string;
        }[];
      }
    ).events.filter((e) => e.module === 'Policy');
    const titles = events.map((e) => e.action);
    expect(titles).toEqual(
      expect.arrayContaining([
        `Policy version created: ${AUTHORITY} v1`,
        `Policy disabled: ${AUTHORITY} v2`,
        `Policy enabled: ${AUTHORITY} v3`,
        `Policy version created: ${AUTHORITY} v4`,
      ]),
    );
    const first = events.find((e) => e.action.endsWith('v1'));
    expect(first?.detail).toContain(`config hash: ${hash}`);
    expect(first?.detail).toContain('change type: created');
    expect(first?.detail).toContain(`policy: ${AUTHORITY}`);
    expect(first?.actorName).not.toMatch(/^usr_/);
    // Never configuration values.
    expect(JSON.stringify(events)).not.toContain(secretPrefix);
    expect(JSON.stringify(events)).not.toContain('separationOfDuties');
  });
});
