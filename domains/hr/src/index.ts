/**
 * @nexora/domain-hr — HR domain core.
 *
 * The Human Resources bounded context (DOMAIN_MODEL.md §14.1): the Employee
 * aggregate with its lifecycle, value objects, domain events, repository
 * interface, domain service, and policies. Pure business domain — no
 * persistence, no APIs, no infrastructure. The application layer composes
 * these with infrastructure implementations.
 *
 * For this vertical slice (EMPLOYEE → PROJECT ASSIGNMENT), HR contributes the
 * minimum Employee read capability: employee records with an organization
 * (tenant) association, lifecycle status, and name resolution. The hire /
 * onboarding / offboarding workflows (WRK-2/3) are later sprints.
 */

export * from './errors/index.js';
export * from './value-objects/index.js';
export * from './events/index.js';
export * from './entities/index.js';
export * from './policies/index.js';
export * from './repositories/index.js';
export * from './services/index.js';
