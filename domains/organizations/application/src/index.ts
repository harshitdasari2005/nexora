/**
 * @nexora/application-organizations — Organizations application layer,
 * barrel export.
 *
 * The use cases of the Organizations bounded context (BACKEND.md §4):
 * commands, handlers, queries, DTOs, validators, and the application
 * service. Depends only on the organizations domain core,
 * `@nexora/contracts`, and `@nexora/shared`. No persistence, no HTTP, no
 * infrastructure.
 */

export * from './commands/create-organization.command.js';
export * from './commands/command-handler.js';
export * from './command-handlers/create-organization.handler.js';
export * from './queries/list-organizations.query.js';
export * from './query-handlers/list-organizations.handler.js';
export * from './dto/organization.dto.js';
export * from './validators/create-organization.validator.js';
export * from './services/organization-application-service.js';
