/**
 * @nexora/app-api — knowledge base routes (S18).
 *
 * The Knowledge Base REST surface: articles (create/update/publish/archive/
 * get/list) and categories (create/list). Every endpoint enforces the SAME
 * two trusted server-side authorization boundaries as every other resource
 * route (see `scope.ts`): organization membership + workspace membership.
 *
 * Publication is the freshness gate: publishing indexes the article,
 * updating a PUBLISHED article re-indexes the new content version, and
 * archiving removes the corpus entry — a draft is never indexed and an
 * archived article never answers retrieval. The corpus projection runs
 * through the SAME application handlers the AI retrieval path uses.
 *
 * The client may not supply identity: tenant/workspace come from the query
 * or body (resource scope) but are verified against the trusted membership
 * read models; a forged or foreign scope resolves to 403/404.
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import { toKnowledgeArticleDto, toKnowledgeCategoryDto } from '@nexora/application-knowledge';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type {
  ArchiveArticleHandler,
  CreateArticleHandler,
  CreateCategoryHandler,
  GetArticleHandler,
  IndexArticleHandler,
  ListArticlesHandler,
  ListCategoriesHandler,
  PublishArticleHandler,
  RemoveArticleIndexHandler,
  UpdateArticleHandler,
} from '@nexora/application-knowledge';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';
import { authorizeScope, readScope } from './scope.js';

/** Dependencies of the knowledge routes. */
export interface KnowledgeRoutesDependencies {
  createArticle: CreateArticleHandler;
  updateArticle: UpdateArticleHandler;
  publishArticle: PublishArticleHandler;
  archiveArticle: ArchiveArticleHandler;
  getArticle: GetArticleHandler;
  listArticles: ListArticlesHandler;
  createCategory: CreateCategoryHandler;
  listCategories: ListCategoriesHandler;
  indexArticle: IndexArticleHandler;
  removeArticleIndex: RemoveArticleIndexHandler;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
}

/** Registers the knowledge base routes. */
export function registerKnowledgeRoutes(
  app: FastifyInstance,
  dependencies: KnowledgeRoutesDependencies,
): void {
  // --- Articles -----------------------------------------------------------

  app.post('/api/knowledge/articles', async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      title?: string;
      body?: string;
      categoryId?: string;
    };
    const scope = readScope(body);
    if (scope === undefined || typeof body.title !== 'string' || typeof body.body !== 'string') {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId, title, body',
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

    const created = await dependencies.createArticle.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      title: body.title,
      body: body.body,
      categoryId: body.categoryId,
      correlationId: request.id,
    });
    if (!created.ok) {
      const http = toHttpError(created.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    // A new article is a DRAFT — never indexed.
    return reply.code(201).send({ article: toKnowledgeArticleDto(created.value.article) });
  });

  app.put('/api/knowledge/articles/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      title?: string;
      body?: string;
      categoryId?: string;
    };
    const scope = readScope(body);
    if (scope === undefined || typeof body.title !== 'string' || typeof body.body !== 'string') {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId, title, body',
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

    const updated = await dependencies.updateArticle.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      articleId: params.id,
      title: body.title,
      body: body.body,
      categoryId: body.categoryId,
      correlationId: request.id,
    });
    if (!updated.ok) {
      const http = toHttpError(updated.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Index freshness: a PUBLISHED article edit must replace the corpus
    // entry with the new content version (a stale article never answers).
    // The corpus write IS the freshness gate — surface its failure loudly
    // so a stale article can never silently answer retrieval.
    const article = updated.value.article;
    let indexed = false;
    if (article.status.isPublished()) {
      const indexedResult = await dependencies.indexArticle.handle({
        tenantId: scope.organizationId as TenantId,
        workspaceId: scope.workspaceId as WorkspaceId,
        articleId: article.id,
        title: article.title,
        text: article.body,
        version: article.contentVersion,
      });
      if (!indexedResult.ok) {
        const http = toHttpError(indexedResult.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      indexed = indexedResult.value.indexed;
    }
    return { article: toKnowledgeArticleDto(article), version: article.contentVersion, indexed };
  });

  app.post('/api/knowledge/articles/:id/publish', async (request, reply) => {
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

    const published = await dependencies.publishArticle.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      articleId: params.id,
      correlationId: request.id,
    });
    if (!published.ok) {
      const http = toHttpError(published.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Publication is the freshness gate: index the article so it becomes
    // retrievable (BR-7). A publication whose corpus write fails must NOT
    // report success — the article would be published but never answerable.
    const article = published.value.article;
    let indexed = false;
    if (article.status.isPublished()) {
      const indexedResult = await dependencies.indexArticle.handle({
        tenantId: scope.organizationId as TenantId,
        workspaceId: scope.workspaceId as WorkspaceId,
        articleId: article.id,
        title: article.title,
        text: article.body,
        version: article.contentVersion,
      });
      if (!indexedResult.ok) {
        const http = toHttpError(indexedResult.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      indexed = indexedResult.value.indexed;
    }
    return reply.code(200).send({
      article: toKnowledgeArticleDto(article),
      version: article.contentVersion,
      indexed,
    });
  });

  app.post('/api/knowledge/articles/:id/archive', async (request, reply) => {
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

    const archived = await dependencies.archiveArticle.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      articleId: params.id,
      correlationId: request.id,
    });
    if (!archived.ok) {
      const http = toHttpError(archived.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Archiving removes the article from the search corpus. A removal that
    // fails would leave an archived article answerable — surface it loudly.
    const removed = await dependencies.removeArticleIndex.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      articleId: params.id,
    });
    if (!removed.ok) {
      const http = toHttpError(removed.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    // `indexed: false` — the article has left the search corpus.
    return {
      article: toKnowledgeArticleDto(archived.value.article),
      indexed: false,
    };
  });

  app.get('/api/knowledge/articles/:id', async (request, reply) => {
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

    const result = await dependencies.getArticle.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      articleId: params.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { article: result.value };
  });

  app.get('/api/knowledge/articles', async (request, reply) => {
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

    const result = await dependencies.listArticles.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { articles: result.value };
  });

  // --- Categories -----------------------------------------------------------

  app.post('/api/knowledge/categories', async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      name?: string;
    };
    const scope = readScope(body);
    if (scope === undefined || typeof body.name !== 'string') {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId, name',
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

    const created = await dependencies.createCategory.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      actorId: auth.userId as UserId,
      name: body.name,
      correlationId: request.id,
    });
    if (!created.ok) {
      const http = toHttpError(created.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({ category: toKnowledgeCategoryDto(created.value.category) });
  });

  app.get('/api/knowledge/categories', async (request, reply) => {
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

    const result = await dependencies.listCategories.handle({
      tenantId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { categories: result.value };
  });
}
