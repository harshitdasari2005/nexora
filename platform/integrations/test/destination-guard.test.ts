/**
 * Tenant-isolation audit F-007 — outbound webhook SSRF guard.
 *
 * A workspace manager picks the webhook URL, so the destination is untrusted.
 * Covers address classification, the registration-time literal check, and the
 * delivery-time transport: resolve → require every address public → connect to
 * the validated address → re-validate every redirect hop. All deterministic:
 * a fake resolver/transport stands in for DNS and the network; the end-to-end
 * test uses a real loopback server that must receive NOTHING.
 */

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  WebhookDestinationBlockedError,
  createGuardedWebhookHttpClient,
  isInternalHostLiteral,
  isPrivateAddress,
  nodePinnedRequest,
  type PinnedRequestInput,
} from '../src/dispatch/destination-guard.js';
import { WebhookDispatcher } from '../src/dispatch/webhook-dispatcher.js';
import { WebhookEndpoint } from '../src/domain/webhook-endpoint.js';
import { IntegrationApplicationService } from '../src/application/integration-application-service.js';

const TENANT = 'org_tenant_a' as TenantId;
const WORKSPACE = 'ws_a' as WorkspaceId;

describe('isPrivateAddress', () => {
  it.each([
    // IPv4 loopback / private / link-local / metadata / special
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '169.254.0.1',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.2.1',
    '224.0.0.1',
    '255.255.255.255',
    // IPv6 loopback / unspecified / unique-local / link-local / metadata
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fd00:ec2::254',
    'fe80::1',
    'fe80::abcd%eth0',
    'ff02::1',
    // v4 embedded in v6 (mapped, compatible, NAT64, 6to4)
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.1.2.3',
    '::127.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:0001::1',
    '[::1]',
    // unparseable → fail closed
    'not-an-ip',
    '',
  ])('%s is non-public', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '1.1.1.1',
    '172.15.255.255', // just outside 172.16/12
    '172.32.0.1', // just outside 172.16/12
    '100.63.255.255', // just outside CGNAT
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '2002:0808:0808::1', // 6to4 of 8.8.8.8
  ])('%s is public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('isInternalHostLiteral (registration-time)', () => {
  const internal = (url: string) => isInternalHostLiteral(new URL(url));
  it.each([
    'http://127.0.0.1/hook',
    'http://localhost/hook',
    'http://LOCALHOST:8080/hook',
    'http://api.localhost/hook',
    'http://metadata.google.internal/hook',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/hook',
    'http://192.168.0.10:3000/hook',
    'http://[::1]/hook',
    'http://[fd00:ec2::254]/hook',
    'http://[::ffff:127.0.0.1]/hook',
    // the URL parser normalizes alternate IPv4 spellings to dotted-quad
    'http://2130706433/hook',
    'http://0x7f.0.0.1/hook',
    'http://0177.0.0.1/hook',
    'http://127.1/hook',
  ])('%s is rejected', (url) => {
    expect(internal(url)).toBe(true);
  });

  it.each(['https://example.com/hooks', 'https://hooks.slack.com/x', 'http://93.184.216.34/h'])(
    '%s is allowed',
    (url) => {
      expect(internal(url)).toBe(false);
    },
  );
});

