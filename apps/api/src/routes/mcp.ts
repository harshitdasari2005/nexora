/**
 * @nexora/app-api — remote MCP routes (S24 Phase 6).
 *
 * `GET/POST /api/mcp` — the AUTHENTICATED remote MCP surface. The route is
 * protected by the SAME session-cookie authentication as every other API
 * route (`requireAuth`): there is no anonymous MCP access. Per request the
 * route derives the TRUSTED identity from the authenticated session —
 * tenant from organization membership (the same resolution the AI route
 * uses), and the optional `X-Nexora-Workspace` header validated against the
 * caller's workspace memberships (a foreign workspace is 403, never
 * silently switched to). The MCP engine then resolves each session's
 * business domain/role/capability affinity ONCE from that trusted identity
 * via the same `buildAIBusinessContext` seam the Command Center and AI use
 * — the client can never supply identity, tenant, workspace, role, or
 * capability.
 *
 * Session binding: an MCP session is bound to the authenticated identity
 * that created it. A later request authenticated as a different user cannot
 * reuse (hijack) the session (the engine rejects the mismatch).
 *
 * CSRF: the surface requires a custom header (`X-Nexora-Workspace` when a
 * workspace is selected) and JSON bodies — neither is sendable by a
 * cross-origin HTML form, and the session cookie is SameSite=Lax, so the
 * existing web auth is not weakened. No `Access-Control-Allow-Origin: *` is
 * ever emitted — the surface is same-origin/local-development compatible.
 *
 * NOTE: the reply is hijacked — the MCP transport writes directly to the
 * raw HTTP response. Errors are mapped to MCP JSON-RPC errors; internals
 * are never leaked.
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { AIBusinessContext } from '@nexora/ai-runtime';
import type { NexoraMCPContext, NexoraMCPServer } from '@nexora/mcp';
import { prefixedId } from '@nexora/shared/ids';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';

/** Dependencies of the remote MCP routes. */
export interface McpRoutesDependencies {
  /** The Nexora MCP server engine (transport-agnostic). */
  server: NexoraMCPServer;
  /** Resolves the caller's organizations (tenant scope — same as the AI route). */
  listOrganizations: ListOrganizationsHandler;
  /** Membership-scoped workspace listing (validates the workspace header). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /**
   * Builds the TRUSTED business context (domain/role/capability affinity)
   * from membership + the Phase 1 catalog — the SAME seam as the AI route.
   * Called ONCE per MCP session, never per tool call.
   */
  buildBusinessContext: (context: {
    userId: string;
    tenantId: string;
    workspaceId?: string;
  }) => Promise<AIBusinessContext | undefined>;
}

/** Registers the authenticated remote MCP surface. */
export function registerMcpRoutes(app: FastifyInstance, dependencies: McpRoutesDependencies): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/mcp',
    handler: async (request, reply) => {
      const auth = requireAuth(request);

      // Tenant scope: the session tenant is the platform bootstrap tenant,
      // so the caller's organization is resolved through memberships —
      // exactly like the AI route (the server remains authoritative).
      const organizations = await dependencies.listOrganizations.handle({
        userId: auth.userId as UserId,
      });
      if (!organizations.ok) {
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Could not resolve your organization',
            requestId: request.id,
          },
        });
      }
      const tenantId = organizations.value[0]?.id as TenantId | undefined;
      if (tenantId === undefined) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Create an organization before using the MCP surface',
            requestId: request.id,
          },
        });
      }

      // Workspace selection: an optional header, validated against the
      // caller's workspace MEMBERSHIPS (membership is the access rule — a
      // foreign workspace resolves to 403, never silently switched to).
      const header = request.headers['x-nexora-workspace'];
      const rawWorkspace = Array.isArray(header) ? header[0] : header;
      let workspaceId: string | undefined;
      if (rawWorkspace !== undefined && rawWorkspace.trim().length > 0) {
        const mine = await dependencies.listMyWorkspaces.handle({
          userId: auth.userId as UserId,
          organizationId: tenantId,
        });
        const canAccess = mine.ok && mine.value.some((workspace) => workspace.id === rawWorkspace);
        if (!canAccess) {
          return reply.code(403).send({
            error: {
              code: 'AUTHORIZATION_ERROR',
              message: 'You are not a member of this workspace',
              requestId: request.id,
            },
          });
        }
        workspaceId = rawWorkspace;
      }

      const identity = {
        userId: auth.userId,
        tenantId,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      };

      // Hijack: the MCP transport owns the response stream from here.
      reply.hijack();
      try {
        await dependencies.server.handleHttpRequest(request.raw, reply.raw, request.body, {
          identity,
          resolveContext: async (id): Promise<NexoraMCPContext> => {
            const business = await dependencies.buildBusinessContext(id);
            return {
              userId: id.userId,
              tenantId: id.tenantId,
              ...(id.workspaceId === undefined
                ? {}
                : { workspaceId: id.workspaceId as WorkspaceId }),
              businessDomain: business?.domainId,
              businessRole: business?.roleId,
              capabilityIds: business?.capabilityIds ?? [],
              correlationId: prefixedId('mcp'),
            };
          },
        });
      } catch (error) {
        request.log.error({ err: error, requestId: request.id }, 'mcp request failed');
        const raw = reply.raw;
        if (!raw.headersSent) {
          raw.writeHead(500, { 'content-type': 'application/json' });
        }
        // Stable MCP JSON-RPC internal error — never a stack trace or an
        // internal path.
        raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
          }),
        );
      }
    },
  });
}
