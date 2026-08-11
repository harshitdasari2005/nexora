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
export * from './command-handlers/index-document.handler.js';
export * from './command-handlers/remove-document-index.handler.js';
export * from './queries/retrieve-knowledge.query.js';
export * from './query-handlers/retrieve-knowledge.handler.js';
export * from './dto/knowledge-reference.dto.js';
export * from './validators/retrieve-knowledge.validator.js';
export * from './services/knowledge-application-service.js';
