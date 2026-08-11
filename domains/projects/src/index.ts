/**
 * @nexora/domain-projects — Projects domain core.
 *
 * The Projects bounded context (DOMAIN_MODEL.md §14.2): the Project
 * aggregate with its lifecycle, value objects, domain events, repository
 * interface, domain service, and policies. Pure business domain — no
 * persistence, no APIs, no infrastructure. The application layer composes
 * these with infrastructure implementations.
 */

export * from './errors/index.js';
export * from './value-objects/index.js';
export * from './events/index.js';
export * from './entities/index.js';
export * from './policies/index.js';
export * from './repositories/index.js';
export * from './services/index.js';
