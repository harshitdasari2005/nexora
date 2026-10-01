/**
 * AUTH-002 — an open notification/activity SSE stream must not outlive the
 * session that authorized it.
 *
 * Before: the session was validated once when the stream was opened and never
 * again. After a logout, a revocation, or the session passing its absolute or
 * idle lifetime, the already-open connection kept delivering notifications and
 * activity (event titles included) until the client happened to disconnect.
 *
 * These tests drive REAL SSE connections against a listening app and walk the
 * actual attack path:
 *   authenticated session → open live stream → invalidate the session →
 *   publish a protected event → nothing is delivered and the stream closes.
 * The session is invalidated with the real logout route, a real revocation
 * (the session domain service), and a controllable clock. Nothing waits on a
 * fixed sleep: assertions await the stream's own close/frames.
 */

import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashSessionToken } from '@nexora/domain-identity';
import { SSE_SESSION_RECHECK_MS } from '../src/routes/notifications.js';
import { login, chatClientWithSecondUser, type ChatClient } from './helpers.js';

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

interface OpenStream {
  status: number;
  frames: Frame[];
  /** Resolves when the server ended the response (or the socket closed). */
  closed: Promise<void>;
  isClosed(): boolean;
  titles(): string;
  close(): void;
}

const closers: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const close of closers.splice(0)) close();
});

function openStream(port: number, cookie: string, query: string): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const frames: Frame[] = [];
    let buffer = '';
    let closedFlag = false;
    let markClosed: () => void = () => undefined;
    const closed = new Promise<void>((done) => {
      markClosed = () => {
        closedFlag = true;
        done();
      };
    });
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
              if (event === 'ready') {
                resolve(stream);
              }
            }
            split = buffer.indexOf('\n\n');
          }
        });
        res.on('end', markClosed);
        res.on('close', markClosed);
        const stream: OpenStream = {
          status: res.statusCode ?? 0,
          frames,
          closed,
          isClosed: () => closedFlag,
          titles: () =>
            frames
              .filter((f) => f.event === 'activity')
              .map((f) => `${String(f.data.title)} ${String(f.data.body)}`)
              .join(' | '),
          close: () => req.destroy(),
        };
        closers.push(stream.close);
        if (res.statusCode !== 200) {
          resolve(stream);
        }
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Waits (event-driven, bounded) for a predicate that flips as frames arrive. */
async function until(predicate: () => boolean, label: string, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Waits for a stream to close, failing (not hanging) if it never does. */
async function expectClosed(stream: OpenStream, label: string): Promise<void> {
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 4000));
  expect(await Promise.race([stream.closed.then(() => 'closed' as const), timeout]), label).toBe(
    'closed',
  );
}

