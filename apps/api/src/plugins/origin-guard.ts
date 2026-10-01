/**
 * @nexora/app-api — browser-origin guard (AUTH-008, CSRF defense in depth).
 *
 * The session cookie is `SameSite=Lax` by default and bodies are JSON-only, which
 * stops the common cross-site form/fetch attacks — but nothing on the server
 * checked WHERE a state-changing browser request came from, so a deployment
 * that configures `SameSite=None` (or a browser quirk) would leave every
 * authenticated mutation forgeable. This guard makes the boundary explicit:
 *
 * - It applies to every state-changing method (POST/PUT/PATCH/DELETE) on a
 *   route that is authenticated by the session cookie, and to
 *   `GET /api/auth/logout` (a state-changing GET: ends the session — without
 *   this it stays a cross-site sign-out primitive).
 * - If the request carries an `Origin`, it must equal a TRUSTED origin taken
 *   from configuration (the web origin and the API's own origin). Anything
 *   else — including the opaque `null` origin — is rejected with 403. The
 *   decision never reads the request body, query, path, `Host`, `Referer` or
 *   any client-asserted "same-origin" claim.
 * - If there is no `Origin` (non-browser clients, MCP SDK clients, curl, tests),
 *   the request is allowed unless the browser's own `Sec-Fetch-Site` says
 *   `cross-site` — a supplementary signal that can only ADD a rejection, never
 *   grant trust. (Browsers always send `Origin` on cross-origin POSTs, so the
 *   Origin rule is the primary control; the missing-Origin allowance exists for
 *   legitimate machine clients, which have no cookie-bearing victim to attack.)
 * - A state-changing GET (logout) is held to a stricter standard, because a GET
 *   navigation/subresource carries no `Origin`: with no `Origin`, only a request
 *   the browser itself marks `same-origin` (or `none`: user-typed/bookmark) is
 *   accepted. `same-site` is NOT enough — a different port or sibling subdomain
 *   is same-site yet a different origin, and the cookie is sent to it. A client
 *   sending no `Sec-Fetch-Site` at all (non-browser, or a very old browser) is
 *   not a modern browser acting for an attacker and keeps working.
 * - Signed machine endpoints (inbound webhooks) authenticate by signature, not
 *   by cookie, and are not browser-driven: they are exempt by explicit route.
 */

import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '../config.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Signed, cookie-less machine endpoints (authenticated by HMAC signature). */
const SIGNED_MACHINE_ROUTES = new Set(['/api/integrations/email/inbound']);

/** A state-changing GET that must be origin-protected too. */
const STATE_CHANGING_GETS = new Set(['/api/auth/logout']);

/** The canonical origin of a URL string, or `undefined` when it is not a valid http(s) URL. */
export function originOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The trusted browser origins: the configured web origin and the API's own origin. */
export function trustedOrigins(config: Pick<ApiConfig, 'webOrigin' | 'oidc'>): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const candidate of [config.webOrigin, config.oidc.redirectUri]) {
    const origin = originOf(candidate);
    if (origin !== undefined) origins.add(origin);
  }
  return origins;
}

/** The outcome of an origin decision. */
export type OriginDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Pure origin decision for one request (exported for tests): the header values
 * and the trusted set are the ONLY inputs.
 */
export function decideOrigin(
  headers: { origin?: string | string[]; secFetchSite?: string | string[] },
  trusted: ReadonlySet<string>,
  options: { requireSameOrigin?: boolean } = {},
): OriginDecision {
  const origin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;
  if (origin !== undefined) {
    // `Origin: null` (sandboxed frame, data: URL, some redirects) and any
    // unparseable value are never trusted.
    const canonical = originOf(origin);
    if (canonical === undefined || !trusted.has(canonical)) {
      return { allowed: false, reason: 'untrusted-origin' };
    }
    return { allowed: true };
  }
  const site = Array.isArray(headers.secFetchSite) ? headers.secFetchSite[0] : headers.secFetchSite;
  if (site === 'cross-site') {
    return { allowed: false, reason: 'cross-site-fetch' };
  }
  // State-changing GET: same-site (other port / sibling subdomain) is not same-origin.
  if (
    options.requireSameOrigin === true &&
    site !== undefined &&
    site !== 'same-origin' &&
    site !== 'none'
  ) {
    return { allowed: false, reason: 'not-same-origin' };
  }
  return { allowed: true };
}

/** Registers the guard. Call before the routes it protects (like `registerAuth`). */
export function registerOriginGuard(
  app: FastifyInstance,
  dependencies: { config: Pick<ApiConfig, 'webOrigin' | 'oidc'> },
): void {
  const trusted = trustedOrigins(dependencies.config);

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const guarded =
      (STATE_CHANGING.has(request.method) && !SIGNED_MACHINE_ROUTES.has(path)) ||
      (request.method === 'GET' && STATE_CHANGING_GETS.has(path));
    if (!guarded) {
      return;
    }
    const decision = decideOrigin(
      { origin: request.headers['origin'], secFetchSite: request.headers['sec-fetch-site'] },
      trusted,
      { requireSameOrigin: request.method === 'GET' },
    );
    if (decision.allowed) {
      return;
    }
    return reply.code(403).send({
      error: {
        code: 'AUTHORIZATION_ERROR',
        message: 'Cross-origin request rejected',
        requestId: request.id,
      },
    });
  });
}