describe('guarded webhook transport', () => {
  const PUBLIC = '93.184.216.34';
  const body = '{"x":1}';
  const headers = { 'x-nexora-event-id': 'evt_1' };

  /** A recording transport: answers from a script keyed by hostname. */
  function harness(
    dns: Record<string, string[]>,
    answers: Record<string, { status: number; location?: string }>,
  ) {
    const requests: PinnedRequestInput[] = [];
    const resolved: string[] = [];
    const client = createGuardedWebhookHttpClient({
      resolve: async (host) => {
        resolved.push(host);
        return dns[host] ?? [];
      },
      request: async (input) => {
        requests.push(input);
        return answers[input.url.hostname] ?? { status: 200 };
      },
    });
    return { client, requests, resolved };
  }
  const post = (client: ReturnType<typeof harness>['client'], url: string) =>
    client.post({ url, headers, body });

  it('delivers to a public destination, pinned to the validated address', async () => {
    const { client, requests } = harness({ 'hooks.example.com': [PUBLIC] }, {});
    expect(await post(client, 'https://hooks.example.com/h')).toEqual({ status: 200 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.address).toBe(PUBLIC);
    expect(requests[0]?.body).toBe(body);
  });

  it('allows a public IP literal without resolving', async () => {
    const { client, requests, resolved } = harness({}, {});
    expect((await post(client, `http://${PUBLIC}/h`)).status).toBe(200);
    expect(resolved).toEqual([]);
    expect(requests[0]?.address).toBe(PUBLIC);
  });

  it.each([
    ['loopback v4 literal', 'http://127.0.0.1/h'],
    ['loopback v6 literal', 'http://[::1]/h'],
    ['RFC1918 literal', 'http://10.1.2.3/h'],
    ['link-local / metadata literal', 'http://169.254.169.254/latest/meta-data'],
    ['private v6 literal', 'http://[fd00:ec2::254]/h'],
    ['v4-mapped loopback literal', 'http://[::ffff:127.0.0.1]/h'],
    ['integer-encoded loopback', 'http://2130706433/h'],
    ['unsupported scheme', 'ftp://hooks.example.com/h'],
    ['file scheme', 'file:///etc/passwd'],
  ])('rejects %s and never sends a request', async (_name, url) => {
    const { client, requests } = harness({}, {});
    await expect(post(client, url)).rejects.toBeInstanceOf(WebhookDestinationBlockedError);
    expect(requests).toEqual([]);
  });

  it('rejects a hostname that RESOLVES to a private address (not just string matching)', async () => {
    const { client, requests } = harness(
      { 'rebind.example.com': ['10.0.0.9'], 'meta.example.com': ['169.254.169.254'] },
      {},
    );
    await expect(post(client, 'https://rebind.example.com/h')).rejects.toBeInstanceOf(
      WebhookDestinationBlockedError,
    );
    await expect(post(client, 'https://meta.example.com/h')).rejects.toBeInstanceOf(
      WebhookDestinationBlockedError,
    );
    expect(requests).toEqual([]);
  });

  it('rejects when ANY resolved address is private (mixed answers) or none resolve', async () => {
    const { client, requests } = harness({ 'mixed.example.com': [PUBLIC, '127.0.0.1'] }, {});
    await expect(post(client, 'https://mixed.example.com/h')).rejects.toBeInstanceOf(
      WebhookDestinationBlockedError,
    );
    await expect(post(client, 'https://nxdomain.example.com/h')).rejects.toBeInstanceOf(
      WebhookDestinationBlockedError,
    );
    expect(requests).toEqual([]);
  });

  it('public → redirect → private is rejected at the redirect hop (and only the public hop was requested)', async () => {
    const { client, requests } = harness(
      { 'hooks.example.com': [PUBLIC], 'internal.example.com': ['192.168.0.7'] },
      { 'hooks.example.com': { status: 307, location: 'https://internal.example.com/admin' } },
    );
    await expect(post(client, 'https://hooks.example.com/h')).rejects.toBeInstanceOf(
      WebhookDestinationBlockedError,
    );
    expect(requests.map((r) => r.url.hostname)).toEqual(['hooks.example.com']);
  });

  it('public → redirect to a private IP literal / loopback is rejected', async () => {
    for (const location of [
      'http://127.0.0.1:8080/x',
      'http://169.254.169.254/',
      'http://[::1]/',
    ]) {
      const { client, requests } = harness(
        { 'hooks.example.com': [PUBLIC] },
        { 'hooks.example.com': { status: 308, location } },
      );
      await expect(post(client, 'https://hooks.example.com/h')).rejects.toBeInstanceOf(
        WebhookDestinationBlockedError,
      );
      expect(requests).toHaveLength(1);
    }
  });

  it('public → public method-preserving redirect is followed and re-validated; the body is re-sent', async () => {
    const { client, requests, resolved } = harness(
      { 'a.example.com': [PUBLIC], 'b.example.com': ['8.8.8.8'] },
      {
        'a.example.com': { status: 307, location: 'https://b.example.com/new' },
        'b.example.com': { status: 204 },
      },
    );
    expect(await post(client, 'https://a.example.com/h')).toEqual({ status: 204 });
    expect(resolved).toEqual(['a.example.com', 'b.example.com']);
    expect(requests.map((r) => r.address)).toEqual([PUBLIC, '8.8.8.8']);
    expect(requests[1]?.body).toBe(body);
  });

  it('a relative redirect stays on the validated host; non-method-preserving 3xx are not followed', async () => {
    const rel = harness(
      { 'a.example.com': [PUBLIC] },
      { 'a.example.com': { status: 307, location: '/other' } },
    );
    // Same host, so the second hop resolves the same public address; still bounded.
    await expect(post(rel.client, 'https://a.example.com/h')).rejects.toThrow('Too many redirects');
    const found = harness(
      { 'a.example.com': [PUBLIC] },
      { 'a.example.com': { status: 302, location: 'http://127.0.0.1/x' } },
    );
    expect(await post(found.client, 'https://a.example.com/h')).toEqual({ status: 302 });
    expect(found.requests).toHaveLength(1);
  });
});

describe('registration rejects internal destinations', () => {
  const service = () =>
    new IntegrationApplicationService({
      endpoints: {
        async save() {},
        async findById() {
          return undefined;
        },
        async findByIdAndTenant() {
          return undefined;
        },
        async listByWorkspace() {
          return [];
        },
        async listSubscribed() {
          return [];
        },
        async remove() {},
      },
      publisher: { publish: async () => {} } as unknown as EventPublisher,
    } as never);

  it.each([
    'http://127.0.0.1/hook',
    'http://localhost:9000/hook',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.8/hook',
    'http://[::1]/hook',
    'ftp://example.com/hook',
  ])('createWebhookEndpoint(%s) → VALIDATION_ERROR, nothing stored', async (url) => {
    const result = await service().createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url,
      eventTypes: ['project.created'],
      actorId: 'user_sarah',
      correlationId: 'corr_ssrf',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('a public destination is still accepted', async () => {
    const result = await service().createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url: 'https://hooks.example.com/nexora',
      eventTypes: ['project.created'],
      actorId: 'user_sarah',
      correlationId: 'corr_ok',
    });
    expect(result.ok).toBe(true);
  });
});

describe('WebhookDispatcher default transport blocks a legacy internal endpoint (real loopback server)', () => {
  const servers: http.Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  it('never reaches a loopback server; records a generic failed receipt', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.end('ok');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    // An endpoint stored BEFORE the registration check existed (or any URL that
    // slipped past it): the delivery-time guard is the backstop.
    const endpoint = WebhookEndpoint.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        url: `http://127.0.0.1:${port}/internal-admin`,
        eventTypes: ['project.created'],
        createdBy: 'user_sarah',
      } as never,
      'whsec_test',
      {
        actor: { kind: 'user', id: 'user_sarah' },
        correlationId: 'corr_x',
        organizationId: TENANT,
      },
    );
    const receipts: Array<{ status: string; error?: string }> = [];
    const dispatcher = new WebhookDispatcher({
      endpoints: {
        listSubscribed: async () => [endpoint],
      } as never,
      deliveries: {
        save: async (delivery: { status: string; error?: string }) => {
          receipts.push({ status: delivery.status, error: delivery.error });
        },
      } as never,
      publisher: { publish: async () => {} } as unknown as EventPublisher,
      maxAttempts: 1,
      backoffMs: 1,
    });
    const event: EventEnvelope = {
      id: 'evt_ssrf',
      type: 'project.created',
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      correlationId: 'corr_ssrf',
      actor: { kind: 'user', id: 'user_sarah' },
      payload: {},
      version: 1,
      occurredAt: new Date().toISOString(),
    };
    await dispatcher.handle(event);

    expect(hits).toBe(0);
    // One generic receipt for every transport failure — a blocked destination is indistinguishable
    // from an unreachable one, so receipts cannot be used to probe internal names.
    expect(receipts).toEqual([{ status: 'failed', error: 'Delivery failed' }]);
  });
});

