/**
 * Tenant-isolation audit F-004 — the live activity SSE stream is authorized
 * exactly like `GET /api/activity`.
 *
 * Before: the stream forwarded every activity item of the tenant to any
 * organization member, with no workspace narrowing and no `activity.read`
 * check. Now the connection resolves, once and from trusted server state, what
 * it may see: workspace membership when a workspace is named, and
 * `activity.read` evaluated in that scope. The organization feed (no workspace
 * named) is preserved — `GET /api/activity?organizationId=…` is the documented
 * org-level feed — and notifications are untouched.
 *
 * These tests drive REAL SSE connections against a listening app.
 */

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialCatalog } from '@nexora/module-domains';

import {
  isActivityVisibleToStream,
  resolveActivityStreamScope,
  type ActivityStreamScope,
} from '../src/routes/notifications.js';
import { chatClientWithSecondUser, seedWorkspace } from './helpers.js';

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

interface OpenStream {
  status: number;
  frames: Frame[];
  activityTitles(): string[];
  close(): void;
}

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function openStream(port: number, cookie: string, query: string): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const frames: Frame[] = [];
    let buffer = '';
    const req = http.request(
      { host: '127.0.0.1', port, path: `/api/notifications/stream?${query}`, headers: { cookie } },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let split = buffer.indexOf('\n\n');
          while (split !== -1) {
            const raw = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const event = /^event: (.*)$/m.exec(raw)?.[1];
            const data = /^data: (.*)$/m.exec(raw)?.[1];
            if (event !== undefined && data !== undefined) {
              frames.push({ event, data: JSON.parse(data) as Record<string, unknown> });
            }
            split = buffer.indexOf('\n\n');
          }
        });
        const stream: OpenStream = {
          status: res.statusCode ?? 0,
          frames,
          activityTitles: () =>
            frames
              .filter((f) => f.event === 'activity')
              .map((f) => `${String(f.data.title)} ${String(f.data.body)}`),
          close: () => req.destroy(),
        };
        closers.push(stream.close);
        // Resolve once the server has acknowledged the connection.
        const wait = setInterval(() => {
          if (frames.some((f) => f.event === 'ready')) {
            clearInterval(wait);
            resolve(stream);
          }
        }, 5);
        setTimeout(() => {
          clearInterval(wait);
          resolve(stream);
        }, 2000);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for a stream frame');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 150));

async function setup() {
  const client = await chatClientWithSecondUser();
  const org = await client.post('/api/organizations', {
    name: 'Acme Inc.',
    slug: 'acme',
    type: 'startup',
  });
  const organizationId = (org.json().organization as { id: string }).id;
  const createWorkspace = async (slug: string, type: string) => {
    const res = await client.post('/api/workspaces', { organizationId, name: slug, slug, type });
    expect(res.statusCode).toBe(201);
    return (res.json().workspace as { id: string }).id;
  };
  const w1 = await createWorkspace('alpha', 'engineering');
  const w2 = await createWorkspace('beta', 'engineering');
  // A workspace of the SAME organization the caller is NOT a member of.
  await seedWorkspace(client.repos, {
    id: 'wsp_not_a_member',
    organizationId,
    slug: 'not-a-member',
  });

  await client.app.listen({ port: 0, host: '127.0.0.1' });
  const address = client.app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  closers.push(() => void client.app.close());

  const event = async (workspaceId: string, title: string) => {
    const res = await client.post('/api/calendar/events', {
      organizationId,
      workspaceId,
      title,
      startsAt: '2026-09-01T15:00:00.000Z',
      endsAt: '2026-09-01T16:00:00.000Z',
    });
    return res.statusCode;
  };
  return { client, organizationId, w1, w2, port, event };
}

