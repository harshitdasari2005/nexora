/**
 * @nexora/app-api — integrations routes.
 *
 * S20 Integrations + Polish (ROADMAP.md:408, PRD §20.2, V1-9): the workspace
 * webhook registry + delivery receipts, the email outbox read, and the
 * SIGNED inbound email action endpoint. Every endpoint follows the ONE
 * authorization path used by the other resource routes: `requireAuth` +
 * `authorizeScope` verify the caller is a member of the organization AND
 * the workspace through the trusted membership read models — a forged or
 * foreign scope resolves to 403, never to another tenant's record.
 *
 * The inbound email endpoint is the exception by design: it is an
 * UNauthenticated webhook-in (BKD §9.2 "webhooks in with signature
 * verification"). Its security is the HMAC signature over the raw body
 * (shared secret) + the workspace-scoped sender allowlist — NOT a session.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { fingerprintOf, type LineageRepository } from '@nexora/module-lineage';
import { prefixedId } from '@nexora/shared/ids';
import type { FastifyInstance } from 'fastify';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import {
  IntegrationApplicationService,
  type IntegrationApplicationService as IntegrationApplicationServiceType,
} from '@nexora/module-integrations';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';
import { authorizeScope, readScope } from './scope.js';

/** Dependencies of the integrations routes. */
export interface IntegrationsRoutesDependencies {
  /** The integration application service (registry + outbox + inbound). */
  integrations: IntegrationApplicationServiceType;
  /** The webhook-in shared secret (HMAC over the raw body). */
  inboundSecret: string;
  /** Append-only lineage (Prompt 6): records every VERIFIED inbound message and its outcome. */
  lineage?: LineageRepository;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC permission resolution — webhook administration requires `integrations.manage`. */
  permissions: PermissionResolverDependencies;
}

