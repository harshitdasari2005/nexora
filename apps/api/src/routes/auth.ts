/**
 * @nexora/app-api — authentication routes.
 *
 * OIDC authorization-code flow (Keycloak): `/api/auth/login` redirects to
 * the IdP; `/api/auth/callback` exchanges the code, provisions/reuses the
 * user, and issues the session cookie; `/api/auth/logout` ends the session.
 * The browser follows the redirects; the SPA never handles tokens
 * (SAD.md §13.1; FRONTEND.md §6 AI/SSO experience).
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import type { AuthenticateWithOidcHandler, EndSessionHandler } from '@nexora/application-identity';

import type { ApiConfig } from '../config.js';
import { generatePkce, type OidcGateway } from '../oidc/gateway.js';
import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Cookie name holding the PKCE code verifier between login and callback. */
const OIDC_VERIFIER_COOKIE = 'oidc_verifier';

/** Dependencies of the auth routes. */
export interface AuthRoutesDependencies {
  /** API configuration. */
  config: ApiConfig;
  /** The OIDC gateway. */
  oidc: OidcGateway;
  /** The OIDC authentication handler. */
  authenticate: AuthenticateWithOidcHandler;
  /** The logout handler. */
  endSession: EndSessionHandler;
}

/** Registers the auth routes. */
export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: AuthRoutesDependencies,
): void {
  const { config, oidc } = dependencies;

  // Redirect to the IdP with a CSRF state cookie and the PKCE verifier.
  app.get('/api/auth/login', { config: { public: true } }, async (_request, reply) => {
    const state = randomUUID();
    const pkce = generatePkce();
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: config.cookie.secure,
      path: '/',
      maxAge: 600,
    };
    reply.setCookie('oidc_state', state, cookieOptions);
    // The verifier is only needed at the callback; httpOnly + short maxAge
    // keeps it out of script scope.
    reply.setCookie(OIDC_VERIFIER_COOKIE, pkce.codeVerifier, cookieOptions);
    return reply.redirect(await oidc.buildAuthorizationUrl(state, pkce));
  });

  // Exchange the authorization code and issue the session cookie.
  app.get('/api/auth/callback', { config: { public: true } }, async (request, reply) => {
    const query = request.query as {
      code?: string;
      state?: string;
      iss?: string;
      session_state?: string;
    };
    const expectedState = request.cookies?.['oidc_state'];
    const codeVerifier = request.cookies?.[OIDC_VERIFIER_COOKIE];
    if (
      query.code === undefined ||
      query.state === undefined ||
      expectedState === undefined ||
      codeVerifier === undefined ||
      query.state !== expectedState
    ) {
      // Clear the OIDC cookies even on failure so a stale attempt cannot
      // shadow the next login (both cookies are single-use).
      reply.clearCookie('oidc_state', { path: '/' });
      reply.clearCookie(OIDC_VERIFIER_COOKIE, { path: '/' });
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid OIDC callback state',
          requestId: request.id,
        },
      });
    }
    reply.clearCookie('oidc_state', { path: '/' });
    reply.clearCookie(OIDC_VERIFIER_COOKIE, { path: '/' });

    // The full parsed callback query is passed to the gateway so the real
    // Keycloak flow (state + iss) validates end-to-end.
    const identity = await oidc.exchangeCode(query, expectedState, codeVerifier);
    const result = await dependencies.authenticate.handle({
      oidcSubject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName,
      issuer: identity.issuer,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    reply.setCookie(config.cookie.name, result.value.sessionToken, {
      httpOnly: true,
      sameSite: config.cookie.sameSite,
      secure: config.cookie.secure,
      path: '/',
      maxAge: config.cookie.maxAgeSeconds,
    });
    return reply.redirect(`${config.webOrigin}/app`);
  });

  // End the session, clear the cookie, and return to the web origin.
  app.get('/api/auth/logout', async (request, reply) => {
    const auth = requireAuth(request);
    const result = await dependencies.endSession.handle({
      sessionId: auth.sessionId,
      actorId: auth.userId,
      tenantId: auth.tenantId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    reply.clearCookie(config.cookie.name, { path: '/' });
    // End the IdP session too so a follow-up SSO login prompts again
    // (single logout, SAD.md §13.1). The IdP redirects back to the origin.
    // The local session is already ended, so an IdP discovery failure falls
    // back to the origin redirect instead of erroring after logout.
    try {
      return reply.redirect(await oidc.buildLogoutUrl(`${config.webOrigin}/`));
    } catch {
      return reply.redirect(`${config.webOrigin}/`);
    }
  });
}
