/**
 * Prompt 7 — runtime observability routes (`/api/ops/runtime/*`) at the API
 * boundary. Chat runs are recorded by the real orchestrator + telemetry hub;
 * the routes read the append-only run store. Covers the read model (list /
 * detail timeline / metrics), filters, the org + workspace + `audit.read`
 * authorization model, tenant isolation (a foreign run id is a 404 identical
 * to a missing one) and the "no secrets / no prompts" contract.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { findForbiddenKeys, findSecrets, RUNTIME_STAGES } from '@nexora/module-observability';
import {
  DEFAULT_POLICY_RULES,
  PolicyEngine,
  type PolicyRequest,
  type PolicyRule,
} from '@nexora/module-policy';

import { MultiIdentityGateway } from './fakes.js';
import {
  buildTestApp,
  chatClient,
  currentUserId,
  login,
  onboardOrgAndWorkspace,
  parseSse,
  type ChatClient,
} from './helpers.js';

interface RunRow {
  id: string;
  requestId?: string;
  tenantId: string;
  workspaceId?: string;
  actorId: string;
  origin: string;
  status: string;
  durationMs: number;
  model?: string;
  provider?: string;
  failure?: { stage: string; code: string; class: string };
  approval?: { approvalId: string; state: string; waitMs?: number; decision?: string };
  stages: { stage: string; durationMs: number; count: number }[];
}

interface Detail {
  run: RunRow;
  timeline: { stage: string; durationMs: number; status: string; items: unknown[] }[];
  bottleneck: unknown;
}

const open: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  for (const item of open.splice(0)) {
    try {
      await item.close();
    } catch {
      // already closed
    }
  }
});

const scope = (organizationId: string, workspaceId: string) =>
  `organizationId=${organizationId}&workspaceId=${workspaceId}`;

async function chat(client: ChatClient, message: string, workspaceId: string, headers = {}) {
  const raw = await client.app.inject({
    method: 'POST',
    url: '/api/ai/chat',
    headers: { cookie: client.session, 'content-type': 'application/json', ...headers },
    payload: { message, workspaceId },
  });
  expect(raw.statusCode).toBe(200);
  const events = parseSse(raw.body as string);
  const done = events.find((event) => event.event === 'done')?.data as {
    status: string;
    approvals: { id?: string }[];
  };
  return done;
}

async function runs(client: ChatClient, org: string, ws: string, extra = ''): Promise<RunRow[]> {
  const response = await client.get(`/api/ops/runtime/runs?${scope(org, ws)}${extra}`);
  expect(response.statusCode).toBe(200);
  return (response.json() as { runs: RunRow[] }).runs;
}

async function fixture() {
  const client = await chatClient();
  open.push(client.app);
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
  return { client, organizationId, workspaceId };
}

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** Wraps a session cookie as a ChatClient over an existing app. */
function asClient(
  app: TestApp['app'],
  repos: TestApp['repos'],
  store: TestApp['store'],
  session: string,
): ChatClient {
  const send = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    app.inject({
      method,
      url,
      headers: { cookie: session, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload }),
    });
  return {
    app,
    session,
    store,
    repos,
    get: (path) => app.inject({ method: 'GET', url: path, headers: { cookie: session } }),
    post: (path, body) => send('POST', path, body),
    postEmpty: (path) => send('POST', path, {}),
    put: (path, body) => send('POST', path, body),
    patch: (path, body) => send('POST', path, body),
  };
}

/** Two users (alice, bob), each with their own organization + workspace. */
async function twoTenants() {
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
  open.push(app);
  const make = (session: string): ChatClient => asClient(app, repos, store, session);
  const alice = make(await login(app));
  const bob = make(await login(app));
  const a = await onboardOrgAndWorkspace(alice);
  const orgB = await bob.post('/api/organizations', {
    name: 'Bravo Inc.',
    slug: 'bravo',
    type: 'startup',
  });
  expect(orgB.statusCode).toBe(201);
  const bOrg = (orgB.json().organization as { id: string }).id;
  const wsB = await bob.post('/api/workspaces', {
    organizationId: bOrg,
    name: 'Ops',
    slug: 'ops',
    type: 'engineering',
  });
  expect(wsB.statusCode).toBe(201);
  const b = { organizationId: bOrg, workspaceId: (wsB.json().workspace as { id: string }).id };
  return { alice, bob, a, b };
}

