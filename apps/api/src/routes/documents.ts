/**
 * @nexora/app-api — document routes.
 *
 * The Documents + Knowledge REST surface for the vertical slice: upload
 * (store bytes → persist metadata → processing → knowledge index), list,
 * get, and archive. Every endpoint enforces TWO trusted server-side
 * authorization boundaries:
 *
 * 1. Organization membership — the authenticated user must be a member of
 *    the organization (tenant scope).
 * 2. Workspace membership — the authenticated user must be a member of the
 *    target workspace (workspace scope).
 *
 * A user who is a member of organization A / workspace W1 can never read,
 * upload, or archive a document in workspace W2 of the same organization or
 * in another tenant. The filename and content are DATA — they never affect
 * authorization.
 *
 * The client may not supply identity: tenant/workspace come from the query
 * (resource scope) but are verified against the trusted membership read
 * models; a forged or foreign workspace resolves to 403/404, never to
 * another tenant's record.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import { toDocumentDto } from '@nexora/application-documents';
import type {
  ArchiveDocumentHandler,
  GetDocumentHandler,
  ListDocumentsHandler,
  UploadDocumentHandler,
} from '@nexora/application-documents';
import type { IndexDocumentHandler } from '@nexora/application-knowledge';
import type {
  RemoveDocumentIndexHandler,
  RetrieveKnowledgeHandler,
} from '@nexora/application-knowledge';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Request body schema for POST /api/documents. */
const uploadDocumentSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'title', 'contentType', 'content'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      contentType: { type: 'string', minLength: 1, maxLength: 64 },
      // base64-encoded bytes (Fastify/JSON; the route decodes to a Buffer).
      content: { type: 'string', minLength: 1 },
    },
  },
};

/** Dependencies of the document routes. */
export interface DocumentRoutesDependencies {
  uploadDocument: UploadDocumentHandler;
  archiveDocument: ArchiveDocumentHandler;
  listDocuments: ListDocumentsHandler;
  getDocument: GetDocumentHandler;
  indexDocument: IndexDocumentHandler;
  removeDocumentIndex: RemoveDocumentIndexHandler;
  retrieveKnowledge: RetrieveKnowledgeHandler;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
}

/**
 * Verifies the caller is a member of the organization AND the workspace
 * (two independent trusted read models — a forged scope fails closed).
 */
async function authorizeScope(
  dependencies: DocumentRoutesDependencies,
  userId: string,
  organizationId: string,
  workspaceId: string,
): Promise<string | undefined> {
  const membership = await dependencies.listOrganizations.handle({ userId: userId as UserId });
  const orgAccessible = membership.ok && membership.value.some((org) => org.id === organizationId);
  if (!orgAccessible) {
    return 'You are not a member of this organization';
  }
  const workspaces = await dependencies.listMyWorkspaces.handle({
    userId: userId as UserId,
    organizationId: organizationId as TenantId,
  });
  const workspaceAccessible =
    workspaces.ok && workspaces.value.some((workspace) => workspace.id === workspaceId);
  if (!workspaceAccessible) {
    return 'You are not a member of this workspace';
  }
  return undefined;
}

/** Registers the document routes. */
export function registerDocumentRoutes(
  app: FastifyInstance,
  dependencies: DocumentRoutesDependencies,
): void {
  app.post('/api/documents', { schema: uploadDocumentSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
      workspaceId: string;
      title: string;
      contentType: string;
      content: string;
    };

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      body.organizationId,
      body.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const uploaded = await dependencies.uploadDocument.handle({
      organizationId: body.organizationId as TenantId,
      workspaceId: body.workspaceId as WorkspaceId,
      uploaderId: auth.userId as UserId,
      title: body.title,
      contentType: body.contentType,
      content: Buffer.from(body.content, 'base64'),
      correlationId: request.id,
    });
    if (!uploaded.ok) {
      const http = toHttpError(uploaded.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Document → Knowledge ingest: index the extracted text when processing
    // succeeded (the document is then answerable through permission-filtered
    // retrieval). A failed extraction yields an honest `failed` document and
    // no index entry — indexing is never faked.
    const extractedText = uploaded.value.extractedText;
    if (extractedText !== undefined && extractedText.trim().length > 0) {
      await dependencies.indexDocument.handle({
        tenantId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        documentId: uploaded.value.document.id,
        title: body.title,
        text: extractedText,
        version: uploaded.value.document.contentVersion,
        context: { actorId: auth.userId as UserId, correlationId: request.id },
      });
    }

    return reply.code(201).send({
      document: toDocumentDto(uploaded.value.document),
      indexed: extractedText !== undefined && extractedText.trim().length > 0,
    });
  });

  app.get('/api/documents', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };
    if (query.organizationId === undefined || query.workspaceId === undefined) {
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

    const result = await dependencies.listDocuments.handle({
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { documents: result.value };
  });

  app.get('/api/documents/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
    const query = request.query as { organizationId?: string; workspaceId?: string };
    if (query.organizationId === undefined || query.workspaceId === undefined) {
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

    const result = await dependencies.getDocument.handle({
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
      documentId: params.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { document: result.value };
  });

  app.post('/api/documents/:id/archive', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
    const body = request.body as { organizationId?: string; workspaceId?: string };
    if (body.organizationId === undefined || body.workspaceId === undefined) {
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
      body.organizationId,
      body.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const result = await dependencies.archiveDocument.handle({
      organizationId: body.organizationId as TenantId,
      workspaceId: body.workspaceId as WorkspaceId,
      actorId: auth.userId,
      documentId: params.id,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Archiving removes the document from the knowledge index: an archived
    // document must never answer a retrieval (stale projections never
    // surface). Index cleanup is best-effort after the authoritative domain
    // mutation — a failure is logged, never reported as a mutation failure
    // (the archive itself already succeeded and must not be reported as
    // failed because the projection cleanup lagged).
    try {
      const cleanup = await dependencies.removeDocumentIndex.handle({
        tenantId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        documentId: params.id,
        context: { actorId: auth.userId, correlationId: request.id },
      });
      if (!cleanup.ok) {
        request.log.error(
          { documentId: params.id, requestId: request.id, error: cleanup.error },
          'knowledge index cleanup failed after document archive',
        );
      }
    } catch (error) {
      request.log.error(
        { err: error, documentId: params.id, requestId: request.id },
        'knowledge index cleanup failed after document archive',
      );
    }

    return { document: toDocumentDto(result.value.document) };
  });

  app.get('/api/knowledge/search', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as {
      organizationId?: string;
      workspaceId?: string;
      q?: string;
      limit?: string;
    };
    if (
      query.organizationId === undefined ||
      query.workspaceId === undefined ||
      query.q === undefined
    ) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameters: organizationId, workspaceId, q',
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

    const result = await dependencies.retrieveKnowledge.handle({
      tenantId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
      query: query.q,
      limit: query.limit === undefined ? undefined : Number(query.limit),
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { references: result.value.references };
  });
}
