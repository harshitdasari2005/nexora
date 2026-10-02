/**
 * @nexora/application-hr — HR application layer, barrel export.
 *
 * The use cases of the HR bounded context (BACKEND.md §4): commands,
 * handlers, queries, DTOs, validators, and the application service. Depends
 * only on the HR domain core, `@nexora/contracts`, and `@nexora/shared`.
 * No persistence, no HTTP, no infrastructure.
 */

export * from './commands/create-employee.command.js';
export * from './commands/revoke-hire.command.js';
export * from './commands/command-handler.js';
export * from './command-handlers/create-employee.handler.js';
export * from './command-handlers/revoke-hire.handler.js';
export * from './queries/find-employee-by-name.query.js';
export * from './queries/list-employees.query.js';
export * from './query-handlers/find-employee-by-name.handler.js';
export * from './query-handlers/list-employees.handler.js';
export * from './dto/employee.dto.js';
export * from './validators/create-employee.validator.js';
export * from './services/employee-application-service.js';
export * from './dto/hiring-requisition.dto.js';
export * from './services/hiring-requisition-application-service.js';
