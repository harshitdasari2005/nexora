/**
 * @nexora/domain-documents — bounded context entry.
 *
 * The Documents domain core (DOMAIN_MODEL.md §14 Documents): the
 * {@link Document} aggregate with its processing lifecycle, value objects,
 * domain events, policies, repository port, and domain service. Pure
 * business domain — no persistence, no storage SDKs, no HTTP, no AI
 * (ENGINEERING_PLAYBOOK.md §4 layering). Binary content is referenced via
 * {@link ContentRef}; bytes live behind the application-layer storage port.
 */

// Entities
export * from './entities/document.js';
export * from './entities/document-template.js';
export * from './entities/document-version.js';

// Value objects
export * from './value-objects/index.js';

// Events
export * from './events/index.js';

// Policies
export * from './policies/index.js';

// Errors
export * from './errors/index.js';

// Repositories (ports)
export * from './repositories/index.js';

// Services
export * from './services/index.js';