/** Registers the integrations routes. */
export async function registerIntegrationsRoutes(
  app: FastifyInstance,
  dependencies: IntegrationsRoutesDependencies,
): Promise<void> {
  // --- Webhook registry (authenticated, workspace-scoped) ----------------

  app.get('/api/integrations/webhooks', async (request, reply) => {
    const auth = requireAuth(request);
    const scope = readScope(request.query);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameters: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }
    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }
    const endpoints = await dependencies.integrations.listWebhookEndpoints(
      scope.organizationId as TenantId,
      scope.workspaceId as WorkspaceId,
    );
    return {
      endpoints: endpoints.map((endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        eventTypes: endpoint.eventTypes,
        enabled: endpoint.enabled,
        createdAt: endpoint.createdAt,
        updatedAt: endpoint.updatedAt,
        secretMasked: `${endpoint.secret.slice(0, 8)}…`,
      })),
      subscribableEvents: IntegrationApplicationService.subscribableEvents(),
    };
  });

  app.post('/api/integrations/webhooks', async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      url?: string;
      eventTypes?: unknown;
    };
    const scope = readScope(body);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }
    if (typeof body.url !== 'string' || body.url.length === 0) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body field: url',
          requestId: request.id,
        },
      });
    }
    const eventTypes = Array.isArray(body.eventTypes)
      ? body.eventTypes.filter((value): value is string => typeof value === 'string')
      : [];
    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.organizationId, workspaceId: scope.workspaceId },
      'integrations.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'manage integrations');
    }
    const result = await dependencies.integrations.createWebhookEndpoint({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      url: body.url,
      eventTypes,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    // The secret is exposed EXACTLY once — at creation.
    return reply.code(201).send({
      endpoint: {
        id: result.value.endpoint.id,
        url: result.value.endpoint.url,
        eventTypes: result.value.endpoint.eventTypes,
        enabled: result.value.endpoint.enabled,
        createdAt: result.value.endpoint.createdAt,
      },
      secret: result.value.secret,
    });
  });

  app.patch('/api/integrations/webhooks/:endpointId', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { endpointId: string };
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      url?: string;
      eventTypes?: unknown;
    };
    const scope = readScope(body);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }
    if (typeof body.url !== 'string' || body.url.length === 0) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body field: url',
          requestId: request.id,
        },
      });
    }
    const eventTypes = Array.isArray(body.eventTypes)
      ? body.eventTypes.filter((value): value is string => typeof value === 'string')
      : [];
    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.organizationId, workspaceId: scope.workspaceId },
      'integrations.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'manage integrations');
    }
    const result = await dependencies.integrations.updateWebhookEndpoint({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      endpointId: params.endpointId,
      url: body.url,
      eventTypes,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return {
      endpoint: {
        id: result.value.id,
        url: result.value.url,
        eventTypes: result.value.eventTypes,
        enabled: result.value.enabled,
        updatedAt: result.value.updatedAt,
      },
    };
  });

  app.post('/api/integrations/webhooks/:endpointId/enable', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { endpointId: string };
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      enabled?: unknown;
    };
    const scope = readScope(body);
    if (scope === undefined || typeof body.enabled !== 'boolean') {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId, enabled',
          requestId: request.id,
        },
      });
    }
    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.organizationId, workspaceId: scope.workspaceId },
      'integrations.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'manage integrations');
    }
    const result = await dependencies.integrations.setWebhookEndpointEnabled({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      endpointId: params.endpointId,
      enabled: body.enabled,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return {
      endpoint: {
        id: result.value.id,
        enabled: result.value.enabled,
        updatedAt: result.value.updatedAt,
      },
    };
  });

  app.delete('/api/integrations/webhooks/:endpointId', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { endpointId: string };
    const scope = readScope(request.body);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }
    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.organizationId, workspaceId: scope.workspaceId },
      'integrations.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'manage integrations');
    }
    const result = await dependencies.integrations.deleteWebhookEndpoint({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      endpointId: params.endpointId,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(204).send();
  });

  // --- Delivery receipts (authenticated, workspace-scoped) ---------------

  app.get('/api/integrations/webhooks/:endpointId/deliveries', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { endpointId: string };
    const scope = readScope(request.query);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameters: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }
    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }
    const deliveries = await dependencies.integrations.listWebhookDeliveries(
      scope.organizationId as TenantId,
      params.endpointId,
      { workspaceId: scope.workspaceId as WorkspaceId, limit: 50 },
    );
    if (!deliveries.ok) {
      const http = toHttpError(deliveries.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return {
      deliveries: deliveries.value.map((delivery) => ({
        id: delivery.id,
        endpointId: delivery.endpointId,
        eventId: delivery.eventId,
        eventType: delivery.eventType,
        status: delivery.status,
        attempt: delivery.attempt,
        statusCode: delivery.statusCode,
        error: delivery.error,
        deliveredAt: delivery.deliveredAt,
      })),
    };
  });

  // --- Email outbox (authenticated, tenant-scoped) ------------------------

  app.get('/api/integrations/email/outbox', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };
    if (
      typeof query.organizationId !== 'string' ||
      query.organizationId.length === 0 ||
      typeof query.workspaceId !== 'string' ||
      query.workspaceId.length === 0
    ) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameters: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }
    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      query.organizationId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }
    const records = await dependencies.integrations.listEmailOutbox(
      query.organizationId as TenantId,
      { workspaceId: query.workspaceId as WorkspaceId, limit: 50 },
    );
    return {
      emails: records.map((record) => ({
        id: record.id,
        recipientEmail: record.recipientEmail,
        subject: record.subject,
        body: record.body,
        sourceEventId: record.sourceEventId,
        dispatchedAt: record.dispatchedAt,
      })),
    };
  });

  // --- Inbound email action (UNAUTHENTICATED webhook-in, signed) ---------
  //
  // The raw body is required for signature verification, so this endpoint
  // lives in its own encapsulated plugin that parses JSON as a string and
  // exposes the raw bytes on the request (Fastify content-type parsers are
  // scope-encapsulated — the default JSON parser everywhere else is
  // untouched).
  await app.register(async (inboundApp) => {
    inboundApp.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (request, body, done) => {
        const raw = typeof body === 'string' ? body : body.toString('utf8');
        (request as { rawBody?: string }).rawBody = raw;
        try {
          done(null, JSON.parse(raw) as unknown);
        } catch {
          done(new Error('Invalid JSON body') as never, undefined);
        }
      },
    );

    inboundApp.post(
      '/api/integrations/email/inbound',
      { config: { public: true } },
      async (request, reply) => {
        // The signature covers the serialized request body the sender
        // produced (documented in the outbound email action contract).
        const signature = request.headers['x-nexora-inbound-signature'];
        if (typeof signature !== 'string' || signature.length === 0) {
          return reply.code(401).send({
            error: {
              code: 'AUTHORIZATION_ERROR',
              message: 'Missing x-nexora-inbound-signature header',
              requestId: request.id,
            },
          });
        }
        const raw = (request as { rawBody?: string }).rawBody;
        if (raw === undefined || !verifySignature(dependencies.inboundSecret, raw, signature)) {
          return reply.code(401).send({
            error: {
              code: 'AUTHORIZATION_ERROR',
              message: 'Invalid inbound signature',
              requestId: request.id,
            },
          });
        }

        const body = request.body as {
          organizationId?: string;
          workspaceId?: string;
          messageId?: string;
          from?: string;
          action?: string;
          targetId?: string;
          decision?: string;
        };
        if (
          typeof body.organizationId !== 'string' ||
          typeof body.workspaceId !== 'string' ||
          typeof body.messageId !== 'string' ||
          typeof body.from !== 'string' ||
          typeof body.action !== 'string' ||
          typeof body.targetId !== 'string'
        ) {
          return reply.code(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message:
                'Missing or invalid body fields: organizationId, workspaceId, messageId, from, action, targetId',
              requestId: request.id,
            },
          });
        }

        // The actor is the allowlisted sender, resolved by the composition
        // root's inbound routing (trusted identity read — the inbound email
        // never supplies a user id).
        const result = await dependencies.integrations.routeInboundEmail({
          tenantId: body.organizationId as TenantId,
          workspaceId: body.workspaceId as WorkspaceId,
          messageId: body.messageId,
          from: body.from,
          action: body.action,
          targetId: body.targetId,
          decision: body.decision,
          actorId: body.from,
          correlationId: request.id,
        });
        // Lineage (Prompt 6): a VERIFIED inbound message is external DATA. Record
        // its provenance and outcome — the message id, a fingerprint of the
        // (allowlisted) sender rather than the address, the action and the
        // result. The scope is the signed body's; nothing here is authority
        // (an "approved" in the payload is not an approval — only the
        // verified processing above, through the shared approval
        // authorization, can decide one).
        if (dependencies.lineage !== undefined) {
          try {
            await dependencies.lineage.append([
              {
                id: prefixedId('lin'),
                tenantId: body.organizationId,
                workspaceId: body.workspaceId,
                runId: `inbound:${body.messageId}`,
                kind: 'EVIDENCE',
                occurredAt: new Date().toISOString(),
                seq: 0,
                ...(body.action === 'approval.decide' ? { approvalId: body.targetId } : {}),
                subjectType: 'INBOUND_MESSAGE',
                subjectId: body.messageId,
                fingerprint: fingerprintOf({
                  messageId: body.messageId,
                  action: body.action,
                  targetId: body.targetId,
                  decision: body.decision,
                }),
                data: {
                  sourceType: 'INBOUND_MESSAGE',
                  sourceId: body.messageId,
                  retrievedAt: new Date().toISOString(),
                  trust: 'EXTERNAL_CONTENT',
                  retrievalMethod: 'inbound_email',
                  toolId: 'integrations.inbound',
                  signature: 'verified',
                  senderFingerprint: fingerprintOf(body.from.toLowerCase()),
                  action: body.action,
                  outcome: result.ok ? 'processed' : 'rejected',
                  ...(result.ok ? {} : { errorCode: result.error.code }),
                },
              },
            ]);
          } catch {
            // Descriptive and best-effort: never changes the result.
          }
        }
        if (!result.ok) {
          const http = toHttpError(result.error, request.id);
          return reply.code(http.statusCode).send(http.body);
        }
        return {
          action: result.value.action,
          messageId: result.value.messageId,
          workspaceId: result.value.workspaceId,
        };
      },
    );
  });
}

/**
 * Verifies an HMAC-SHA256 signature over the raw body (constant time).
 * The HMAC construction (S21 finding IN-02) replaced the previous plain
 * `sha256(secret:body)` concatenation hash.
 */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

/** Signs a raw body with the inbound shared secret (test/dev helper). */
export function signInboundBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
