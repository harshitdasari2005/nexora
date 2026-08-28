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
 *
 * A THIRD boundary (P0 security hardening) sits on top of both: the
 * caller's effective RBAC capability — `documents.read` for every read
 * endpoint, `documents.upload` for every endpoint that writes (upload, new
 * version, restore, archive, templates). Membership proves tenant
 * isolation, not authorization; a member of the workspace without the
 * capability is rejected with 403 via the SAME `authorizePermission` every
 * other surface uses — never a second permission model.
 */

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import {
  toDocumentDto,
  toDocumentTemplateDto,
  toDocumentVersionDto,
} from '@nexora/application-documents';
import type {
  ArchiveDocumentHandler,
  ArchiveDocumentTemplateHandler,
  CreateDocumentFromTemplateHandler,
  CreateDocumentTemplateHandler,
  GetDocumentHandler,
  GetDocumentVersionContentHandler,
  ListDocumentTemplatesHandler,
  ListDocumentVersionsHandler,
  ListDocumentsHandler,
  RestoreDocumentVersionHandler,
  UploadDocumentHandler,
  UploadDocumentVersionHandler,
} from '@nexora/application-documents';
import type { IndexDocumentHandler } from '@nexora/application-knowledge';
import type {
  RemoveDocumentIndexHandler,
  RetrieveKnowledgeHandler,
} from '@nexora/application-knowledge';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { toHttpError } from '../http/errors.js';
import { sendForbidden } from './permission-response.js';
import { authorizeScope, readScope } from './scope.js';

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
  listDocumentVersions: ListDocumentVersionsHandler;
  uploadDocumentVersion: UploadDocumentVersionHandler;
  restoreDocumentVersion: RestoreDocumentVersionHandler;
  getDocumentVersionContent: GetDocumentVersionContentHandler;
  createDocumentTemplate: CreateDocumentTemplateHandler;
  listDocumentTemplates: ListDocumentTemplatesHandler;
  archiveDocumentTemplate: ArchiveDocumentTemplateHandler;
  createDocumentFromTemplate: CreateDocumentFromTemplateHandler;
  indexDocument: IndexDocumentHandler;
  removeDocumentIndex: RemoveDocumentIndexHandler;
  retrieveKnowledge: RetrieveKnowledgeHandler;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
}

/**
 * The capability half of this file's authorization boundary — called right
 * after `authorizeScope` passes at every endpoint. Returns `true` when the
 * caller may proceed; otherwise sends the standard 403 and returns that
 * reply — the call site's `if (result !== true) return result;` mirrors how
 * every other route already returns `sendForbidden`'s own result directly.
 * Local to this file only to avoid repeating the same lines at thirteen
 * call sites — not a new authorization primitive, `authorizePermission`
 * does the actual work.
 */