describe('runtime observability routes — read model', () => {
  it('a chat request records a run readable through GET /runs', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    const done = await chat(client, 'What workspaces do I have?', workspaceId);
    expect(done.status).toBe('completed');

    const rows = await runs(client, organizationId, workspaceId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      status: 'completed',
      origin: 'chat',
      tenantId: organizationId,
      workspaceId,
      actorId: currentUserId(client),
    });
    expect(row.id).toMatch(/^run_/);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    // model/provider columns are present-or-absent, never fabricated blanks.
    expect(row.model === undefined || typeof row.model === 'string').toBe(true);
    expect(row.provider === undefined || typeof row.provider === 'string').toBe(true);
  });

  it('detail returns the timeline in stage order with only recorded stages + bottleneck', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    await chat(client, 'What workspaces do I have?', workspaceId);
    const [row] = await runs(client, organizationId, workspaceId);

    const response = await client.get(
      `/api/ops/runtime/runs/${row!.id}?${scope(organizationId, workspaceId)}`,
    );
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Detail;
    expect(detail.run.id).toBe(row!.id);
    expect(detail).toHaveProperty('bottleneck');

    const order = detail.timeline.map((entry) => entry.stage);
    expect(order.length).toBeGreaterThan(0);
    const indexes = order.map((stage) => (RUNTIME_STAGES as readonly string[]).indexOf(stage));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect([...indexes].sort((x, y) => x - y)).toEqual(indexes);
    // Only stages the run actually recorded (nothing invented).
    const recorded = new Set(detail.run.stages.map((stage) => stage.stage));
    for (const stage of order) {
      expect(recorded.has(stage)).toBe(true);
    }
    expect(order).toContain('EXECUTION');
    expect(order).not.toContain('APPROVAL');
  });

  it('the run requestId equals the HTTP request id', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    // Fastify ids are sequential (`req-<base36 counter>`) per instance; a 400 from
    // the ops route echoes its own request id, so probing before and after a chat
    // brackets the chat's id exactly.
    const probe = async () => {
      const response = await client.get('/api/ops/runtime/runs');
      const id = (response.json() as { error: { requestId: string } }).error.requestId;
      expect(id).toMatch(/^req-[0-9a-z]+$/);
      return parseInt(id.slice('req-'.length), 36);
    };
    const before = await probe();
    await chat(client, 'What workspaces do I have?', workspaceId);
    const after = await probe();
    expect(after).toBe(before + 2);
    const expected = `req-${(before + 1).toString(36)}`;

    const [row] = await runs(client, organizationId, workspaceId);
    expect(row!.requestId).toBe(expected);
    const byId = await runs(client, organizationId, workspaceId, `&requestId=${expected}`);
    expect(byId.map((r) => r.id)).toEqual([row!.id]);
    expect(await runs(client, organizationId, workspaceId, '&requestId=req-nope')).toEqual([]);
  });

  it('filters by status and failureStage/failureClass (and limit)', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    await chat(client, 'What workspaces do I have?', workspaceId); // completed
    await chat(client, 'Create a workspace called Payroll', workspaceId); // blocked (approval)
    await chat(client, 'Create a workspace', workspaceId); // failed (invalid input)

    const all = await runs(client, organizationId, workspaceId);
    expect(all.map((row) => row.status).sort()).toEqual(['blocked', 'completed', 'failed']);

    expect(await runs(client, organizationId, workspaceId, '&status=completed')).toHaveLength(1);
    expect(await runs(client, organizationId, workspaceId, '&status=blocked')).toHaveLength(1);
    const failed = await runs(client, organizationId, workspaceId, '&status=failed');
    expect(failed).toHaveLength(1);
    const stage = failed[0]!.failure!.stage;
    const byStage = await runs(client, organizationId, workspaceId, `&failureStage=${stage}`);
    expect(byStage.map((row) => row.id)).toEqual([failed[0]!.id]);
    expect(await runs(client, organizationId, workspaceId, '&failureStage=NARRATION')).toHaveLength(
      0,
    );
    expect(
      await runs(client, organizationId, workspaceId, `&failureClass=${failed[0]!.failure!.class}`),
    ).toHaveLength(1);
    expect(await runs(client, organizationId, workspaceId, '&limit=2')).toHaveLength(2);
    expect(await runs(client, organizationId, workspaceId, '&origin=mcp')).toHaveLength(0);
  });

  it('metrics returns window + scope + summary', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    await chat(client, 'What workspaces do I have?', workspaceId);
    const response = await client.get(
      `/api/ops/runtime/metrics?${scope(organizationId, workspaceId)}`,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      window: { from: string; to: string };
      scope: { tenantId: string };
      truncated: boolean;
      summary: Record<string, unknown>;
    };
    expect(new Date(body.window.from).getTime()).toBeLessThan(new Date(body.window.to).getTime());
    expect(body.scope.tenantId).toBe(organizationId);
    expect(body.truncated).toBe(false);
    expect(body.summary).toBeTypeOf('object');
    expect(JSON.stringify(body.summary)).not.toBe('{}');
  });
});

