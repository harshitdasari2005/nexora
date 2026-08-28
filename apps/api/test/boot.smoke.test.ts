/**
 * Boot smoke test.
 *
 * Every other API test drives the app through `fastify.inject()` — which
 * never opens a socket. A total failure to *start listening* (a hang in
 * `buildApp`, a bad `app.listen`, a port-binding regression, an unhandled
 * rejection during composition) therefore produced ZERO red tests. This
 * test closes that gap: it boots the real HTTP server on an ephemeral port,
 * makes a real network request to `/api/health`, and shuts it down.
 *
 * It still uses the in-memory fakes (no Docker/Postgres) — the point is to
 * exercise `listen()` and the network path, not the database.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';

import { buildTestApp } from './helpers.js';

describe('API boot smoke test (real listen + real request)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
    // Ephemeral port; 127.0.0.1 so CI sandboxes without a public iface work.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('binds a port and serves GET /api/health with status ok', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('serves a 401 (not a hang or a crash) for a protected route without a session', async () => {
    const response = await fetch(`${baseUrl}/api/me`);
    expect(response.status).toBe(401);
  });
});
