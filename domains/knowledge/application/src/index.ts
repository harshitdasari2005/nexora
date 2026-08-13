/**
 * @nexora/application-knowledge — Knowledge application layer, barrel export.
 *
 * The use cases of the Knowledge bounded context (BACKEND.md §4): the
 * index-document command, the retrieve-knowledge query, DTOs, validators,
 * and the application service. Depends only on the knowledge domain core,
 * the generic Search platform port, `@nexora/contracts`, and
 * `@nexora/shared`. No persistence, no search engine, no AI.
 */

export * from './commands/index-document.command.js';
export * from './commands/index-article.command.js';
export * from './commands/create-article.command.js';
export * from './commands/update-article.command.js';
export * from './commands/publish-article.command.js';
export * from './commands/archive-article.command.js';
export * from './commands/create-category.command.js';
export * from './command-handlers/index-document.handler.js';
export * from './command-handlers/remove-document-index.handler.js';
export * from './command-handlers/index-article.handler.js';
export * from './command-handlers/remove-article-index.handler.js';
export * from './command-handlers/create-article.handler.js';
export * from './command-handlers/update-article.handler.js';
export * from './command-handlers/publish-article.handler.js';
export * from './command-handlers/archive-article.handler.js';
export * from './command-handlers/create-category.handler.js';
export * from './queries/retrieve-knowledge.query.js';
export * from './queries/get-article.query.js';
export * from './queries/list-articles.query.js';
export * from './queries/list-categories.query.js';
export * from './query-handlers/retrieve-knowledge.handler.js';
export * from './query-handlers/get-article.handler.js';
export * from './query-handlers/list-articles.handler.js';
export * from './query-handlers/list-categories.handler.js';
export * from './dto/knowledge-reference.dto.js';
export * from './dto/knowledge-article.dto.js';
export * from './dto/knowledge-category.dto.js';
export * from './validators/retrieve-knowledge.validator.js';
export * from './validators/create-article.validator.js';
export * from './validators/update-article.validator.js';
export * from './validators/create-category.validator.js';
export * from './services/knowledge-application-service.js';
