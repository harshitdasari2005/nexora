/**
 * @nexora/application-identity — Identity application layer, barrel export.
 *
 * The use cases of the Identity & Access bounded context (BACKEND.md §4):
 * commands, handlers, queries, DTOs, validators, and the application
 * service. Depends only on the identity domain core, `@nexora/contracts`,
 * and `@nexora/shared`. No persistence, no HTTP, no infrastructure.
 */

export * from './commands/authenticate-with-oidc.command.js';
export * from './commands/command-handler.js';
export * from './commands/end-session.command.js';
export * from './command-handlers/authenticate-with-oidc.handler.js';
export * from './command-handlers/end-session.handler.js';
export * from './queries/get-current-user.query.js';
export * from './query-handlers/get-current-user.handler.js';
export * from './dto/user.dto.js';
export * from './validators/authenticate-with-oidc.validator.js';
export * from './services/identity-application-service.js';