describe('runtime observability routes — authorization', () => {
  it('unauthenticated requests are rejected with 401', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    for (const path of ['/runs', '/runs/run_x', '/metrics']) {
      const response = await client.app.inject({
        method: 'GET',
        url: `/api/ops/runtime${path}?${scope(organizationId, workspaceId)}`,
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('missing scope params are 400', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    for (const path of ['/runs', '/runs/run_x', '/metrics']) {
      for (const query of [
        '',
        `?organizationId=${organizationId}`,
        `?workspaceId=${workspaceId}`,
      ]) {
        const response = await client.get(`/api/ops/runtime${path}${query}`);
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      }
    }
  });

  it('a non-member organization and a forged organizationId are 403', async () => {
    const { alice, bob, a, b } = await twoTenants();
    // Bob asking about Alice's org.
    for (const path of ['/runs', '/metrics', '/runs/run_x']) {
      const foreign = await bob.get(
        `/api/ops/runtime${path}?${scope(a.organizationId, a.workspaceId)}`,
      );
      expect(foreign.statusCode).toBe(403);
      expect(foreign.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    }
    // Forged: Bob's own workspace under Alice's organization id, and vice versa.
    const forged = await bob.get(`/api/ops/runtime/runs?${scope(a.organizationId, b.workspaceId)}`);
    expect(forged.statusCode).toBe(403);
    const forgedWorkspace = await alice.get(
      `/api/ops/runtime/runs?${scope(a.organizationId, b.workspaceId)}`,
    );
    expect(forgedWorkspace.statusCode).toBe(403);
    // A nonexistent organization id.
    const missing = await alice.get(
      `/api/ops/runtime/runs?${scope('org_does_not_exist', a.workspaceId)}`,
    );
    expect(missing.statusCode).toBe(403);
  });

  it('a member without audit.read (finance) is 403 on every route', async () => {
    const client = await chatClient();
    open.push(client.app);
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'finance',
    });
    for (const path of ['/runs', '/runs/run_x', '/metrics']) {
      const response = await client.get(
        `/api/ops/runtime${path}?${scope(organizationId, workspaceId)}`,
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    }
    // A forged capability claim in the query does not help.
    const forged = await client.get(
      `/api/ops/runtime/runs?${scope(organizationId, workspaceId)}&role=executive.ceo&capability=audit.read`,
    );
    expect(forged.statusCode).toBe(403);
  });
});

describe('runtime observability routes — tenant isolation and redaction', () => {
  it("a second org's auditor never sees the first org's runs; foreign id is a 404 identical to a missing id", async () => {
    const { alice, bob, a, b } = await twoTenants();
    await chat(alice, 'What workspaces do I have?', a.workspaceId);
    await chat(bob, 'What workspaces do I have?', b.workspaceId);

    const aliceRuns = await runs(alice, a.organizationId, a.workspaceId);
    const bobRuns = await runs(bob, b.organizationId, b.workspaceId);
    expect(aliceRuns).toHaveLength(1);
    expect(bobRuns).toHaveLength(1);
    expect(aliceRuns[0]!.id).not.toBe(bobRuns[0]!.id);
    expect(aliceRuns.every((row) => row.tenantId === a.organizationId)).toBe(true);
    expect(bobRuns.every((row) => row.tenantId === b.organizationId)).toBe(true);
    // Bob's workspace filter cannot widen the tenant boundary.
    const widened = await runs(
      bob,
      b.organizationId,
      b.workspaceId,
      `&filterWorkspaceId=${a.workspaceId}`,
    );
    expect(widened).toEqual([]);

    const foreign = await bob.get(
      `/api/ops/runtime/runs/${aliceRuns[0]!.id}?${scope(b.organizationId, b.workspaceId)}`,
    );
    const never = await bob.get(
      `/api/ops/runtime/runs/run_never_existed?${scope(b.organizationId, b.workspaceId)}`,
    );
    expect(foreign.statusCode).toBe(404);
    expect(never.statusCode).toBe(404);
    const strip = (body: { error: Record<string, unknown> }) => {
      const rest = { ...body.error };
      delete rest['requestId'];
      return rest;
    };
    expect(strip(foreign.json())).toEqual(strip(never.json()));
    expect(foreign.body).not.toContain(aliceRuns[0]!.id);

    // Bob's metrics only summarize Bob's tenant.
    const metrics = await bob.get(
      `/api/ops/runtime/metrics?${scope(b.organizationId, b.workspaceId)}`,
    );
    expect((metrics.json() as { scope: { tenantId: string } }).scope.tenantId).toBe(
      b.organizationId,
    );
  });

  it('responses contain no secrets, forbidden keys or user message text', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    const secretMessage =
      'What workspaces do I have? password: hunter2-zebra-quartz Bearer abcdefghijklmnop';
    await chat(client, secretMessage, workspaceId);
    await chat(client, 'Create a workspace called ZebraQuartzPayroll', workspaceId);

    const list = await client.get(`/api/ops/runtime/runs?${scope(organizationId, workspaceId)}`);
    const rows = (list.json() as { runs: RunRow[] }).runs;
    const bodies: { body: string; parsed: unknown }[] = [{ body: list.body, parsed: list.json() }];
    for (const row of rows) {
      const detail = await client.get(
        `/api/ops/runtime/runs/${row.id}?${scope(organizationId, workspaceId)}`,
      );
      bodies.push({ body: detail.body, parsed: detail.json() });
    }
    const metrics = await client.get(
      `/api/ops/runtime/metrics?${scope(organizationId, workspaceId)}`,
    );
    bodies.push({ body: metrics.body, parsed: metrics.json() });

    for (const { body, parsed } of bodies) {
      expect(findSecrets(parsed)).toEqual([]);
      expect(findForbiddenKeys(parsed)).toEqual([]);
      expect(body).not.toContain('hunter2');
      expect(body).not.toContain('zebra-quartz');
      expect(body).not.toContain('ZebraQuartz');
      expect(body).not.toContain('What workspaces do I have');
      expect(body).not.toContain('Create a workspace');
    }
  });
});

const CALENDAR = 'calendar.create_event';
const denyCalendar: PolicyRule = {
  id: 'POLICY_TEST_DENY',
  version: '1',
  evaluate(request: PolicyRequest) {
    if (request.capabilityId !== CALENDAR && request.toolId !== CALENDAR) return undefined;
    return { outcome: 'DENY', reasonCode: 'TEST_DENY', reason: 'test deny' };
  },
};

describe('runtime observability routes — policy and approval runs', () => {
  it('a policy-denied run records failure stage POLICY (class DENIED)', async () => {
    const client = await chatClient({
      policyEngine: new PolicyEngine([...DEFAULT_POLICY_RULES, denyCalendar]),
    });
    open.push(client.app);
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const done = await chat(
      client,
      'Create a calendar event titled Board Prep tomorrow at 9am',
      workspaceId,
    );
    expect(done.status).toBe('failed');

    const [row] = await runs(client, organizationId, workspaceId);
    expect(row!.status).toBe('failed');
    expect(row!.failure).toMatchObject({ stage: 'POLICY', code: 'POLICY_DENIED', class: 'DENIED' });
    const filtered = await runs(client, organizationId, workspaceId, '&failureStage=POLICY');
    expect(filtered).toHaveLength(1);
  });

  it('an approval-gated run opens the approval; the resumed run carries the human wait outside its own latency', async () => {
    const { client, organizationId, workspaceId } = await fixture();
    const done = await chat(client, 'Create a workspace called Payroll', workspaceId);
    expect(done.status).toBe('blocked');
    const approvalId = done.approvals[0]!.id!;

    const blocked = await runs(client, organizationId, workspaceId, '&status=blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.approval).toMatchObject({ approvalId, state: 'opened' });

    await new Promise((resolve) => setTimeout(resolve, 250));
    const decision = await client.post(`/api/ai/approvals/${approvalId}/decision`, {
      decision: 'approve',
    });
    expect(decision.statusCode).toBe(200);

    const resumed = (await runs(client, organizationId, workspaceId)).find(
      (row) => row.approval?.state === 'resumed',
    );
    expect(resumed).toBeDefined();
    expect(resumed!.status).toBe('completed');
    expect(resumed!.approval!.approvalId).toBe(approvalId);
    expect(resumed!.approval!.decision).toBe('grant');
    expect(resumed!.approval!.waitMs).toBeGreaterThanOrEqual(240);
    expect(resumed!.durationMs).toBeLessThan(resumed!.approval!.waitMs!);
    // The blocked run stays as recorded (immutable) next to the resumed one.
    expect(await runs(client, organizationId, workspaceId)).toHaveLength(2);
    expect(currentUserId(client)).toBeTruthy();
  });
});
