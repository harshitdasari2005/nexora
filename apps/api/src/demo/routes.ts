/**
 * @nexora/app-api — Demo World routes.
 *
 * Registered ONLY when demo mode is explicitly enabled (NEXORA_DEMO_MODE);
 * otherwise these routes do not exist (404) and normal authentication is
 * untouched.
 *
 * Security shape:
 * - `POST /api/demo/login` accepts a persona KEY from a fixed enum — never an
 *   email or user id (the schema rejects any other property). The backend maps
 *   persona → deterministic seeded user → a REAL session; every request the
 *   browser then makes runs the normal authorization pipeline.
 * - `POST /api/demo/reset` takes NO target: it resets the fixed demo
 *   organization only, and only for a caller whose session belongs to a demo
 *   persona.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { EndSessionHandler } from '@nexora/application-identity';
import type { SessionDomainService } from '@nexora/domain-identity';

import type { ApiConfig } from '../config.js';
import { requireAuth } from '../plugins/auth.js';
import { DemoError, type DemoService } from './demo-service.js';
import {
  DEMO_HIRE_REQUEST,
  DEMO_PERSONA_KEYS,
  DEMO_PROJECT_NAME,
  DEMO_BUDGET_NAME,
  DEMO_EXPENSE,
} from './world.js';

/** Dependencies of the demo routes. */
export interface DemoRoutesDependencies {
  config: ApiConfig;
  demo: DemoService;
  sessions: SessionDomainService;
  endSession: EndSessionHandler;
}

const STATUS_BY_DEMO_ERROR: Record<DemoError['code'], number> = {
  DEMO_NOT_SEEDED: 409,
  DEMO_SEED_CONFLICT: 409,
  DEMO_RESET_UNAVAILABLE: 501,
  DEMO_BUSY: 409,
  DEMO_NOT_DEMO_USER: 403,
};

// The bodies are validated by hand: Fastify's default Ajv silently STRIPS
// unknown properties, and here an unexpected property (an email, a user id, an
// organization id) is a rejected request, not an ignored one.
function badRequest(reply: FastifyReply, requestId: string, message: string): FastifyReply {
  return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message, requestId } });
}

function hasExactly(body: unknown, keys: readonly string[]): body is Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return keys.length === 0;
  const present = Object.keys(body);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}

/** Registers the demo routes (call only when demo mode is enabled). */
export function registerDemoRoutes(
  app: FastifyInstance,
  dependencies: DemoRoutesDependencies,
): void {
  const { config, demo } = dependencies;

  const cookieOptions = {
    httpOnly: true,
    sameSite: config.cookie.sameSite,
    secure: config.cookie.secure,
    path: '/',
    maxAge: config.cookie.maxAgeSeconds,
  };

  // While a reset runs, every other request is refused (the world is being
  // rebuilt); otherwise requests are tracked so a reset can wait for them.
  app.addHook('onRequest', async (request, reply) => {
    // The MATCHED route, not the raw URL: an encoded path (`/api/demo/%72eset`) is
    // routed to the same handler, so the raw string must not decide the gating.
    const path = request.routeOptions.url ?? '';
    if (!path.startsWith('/api/') || path === '/api/demo/reset' || path === '/api/health') return;
    // The notification stream is a passive, open-ended subscription that the app
    // shell holds open for the whole session: it is neither gated nor counted as
    // in-flight work (the reset ends every demo session, which closes it).
    if (path === '/api/notifications/stream') return;
    if (demo.resetting) {
      return reply.code(503).send({
        error: {
          code: 'DEMO_RESETTING',
          message: 'The demo world is being reset — retry in a moment',
          requestId: request.id,
        },
      });
    }
    const release = demo.track();
    reply.raw.once('close', release);
    return undefined;
  });

  app.get('/api/demo/config', { config: { public: true } }, async () => ({
    enabled: true,
    seeded: await demo.isSeeded(),
    organizationId: demo.ids.organizationId,
    personas: demo.personas(),
    story: {
      hireRequest: DEMO_HIRE_REQUEST,
      projectName: DEMO_PROJECT_NAME,
      budgetName: DEMO_BUDGET_NAME,
      expense: DEMO_EXPENSE,
    },
  }));

  app.post('/api/demo/login', { config: { public: true } }, async (request, reply) => {
    const body = request.body;
    if (
      !hasExactly(body, ['persona']) ||
      typeof body['persona'] !== 'string' ||
      !(DEMO_PERSONA_KEYS as readonly string[]).includes(body['persona'])
    ) {
      return badRequest(reply, request.id, 'Body must be exactly { persona: <demo persona key> }');
    }
    const persona = body['persona'];
    try {
      // Switching persona ends the previous demo session (best effort — an
      // expired/absent cookie is simply ignored).
      const previous = request.cookies?.[config.cookie.name];
      if (previous !== undefined) {
        const validated = await dependencies.sessions.validate(previous);
        if (validated.ok) {
          await dependencies.endSession.handle({
            sessionId: validated.value.id,
            actorId: validated.value.userId,
            tenantId: validated.value.tenantId,
            correlationId: request.id,
          });
        }
      }
      const result = await demo.login(persona);
      reply.setCookie(config.cookie.name, result.sessionToken, cookieOptions);
      return { persona: result.persona };
    } catch (error) {
      return sendDemoError(reply, request.id, error);
    }
  });

  app.post('/api/demo/reset', async (request, reply) => {
    const auth = requireAuth(request);
    // The browser cannot choose what is reset: no property is accepted.
    if (request.body !== undefined && request.body !== null && !hasExactly(request.body, [])) {
      return badRequest(reply, request.id, 'Reset takes no parameters');
    }
    const persona = demo.personaOfUser(auth.userId);
    if (persona === undefined) {
      return reply.code(403).send({
        error: {
          code: 'DEMO_NOT_DEMO_USER',
          message: 'Only a demo persona session can reset the demo world',
          requestId: request.id,
        },
      });
    }
    try {
      const result = await demo.reset(auth.userId);
      // The reset deleted the demo users (and with them every session):
      // re-establish the SAME persona's real session.
      const session = await demo.login(persona);
      reply.setCookie(config.cookie.name, session.sessionToken, cookieOptions);
      return {
        ok: true,
        persona: session.persona,
        resetAt: result.resetAt,
        deleted: result.deleted,
      };
    } catch (error) {
      return sendDemoError(reply, request.id, error);
    }
  });
}

/** Demo mode off: the demo endpoints answer 404 to everyone (authenticated or not). */
export function registerDemoDisabledRoutes(app: FastifyInstance): void {
  const notFound = async (request: { id: string }, reply: FastifyReply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id },
    });
  app.get('/api/demo/config', { config: { public: true } }, notFound);
  app.post('/api/demo/login', { config: { public: true } }, notFound);
  app.post('/api/demo/reset', { config: { public: true } }, notFound);
}

function sendDemoError(reply: FastifyReply, requestId: string, error: unknown): FastifyReply {
  if (error instanceof DemoError) {
    return reply.code(STATUS_BY_DEMO_ERROR[error.code]).send({
      error: { code: error.code, message: error.message, requestId },
    });
  }
  throw error;
}
