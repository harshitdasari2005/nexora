/**
 * @nexora/module-integrations — outbound webhook destination guard (SSRF).
 *
 * A workspace manager chooses the URL a webhook is delivered to, so the URL is
 * untrusted: without a guard the server could be made to call loopback,
 * private-network, link-local or cloud-metadata addresses.
 *
 * The guard is applied where it cannot be bypassed:
 * - registration: obviously internal literal hosts are rejected early
 *   ({@link isInternalHostLiteral}, no DNS);
 * - delivery: the host is RESOLVED and every address must be public; the
 *   connection is then pinned to the validated address (no second lookup, so
 *   DNS rebinding cannot swap it) and every redirect hop is re-validated the
 *   same way ({@link createGuardedWebhookHttpClient}).
 *
 * Deliberately small: address classification, resolve-then-pin, manual
 * redirects. Not a general networking framework.
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/** Max redirect hops followed per delivery. */
const MAX_REDIRECTS = 3;
/** Per-request timeout (connect + response headers). */
const REQUEST_TIMEOUT_MS = 10_000;

/** The error recorded for a blocked destination (deliberately generic — no network oracle). */
export class WebhookDestinationBlockedError extends Error {
  constructor() {
    super('Destination not allowed');
    this.name = 'WebhookDestinationBlockedError';
  }
}

function ipv4ToInt(address: string): number {
  return address.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

/** `[network, prefix length]` blocks that are never valid webhook destinations (IPv4). */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved (incl. broadcast)
];

function isBlockedV4(address: string): boolean {
  const value = ipv4ToInt(address);
  return BLOCKED_V4.some(([network, prefix]) => {
    const size = 2 ** (32 - prefix);
    const base = ipv4ToInt(network);
    return value >= base && value < base + size;
  });
}

/** Expands an IPv6 literal into 8 16-bit groups (handles `::` and a trailing dotted IPv4). */
function expandV6(address: string): number[] | undefined {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const tail = text.lastIndexOf(':');
  const v4 = text.slice(tail + 1);
  if (v4.includes('.')) {
    if (net.isIPv4(v4) === false) return undefined;
    const n = ipv4ToInt(v4);
    text = `${text.slice(0, tail + 1)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : (halves[0] as string).split(':');
  const rest =
    halves.length === 2 ? (halves[1] === '' ? [] : (halves[1] as string).split(':')) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return undefined;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : undefined;
}

function v4FromGroups(high: number, low: number): string {
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function isBlockedV6(address: string): boolean {
  const g = expandV6(address);
  if (g === undefined) return true; // unparseable → fail closed
  const [a, b, c, d, e, f, hi, lo] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const allZeroHead = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  if (allZeroHead && f === 0 && hi === 0 && (lo === 0 || lo === 1)) return true; // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) → judge the embedded IPv4.
  if (allZeroHead && (f === 0xffff || f === 0)) return isBlockedV4(v4FromGroups(hi, lo));
  // NAT64 64:ff9b::/96 → judge the embedded IPv4.
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return isBlockedV4(v4FromGroups(hi, lo));
  }
  if (a === 0x2002) return isBlockedV4(v4FromGroups(b, c)); // 6to4 → embedded IPv4
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local (incl. fd00:ec2::254 metadata)
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((a & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  return false;
}

/** Whether an IP literal (v4 or v6) is a non-public destination. Unparseable input fails closed. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  if (net.isIPv4(bare)) return isBlockedV4(bare);
  if (net.isIPv6(bare)) return isBlockedV6(bare);
  return true;
}

/**
 * Cheap, DNS-free registration-time check: an IP literal or `localhost`-style
 * host that is internal. (A hostname that merely RESOLVES to a private address
 * is caught at delivery, where the resolution is authoritative.)
 */
export function isInternalHostLiteral(url: URL): boolean {
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (net.isIP(host) !== 0) return isPrivateAddress(host);
  const lower = host.toLowerCase().replace(/\.$/, '');
  return lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal');
}

/** Resolves a hostname to ALL its addresses. */
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

const systemResolver: HostResolver = async (hostname) =>
  (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );

/** One request to a pinned, already-validated address. */
export interface PinnedRequestInput {
  url: URL;
  address: string;
  headers: Record<string, string>;
  body: string;
}
export type PinnedRequest = (
  input: PinnedRequestInput,
) => Promise<{ status: number; location?: string }>;

/** The production transport: connect to exactly `address` (no second DNS lookup). */
export const nodePinnedRequest: PinnedRequest = ({ url, address, headers, body }) =>
  new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const family = net.isIPv6(address) ? 6 : 4;
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
          'content-length': Buffer.byteLength(body),
        },
        // Pin the connection to the validated address; TLS SNI/verification
        // still use the original hostname.
        lookup: (_host, lookupOptions, callback) => {
          // Node may ask for every address (`all: true`, happy-eyeballs) or one.
          if (lookupOptions.all === true) {
            (callback as (e: null, a: dns.LookupAddress[]) => void)(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const location = res.headers.location;
        res.resume(); // the body is never read
        res.destroy();
        resolve({ status: res.statusCode ?? 0, ...(location === undefined ? {} : { location }) });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });

/** Options for tests / composition. */
export interface GuardedWebhookClientOptions {
  resolve?: HostResolver;
  request?: PinnedRequest;
}

/**
 * Builds the guarded webhook transport: per hop — validate scheme, resolve the
 * host, require EVERY address public, connect to the validated address. Only
 * method-preserving redirects (307/308) are followed (max 3), each hop
 * re-validated; any other 3xx is reported as its status (a non-2xx outcome).
 */
export function createGuardedWebhookHttpClient(options: GuardedWebhookClientOptions = {}): {
  post(input: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<{ status: number }>;
} {
  const resolve = options.resolve ?? systemResolver;
  const request = options.request ?? nodePinnedRequest;

  async function validated(url: URL): Promise<string> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new WebhookDestinationBlockedError();
    }
    const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    const addresses = net.isIP(host) !== 0 ? [host] : await resolve(host);
    const first = addresses[0];
    if (first === undefined || addresses.some((address) => isPrivateAddress(address))) {
      throw new WebhookDestinationBlockedError();
    }
    return first;
  }

  return {
    async post({ url, headers, body }) {
      let current = new URL(url);
      for (let hop = 0; ; hop += 1) {
        const address = await validated(current);
        const response = await request({ url: current, address, headers, body });
        const redirect = response.status === 307 || response.status === 308;
        if (!redirect || response.location === undefined) {
          return { status: response.status };
        }
        if (hop >= MAX_REDIRECTS) {
          throw new Error('Too many redirects');
        }
        current = new URL(response.location, current); // re-validated on the next loop
      }
    },
  };
}
