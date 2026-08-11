/**
 * @nexora/application-workspaces — Workspaces application layer, barrel
 * export.
 *
 * The use cases of the Workspaces bounded context (BACKEND.md §4):
 * commands, handlers, queries, DTOs, validators, and the application
 * service. Depends only on the workspaces domain core, `@nexora/contracts`,
 * and `@nexora/shared`. No persistence, no HTTP, no infrastructure.
 */

export * from './commands/create-workspace.command.js';
export * from './commands/command-handler.js';
export * from './command-handlers/create-workspace.handler.js';
export * from './queries/list-workspaces.query.js';
export * from './queries/list-my-workspaces.query.js';
export * from './query-handlers/list-workspaces.handler.js';
export * from './query-handlers/list-my-workspaces.handler.js';
export * from './dto/workspace.dto.js';
export * from './validators/create-workspace.validator.js';
export * from './services/workspace-application-service.js';