describe('production transport (nodePinnedRequest) — real server', () => {
  const servers: http.Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  it('POSTs the body and headers to the PINNED address (no DNS), and surfaces status + Location', async () => {
    const seen: Array<{ method?: string; host?: string; signature?: string; body: string }> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({
          method: req.method,
          host: req.headers.host,
          signature: req.headers['x-nexora-signature'] as string,
          body,
        });
        if (req.url === '/moved') {
          res.writeHead(307, { location: 'https://elsewhere.example.com/x' });
          res.end();
        } else {
          res.writeHead(204);
          res.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    // The hostname does not resolve anywhere: success proves the connection used
    // the pinned address and never performed its own DNS lookup.
    const url = new URL(`http://pinned-host.invalid:${port}/hook`);
    const ok = await nodePinnedRequest({
      url,
      address: '127.0.0.1',
      headers: { 'x-nexora-signature': 'sha256=abc' },
      body: '{"hello":"world"}',
    });
    expect(ok).toEqual({ status: 204 });
    expect(seen[0]).toEqual({
      method: 'POST',
      host: `pinned-host.invalid:${port}`,
      signature: 'sha256=abc',
      body: '{"hello":"world"}',
    });

    const moved = await nodePinnedRequest({
      url: new URL(`http://pinned-host.invalid:${port}/moved`),
      address: '127.0.0.1',
      headers: {},
      body: '{}',
    });
    expect(moved).toEqual({ status: 307, location: 'https://elsewhere.example.com/x' });
  });
});
