/**
 * @nexora/application-documents — Documents application layer, barrel export.
 *
 * The use cases of the Documents bounded context (BACKEND.md §4): commands,
 * handlers, queries, DTOs, validators, ports (storage + extraction), and the
 * application service. Depends only on the documents domain core,
 * `@nexora/contracts`, and `@nexora/shared`. No persistence, no HTTP, no
 * infrastructure.
 */

export * from './commands/upload-document.command.js';
export * from './commands/archive-document.command.js';
export * from './commands/upload-document-version.command.js';
export * from './commands/restore-document-version.command.js';
export * from './commands/create-document-template.command.js';
export * from './commands/archive-document-template.command.js';
export * from './commands/create-document-from-template.command.js';
export * from './commands/command-handler.js';
export * from './command-handlers/upload-document.handler.js';
export * from './command-handlers/archive-document.handler.js';
export * from './command-handlers/upload-document-version.handler.js';
export * from './command-handlers/restore-document-version.handler.js';
export * from './command-handlers/create-document-template.handler.js';
export * from './command-handlers/archive-document-template.handler.js';
export * from './command-handlers/create-document-from-template.handler.js';
export * from './queries/list-documents.query.js';
export * from './queries/get-document.query.js';
export * from './queries/list-document-versions.query.js';
export * from './queries/get-document-version-content.query.js';
export * from './queries/list-document-templates.query.js';
export * from './query-handlers/list-documents.handler.js';
export * from './query-handlers/get-document.handler.js';
export * from './query-handlers/list-document-versions.handler.js';
export * from './query-handlers/get-document-version-content.handler.js';
export * from './query-handlers/list-document-templates.handler.js';
export * from './dto/document.dto.js';
export * from './dto/document-version.dto.js';
export * from './dto/document-template.dto.js';
export * from './validators/upload-document.validator.js';
export * from './validators/upload-document-version.validator.js';
export * from './validators/create-document-template.validator.js';
export * from './ports/document-storage.js';
export * from './ports/document-text-extractor.js';
export * from './services/document-application-service.js';
