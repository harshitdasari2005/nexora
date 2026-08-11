/**
 * @nexora/application-projects — Projects application layer, barrel export.
 *
 * The use cases of the Projects bounded context (BACKEND.md §4): commands,
 * handlers, queries, DTOs, validators, and the application service. Depends
 * only on the projects domain core, `@nexora/contracts`, and
 * `@nexora/shared`. No persistence, no HTTP, no infrastructure.
 */

export * from './commands/create-project.command.js';
export * from './commands/assign-employee.command.js';
export * from './commands/command-handler.js';
export * from './command-handlers/create-project.handler.js';
export * from './command-handlers/assign-employee.handler.js';
export * from './queries/list-projects.query.js';
export * from './queries/find-project-by-name.query.js';
export * from './queries/list-project-members.query.js';
export * from './query-handlers/list-projects.handler.js';
export * from './query-handlers/find-project-by-name.handler.js';
export * from './query-handlers/list-project-members.handler.js';
export * from './dto/project.dto.js';
export * from './dto/project-member.dto.js';
export * from './validators/create-project.validator.js';
export * from './services/project-application-service.js';