describe('F-004 — activity SSE stream scope (real connections)', () => {
  it('a workspace stream receives only its own workspace’s activity; the org stream keeps the org feed', async () => {
    const { client, organizationId, w1, w2, port, event } = await setup();
    const q = (ws?: string) =>
      `organizationId=${organizationId}${ws === undefined ? '' : `&workspaceId=${ws}`}`;
    const s1 = await openStream(port, client.session, q(w1));
    const s2 = await openStream(port, client.session, q(w2));
    const sOrg = await openStream(port, client.session, q());
    expect([s1.status, s2.status, sOrg.status]).toEqual([200, 200, 200]);

    expect(await event(w1, 'W1 planning')).toBe(201);
    expect(await event(w2, 'W2 budget review')).toBe(201);
    await until(() => sOrg.activityTitles().length >= 2 && s1.activityTitles().length >= 1);
    await until(() => s2.activityTitles().length >= 1);
    await settle();

    // W1 never receives W2's activity (and vice versa); each gets its own.
    expect(s1.activityTitles().join(' ')).toContain('W1 planning');
    expect(s1.activityTitles().join(' ')).not.toContain('W2 budget review');
    expect(s2.activityTitles().join(' ')).toContain('W2 budget review');
    expect(s2.activityTitles().join(' ')).not.toContain('W1 planning');
    // Organization-scoped connection: the documented org feed (same as GET).
    const orgTitles = sOrg.activityTitles().join(' ');
    expect(orgTitles).toContain('W1 planning');
    expect(orgTitles).toContain('W2 budget review');
  });

  it('SSE and GET agree on visibility for the same scope', async () => {
    const { client, organizationId, w1, w2, port, event } = await setup();
    const s1 = await openStream(
      port,
      client.session,
      `organizationId=${organizationId}&workspaceId=${w1}`,
    );
    await event(w1, 'Consistency W1');
    await event(w2, 'Consistency W2');
    await until(() => s1.activityTitles().length >= 1);
    await settle();

    const titlesFromGet = async (workspaceId: string) =>
      (
        (
          await client.get(
            `/api/activity?organizationId=${organizationId}&workspaceId=${workspaceId}`,
          )
        ).json() as {
          activity: { title: string; body: string }[];
        }
      ).activity.map((a) => `${a.title} ${a.body}`);
    const get1 = (await titlesFromGet(w1)).join(' ');
    expect(get1).toContain('Consistency W1');
    expect(get1).not.toContain('Consistency W2');
    expect(s1.activityTitles().join(' ')).toContain('Consistency W1');
    expect(s1.activityTitles().join(' ')).not.toContain('Consistency W2');
  });

  it('a workspace the caller is not a member of never yields activity (and never yields that workspace’s feed)', async () => {
    const { client, organizationId, w1, port, event } = await setup();
    const forged = await openStream(
      port,
      client.session,
      `organizationId=${organizationId}&workspaceId=wsp_not_a_member`,
    );
    const control = await openStream(
      port,
      client.session,
      `organizationId=${organizationId}&workspaceId=${w1}`,
    );
    await event(w1, 'Visible only to W1');
    await until(() => control.activityTitles().length >= 1);
    await settle();
    expect(forged.activityTitles()).toEqual([]);
    // GET refuses the same scope outright.
    const get = await client.get(
      `/api/activity?organizationId=${organizationId}&workspaceId=wsp_not_a_member`,
    );
    expect(get.statusCode).toBe(403);
  });

  it('another organization never receives this organization’s activity (own org, and a foreign organizationId)', async () => {
    const { client, organizationId, w1, port, event } = await setup();
    // The second user founds their OWN organization.
    const otherOrg = await client.second.post('/api/organizations', {
      name: 'Other Co',
      slug: 'other-co',
      type: 'startup',
    });
    const otherOrgId = (otherOrg.json().organization as { id: string }).id;
    const own = await openStream(port, client.second.cookie, `organizationId=${otherOrgId}`);
    const forged = await openStream(port, client.second.cookie, `organizationId=${organizationId}`);
    const control = await openStream(
      port,
      client.session,
      `organizationId=${organizationId}&workspaceId=${w1}`,
    );

    await event(w1, 'Org A secret');
    await until(() => control.activityTitles().length >= 1);
    await settle();
    expect(own.activityTitles()).toEqual([]);
    expect(forged.activityTitles()).toEqual([]);
  });
});

describe('isActivityVisibleToStream (predicate)', () => {
  const item = (tenantId: string, workspaceId?: string) => ({ tenantId, workspaceId });
  const scope = (over: Partial<ActivityStreamScope>): ActivityStreamScope => ({
    allowed: true,
    tenantId: 'org_a',
    workspaceId: undefined,
    ...over,
  });

  it('is fail-closed and tenant/workspace exact', () => {
    expect(isActivityVisibleToStream(item('org_a', 'w1'), scope({ workspaceId: 'w1' }))).toBe(true);
    expect(isActivityVisibleToStream(item('org_a', 'w2'), scope({ workspaceId: 'w1' }))).toBe(
      false,
    );
    expect(isActivityVisibleToStream(item('org_a'), scope({ workspaceId: 'w1' }))).toBe(false);
    expect(isActivityVisibleToStream(item('org_b', 'w1'), scope({ workspaceId: 'w1' }))).toBe(
      false,
    );
    expect(isActivityVisibleToStream(item('org_a', 'w2'), scope({}))).toBe(true); // org feed
    expect(isActivityVisibleToStream(item('org_b', 'w1'), scope({}))).toBe(false);
    expect(isActivityVisibleToStream(item('org_a', 'w1'), scope({ allowed: false }))).toBe(false);
    expect(isActivityVisibleToStream(item('org_a', 'w1'), scope({ tenantId: undefined }))).toBe(
      false,
    );
  });
});

describe('resolveActivityStreamScope (capability gate)', () => {
  // The REAL role catalog with a stub role resolver: a role that lacks
  // `activity.read` must be refused, even for a workspace the caller belongs to.
  const catalog = createInitialCatalog();
  const deps = (roleId: string | undefined, workspaces: string[]) =>
    ({
      listMyWorkspaces: {
        handle: async () => ({ ok: true, value: workspaces.map((id) => ({ id })) }),
      },
      permissions: { roleResolver: { resolve: async () => roleId }, catalog },
    }) as never;
  const resolve = (roleId: string | undefined, workspaces: string[], workspaceId?: string) =>
    resolveActivityStreamScope(deps(roleId, workspaces), 'usr_1' as never, 'org_a', workspaceId);

  it('holds activity.read → allowed; narrowed to the verified workspace', async () => {
    expect(await resolve('legal.general_counsel', ['w1'], 'w1')).toEqual({
      allowed: true,
      tenantId: 'org_a',
      workspaceId: 'w1',
    });
    expect((await resolve('legal.general_counsel', ['w1'])).allowed).toBe(true); // org feed
  });

  it('lacks activity.read (legal.compliance_manager) → denied, even as a workspace member', async () => {
    expect(catalog.roles.get('legal.compliance_manager')?.capabilityIds).not.toContain(
      'activity.read',
    );
    expect((await resolve('legal.compliance_manager', ['w1'], 'w1')).allowed).toBe(false);
  });

  it('a workspace the caller is not a member of, no role, and no tenant → denied', async () => {
    expect((await resolve('legal.general_counsel', ['w1'], 'w_other')).allowed).toBe(false);
    expect((await resolve(undefined, ['w1'], 'w1')).allowed).toBe(false);
    const noTenant = await resolveActivityStreamScope(
      deps('legal.general_counsel', ['w1']),
      'usr_1' as never,
      undefined,
      'w1',
    );
    expect(noTenant.allowed).toBe(false);
  });
});
