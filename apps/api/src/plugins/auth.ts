/**
 * @nexora/app-api — session authentication plugin.
 *
 * A pre-handler hook that resolves the session cookie into an authenticated
 * context (`request.auth`). Routes opt out with `config: { public: true }`
 * (health, OIDC login/callback). Session validation (expiry, idle timeout,
 * revocation) is delegated to the identity domain
 * (`SessionDomainService.validate`).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { SessionDomainService } from '@nexora/domain-identity';
import { AuthorizationError } from '@nexora/shared/errors';

import type { ApiConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated context, or `null` when unauthenticated. */
    auth: AuthContext | null;
  }

  interface FastifyContextConfig {
    /** Whether the route skips session authentication (public routes). */
    public?: boolean;
  }
}

/** The authenticated principal attached to protected requests. */
export interface AuthContext {
  /** The authenticated user. */
  userId: UserId;
  /** The validated session. */
  sessionId: string;
  /** The tenant the session belongs to. */
  tenantId: TenantId;
  /** The session token (used by logout). */
  sessionToken: string;
}

/** Dependencies of the auth plugin. */
export interface AuthPluginDependencies {
  /** API configuration (cookie name). */
  config: ApiConfig;
  /** The session domain service (token validation). */
  sessions: SessionDomainService;
}

/** Registers the session-cookie authentication hook. */
export function registerAuth(app: FastifyInstance, dependencies: AuthPluginDependencies): void {
  app.decorateRequest('auth', null);

  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.config.public === true) {
      return;
    }
    const token = request.cookies?.[dependencies.config.cookie.name];
    if (token === undefined) {
      return unauthorized(reply, request.id);
    }
    const validated = await dependencies.sessions.validate(token);
    if (!validated.ok) {
      return unauthorized(reply, request.id);
    }
    const session = validated.value;
    request.auth = {
      userId: session.userId,
      sessionId: session.id,
      tenantId: session.tenantId,
      sessionToken: token,
    };
  });
}

/** Returns the authenticated context of a protected request (never null). */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (request.auth === null) {
    throw new AuthorizationError('Unauthorized');
  }
  return request.auth;
}

/** Sends the canonical 401 response. */
function unauthorized(reply: FastifyReply, requestId: string): FastifyReply {
  return reply.code(401).send({
    error: {
      code: 'AUTHORIZATION_ERROR',
      message: 'Unauthorized',
      requestId,
    },
  });
}
