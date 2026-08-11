/**
 * @nexora/domain-knowledge — bounded context entry.
 *
 * The Knowledge domain core (DOMAIN_MODEL.md §14 Knowledge): the
 * {@link KnowledgeSource} aggregate (the searchable projection of a
 * document's latest version), its id, events, repository port, and errors.
 * Pure business domain — no persistence, no search engine, no AI. The
 * permission-filtered retrieval port (BR-7) lives in the generic Search
 * platform (`@nexora/module-search`); this module owns its entries.
 */

// Entities
export * from './entities/knowledge-source.js';

// Value objects
export * from './value-objects/knowledge-source-id.js';

// Events
export * from './events/index.js';

// Errors
export * from './errors/index.js';

// Repositories (ports)
export * from './repositories/index.js';