async function requireDocumentCapability(
  dependencies: DocumentRoutesDependencies,
  reply: FastifyReply,
  requestId: string,
  userId: string,
  organizationId: string,
  workspaceId: string,
  capability: string,
  action: string,
): Promise<true | unknown> {
  const authz = await authorizePermission(
    dependencies.permissions,
    { userId, tenantId: organizationId, workspaceId },
    capability,
  );
  if (!authz.ok) {
    return sendForbidden(reply, requestId, action);
  }
  return true;
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      body.organizationId,
      body.workspaceId,
      'documents.upload',
      'upload a document',
    );
    if (capable !== true) return capable;

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
        // The initial content revision IS v1 (the version-history model).
        // `document.contentVersion` is the legacy processing counter (2 after
        // the first processing) — never use it as the revision number.
        version: 1,
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      query.organizationId,
      query.workspaceId,
      'documents.read',
      'view documents',
    );
    if (capable !== true) return capable;

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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      query.organizationId,
      query.workspaceId,
      'documents.read',
      'view this document',
    );
    if (capable !== true) return capable;

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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      body.organizationId,
      body.workspaceId,
      'documents.upload',
      'archive this document',
    );
    if (capable !== true) return capable;

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

  // --- S17: document version history -------------------------------------

  app.get('/api/documents/:id/versions', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
      'documents.read',
      'view document versions',
    );
    if (capable !== true) return capable;

    const result = await dependencies.listDocumentVersions.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      documentId: params.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { versions: result.value };
  });

  app.post('/api/documents/:id/versions', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      contentType?: string;
      content?: string;
    };
    const scope = readScope(body);
    if (
      scope === undefined ||
      typeof body.contentType !== 'string' ||
      typeof body.content !== 'string'
    ) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Missing required body fields: organizationId, workspaceId, contentType, content',
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
      'documents.upload',
      'add a new document version',
    );
    if (capable !== true) return capable;

    const uploaded = await dependencies.uploadDocumentVersion.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      documentId: params.id,
      contentType: body.contentType,
      content: Buffer.from(body.content, 'base64'),
      correlationId: request.id,
    });
    if (!uploaded.ok) {
      const http = toHttpError(uploaded.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Index freshness: the new revision replaces the document's index entry
    // (stale content never answers) — only when the content processed.
    const extractedText = uploaded.value.extractedText;
    if (extractedText !== undefined && extractedText.trim().length > 0) {
      await dependencies.indexDocument.handle({
        tenantId: scope.organizationId as TenantId,
        workspaceId: scope.workspaceId as WorkspaceId,
        documentId: uploaded.value.document.id,
        title: uploaded.value.document.title.value,
        text: extractedText,
        version: uploaded.value.versionNumber,
        context: { actorId: auth.userId as UserId, correlationId: request.id },
      });
    }

    return reply.code(201).send({
      document: toDocumentDto(uploaded.value.document),
      version: toDocumentVersionDto(uploaded.value.version),
      versionNumber: uploaded.value.versionNumber,
      indexed: extractedText !== undefined && extractedText.trim().length > 0,
    });
  });

  app.post('/api/documents/:id/versions/:version/restore', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string; version: string };
    const version = Number(params.version);
    if (!Number.isInteger(version) || version <= 0) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'version must be a positive integer',
          requestId: request.id,
        },
      });
    }
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
      'documents.upload',
      'restore a document version',
    );
    if (capable !== true) return capable;

    const restored = await dependencies.restoreDocumentVersion.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      documentId: params.id,
      version,
      correlationId: request.id,
    });
    if (!restored.ok) {
      const http = toHttpError(restored.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Index freshness: retrieval must reflect the restored content.
    const extractedText = restored.value.extractedText;
    if (extractedText !== undefined && extractedText.trim().length > 0) {
      await dependencies.indexDocument.handle({
        tenantId: scope.organizationId as TenantId,
        workspaceId: scope.workspaceId as WorkspaceId,
        documentId: restored.value.document.id,
        title: restored.value.document.title.value,
        text: extractedText,
        version: restored.value.versionNumber,
        context: { actorId: auth.userId as UserId, correlationId: request.id },
      });
    }

    return reply.code(200).send({
      document: toDocumentDto(restored.value.document),
      version: toDocumentVersionDto(restored.value.version),
      versionNumber: restored.value.versionNumber,
      restoredFromVersion: restored.value.restoredFromVersion,
      indexed: extractedText !== undefined && extractedText.trim().length > 0,
    });
  });

  app.get('/api/documents/:id/versions/:version/content', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string; version: string };
    const version = Number(params.version);
    if (!Number.isInteger(version) || version <= 0) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'version must be a positive integer',
          requestId: request.id,
        },
      });
    }
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
      'documents.read',
      'view document version content',
    );
    if (capable !== true) return capable;

    const result = await dependencies.getDocumentVersionContent.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      documentId: params.id,
      version,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return {
      documentId: params.id,
      version,
      contentType: result.value.contentType,
      content: result.value.content.toString('base64'),
    };
  });

  // --- S17: document templates --------------------------------------------

  app.post('/api/documents/templates', async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      name?: string;
      description?: string;
      contentType?: string;
      content?: string;
    };
    const scope = readScope(body);
    if (
      scope === undefined ||
      typeof body.name !== 'string' ||
      typeof body.contentType !== 'string' ||
      typeof body.content !== 'string'
    ) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Missing required body fields: organizationId, workspaceId, name, contentType, content',
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
      'documents.upload',
      'create a document template',
    );
    if (capable !== true) return capable;

    const created = await dependencies.createDocumentTemplate.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      name: body.name,
      description: body.description,
      contentType: body.contentType,
      content: Buffer.from(body.content, 'base64'),
      correlationId: request.id,
    });
    if (!created.ok) {
      const http = toHttpError(created.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({ template: toDocumentTemplateDto(created.value.template) });
  });

  app.get('/api/documents/templates', async (request, reply) => {
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
      'documents.read',
      'view document templates',
    );
    if (capable !== true) return capable;

    const result = await dependencies.listDocumentTemplates.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { templates: result.value };
  });

  app.post('/api/documents/templates/:id/archive', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
      'documents.upload',
      'archive a document template',
    );
    if (capable !== true) return capable;

    const archived = await dependencies.archiveDocumentTemplate.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      templateId: params.id,
      correlationId: request.id,
    });
    if (!archived.ok) {
      const http = toHttpError(archived.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { template: toDocumentTemplateDto(archived.value.template) };
  });

  app.post('/api/documents/from-template', async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      templateId?: string;
      title?: string;
    };
    const scope = readScope(body);
    if (
      scope === undefined ||
      typeof body.templateId !== 'string' ||
      typeof body.title !== 'string'
    ) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId, templateId, title',
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
      'documents.upload',
      'create a document from a template',
    );
    if (capable !== true) return capable;

    const created = await dependencies.createDocumentFromTemplate.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      templateId: body.templateId,
      title: body.title,
      correlationId: request.id,
    });
    if (!created.ok) {
      const http = toHttpError(created.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Index the created document like any other upload.
    const extractedText = created.value.extractedText;
    if (extractedText !== undefined && extractedText.trim().length > 0) {
      await dependencies.indexDocument.handle({
        tenantId: scope.organizationId as TenantId,
        workspaceId: scope.workspaceId as WorkspaceId,
        documentId: created.value.document.id,
        title: body.title,
        text: extractedText,
        version: 1,
        context: { actorId: auth.userId as UserId, correlationId: request.id },
      });
    }

    return reply.code(201).send({
      document: toDocumentDto(created.value.document),
      indexed: extractedText !== undefined && extractedText.trim().length > 0,
    });
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
    const capable = await requireDocumentCapability(
      dependencies,
      reply,
      request.id,
      auth.userId,
      query.organizationId,
      query.workspaceId,
      'knowledge.read',
      'search knowledge',
    );
    if (capable !== true) return capable;

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