const T0 = Date.parse('2026-09-01T09:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function setup() {
  const client = await chatClientWithSecondUser();
  const org = await client.post('/api/organizations', {
    name: 'Acme Inc.',
    slug: 'acme',
    type: 'startup',
  });
  const organizationId = (org.json().organization as { id: string }).id;
  const ws = await client.post('/api/workspaces', {
    organizationId,
    name: 'alpha',
    slug: 'alpha',
    type: 'engineering',
  });
  const workspaceId = (ws.json().workspace as { id: string }).id;
  await client.second.join({ organizationId, workspaceId, workspaceRole: 'owner' });

  await client.app.listen({ port: 0, host: '127.0.0.1' });
  const address = client.app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  closers.push(() => void client.app.close());

  // A SECOND session of the same user A (the third dance cycles back to A), used
  // to publish events and to prove an unaffected session keeps working.
  const sessionA2 = await login(client.app);
  const query = `organizationId=${organizationId}&workspaceId=${workspaceId}`;
  const publish = async (cookie: string, title: string) => {
    const res = await client.app.inject({
      method: 'POST',
      url: '/api/calendar/events',
      headers: { cookie, 'content-type': 'application/json' },
      payload: {
        organizationId,
        workspaceId,
        title,
        startsAt: '2026-09-01T15:00:00.000Z',
        endsAt: '2026-09-01T16:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
  };
  return {
    client,
    port,
    query,
    sessionA1: client.session,
    sessionA2,
    userB: client.second,
    publish,
  };
}

/** Revokes the stored session that owns `cookie` through the real session domain service. */
async function revokeSession(client: ChatClient, cookie: string): Promise<void> {
  const token = cookie.split('=')[1] as string;
  const session = await client.repos.sessions.findByTokenHash(hashSessionToken(token));
  expect(session).toBeDefined();
  session?.revoke(
    {
      actor: { kind: 'user', id: 'usr_admin' },
      correlationId: 'corr_revoke',
      tenantId: session.tenantId,
    },
    'test revocation',
  );
  await client.repos.sessions.save(session!);
}

describe('AUTH-002 — an open SSE stream does not outlive its session (real connections)', () => {
  it('control: while the session is valid the stream delivers events', async () => {
    const e = await setup();
    const stream = await openStream(e.port, e.sessionA1, e.query);
    expect(stream.status).toBe(200);
    await e.publish(e.sessionA2, 'Legitimate event');
    await until(() => stream.titles().includes('Legitimate event'), 'legitimate event');
    expect(stream.isClosed()).toBe(false);
  });

  it('LOGOUT: after logout the stream receives nothing further (no title leaks) and is closed; other users’ streams continue', async () => {
    const e = await setup();
    const a1 = await openStream(e.port, e.sessionA1, e.query);
    const a2 = await openStream(e.port, e.sessionA2, e.query);
    const b = await openStream(e.port, e.userB.cookie, e.query);

    await e.publish(e.sessionA2, 'Before logout');
    await until(() => a1.titles().includes('Before logout'), 'pre-logout delivery');

    // The real logout route ends session A1 server-side.
    const out = await e.client.app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: e.sessionA1 },
    });
    expect(out.statusCode).toBe(302);

    const framesBefore = a1.frames.length;
    await e.publish(e.sessionA2, 'SECRET after logout');
    // The still-valid streams receive it…
    await until(() => b.titles().includes('SECRET after logout'), 'B receives');
    await until(() => a2.titles().includes('SECRET after logout'), 'A2 receives');
    // …the logged-out stream is closed by the server and was written nothing.
    await expectClosed(a1, 'logged-out stream closes');
    expect(a1.frames.length).toBe(framesBefore);
    expect(JSON.stringify(a1.frames)).not.toContain('SECRET after logout');
    expect(b.isClosed()).toBe(false);
    expect(a2.isClosed()).toBe(false);
  });

  it('REVOCATION: a session revoked while the stream is open stops receiving and is closed', async () => {
    const e = await setup();
    const a1 = await openStream(e.port, e.sessionA1, e.query);
    const a2 = await openStream(e.port, e.sessionA2, e.query);
    await e.publish(e.sessionA2, 'Before revoke');
    await until(() => a1.titles().includes('Before revoke'), 'pre-revoke delivery');

    await revokeSession(e.client, e.sessionA1);
    await e.publish(e.sessionA2, 'SECRET after revoke');
    await until(() => a2.titles().includes('SECRET after revoke'), 'unaffected session receives');
    await expectClosed(a1, 'revoked stream closes');
    expect(JSON.stringify(a1.frames)).not.toContain('SECRET after revoke');
  });

  it('ABSOLUTE EXPIRY: a session past its 8 h lifetime stops receiving and is closed; a fresh session’s stream works', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const e = await setup();
    const a1 = await openStream(e.port, e.sessionA1, e.query);
    // Keep A1 idle-live so ONLY the absolute lifetime has passed.
    for (let at = 25 * MINUTE; at < 8 * HOUR; at += 25 * MINUTE) {
      vi.setSystemTime(T0 + at);
      expect(
        (
          await e.client.app.inject({
            method: 'GET',
            url: '/api/me',
            headers: { cookie: e.sessionA1 },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await e.client.app.inject({
            method: 'GET',
            url: '/api/me',
            headers: { cookie: e.sessionA2 },
          })
        ).statusCode,
      ).toBe(200);
    }
    vi.setSystemTime(T0 + 8 * HOUR + MINUTE);
    const fresh = await login(e.client.app);
    const freshStream = await openStream(e.port, fresh, e.query);
    await e.publish(fresh, 'SECRET after expiry');
    await until(
      () => freshStream.titles().includes('SECRET after expiry'),
      'fresh session receives',
    );
    await expectClosed(a1, 'expired stream closes');
    expect(JSON.stringify(a1.frames)).not.toContain('SECRET after expiry');
  });

  it('IDLE EXPIRY: a session idle past 30 min stops receiving and is closed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const e = await setup();
    const a1 = await openStream(e.port, e.sessionA1, e.query);
    // A2 stays in use; A1 is never presented again.
    vi.setSystemTime(T0 + 20 * MINUTE);
    expect(
      (
        await e.client.app.inject({
          method: 'GET',
          url: '/api/me',
          headers: { cookie: e.sessionA2 },
        })
      ).statusCode,
    ).toBe(200);
    vi.setSystemTime(T0 + 31 * MINUTE);
    await e.publish(e.sessionA2, 'SECRET after idle');
    await expectClosed(a1, 'idle-expired stream closes');
    expect(JSON.stringify(a1.frames)).not.toContain('SECRET after idle');
  });

  it('the re-check is read-only: an open stream does not keep an idle session alive (it still idles out)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const e = await setup();
    const a1 = await openStream(e.port, e.sessionA1, e.query);
    // Events keep flowing for 25 minutes (each re-checks A1's session)…
    for (const minutes of [10, 20, 25]) {
      vi.setSystemTime(T0 + minutes * MINUTE);
      await e.publish(e.sessionA2, `tick ${minutes}`);
      await until(() => a1.titles().includes(`tick ${minutes}`), `tick ${minutes}`);
    }
    // …but if they had refreshed A1 it would be live at 40 min. It was never touched, so it is not.
    vi.setSystemTime(T0 + 40 * MINUTE);
    await e.publish(e.sessionA2, 'late');
    await expectClosed(a1, 'stream closes: the stream did not extend the session');
    expect(a1.titles()).not.toContain('late');
  });

  it('an invalid session cannot open a stream at all (unchanged)', async () => {
    const e = await setup();
    await e.client.app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: e.sessionA1 },
    });
    const res = await openStream(e.port, e.sessionA1, e.query);
    expect(res.status).toBe(401);
  });

  it('a QUIET stream (no events) is closed by the bounded re-check timer after logout', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T0);
    const e = await setup();
    const a1 = await openStream(e.port, e.sessionA1, e.query);
    const a2 = await openStream(e.port, e.sessionA2, e.query);
    await e.client.app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: e.sessionA1 },
    });
    expect(a1.isClosed()).toBe(false); // nothing was published: only the timer can notice
    await vi.advanceTimersByTimeAsync(SSE_SESSION_RECHECK_MS);
    await expectClosed(a1, 'timer closes the quiet logged-out stream');
    expect(a2.isClosed()).toBe(false); // the other (valid) session's stream stays open
  });

  it('cleanup: the re-check timer is released when the client disconnects and when the server closes the stream', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T0);
    const e = await setup();
    const base = vi.getTimerCount();
    const a1 = await openStream(e.port, e.sessionA1, e.query);
    const a2 = await openStream(e.port, e.sessionA2, e.query);
    expect(vi.getTimerCount()).toBe(base + 2); // one bounded timer per open stream
    // Client disconnect releases that stream's timer.
    a2.close();
    await expectClosed(a2, 'client disconnect');
    await until(() => vi.getTimerCount() === base + 1, 'timer released on client disconnect');
    // Server-side termination (session ended) releases the other.
    await e.client.app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: e.sessionA1 },
    });
    await vi.advanceTimersByTimeAsync(SSE_SESSION_RECHECK_MS);
    await expectClosed(a1, 'server closes');
    await until(() => vi.getTimerCount() === base, 'timer released on server termination');
  });
});
