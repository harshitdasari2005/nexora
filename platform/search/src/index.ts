/**
 * @nexora/module-search — platform module entry.
 *
 * The Search bounded context (DOMAIN_MODEL.md §15): a generic,
 * permission-filtered projection service. Exports the index-entry contract,
 * the persistence port, the deterministic lexical scorer, and the in-memory
 * implementation. Search is generic — it contains no Documents, Knowledge,
 * or Projects logic; those modules own their entries through this port
 * (API_CONTRACTS.md §2).
 */

export * from './search-index-entry.js';
export * from './search-index-port.js';
export * from './lexical-search.js';
export * from './in-memory-search-index.js';
