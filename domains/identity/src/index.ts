/**
 * @nexora/domain-identity — Identity domain core.
 *
 * The Identity & Access bounded context (DOMAIN_MODEL.md §2.2): User, Session,
 * and Role aggregates with their value objects, domain events, repository
 * interfaces, domain services, and policies. Pure business domain — no
 * persistence, no APIs, no infrastructure. The application layer composes
 * these with infrastructure implementations (ROADMAP.md Phase 1).
 */

export * from './errors/index.js';
export * from './value-objects/index.js';
export * from './events/index.js';
export * from './entities/index.js';
export * from './policies/index.js';
export * from './repositories/index.js';
export * from './services/index.js';
