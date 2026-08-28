/**
 * @nexora/module-finance — Finance domain core.
 *
 * The Finance bounded context (DOMAIN_MODEL.md §4.4 / DOM-08): the Budget
 * and Expense aggregates with their lifecycles, value objects, domain
 * events, repository interfaces, domain services, and policies. Pure
 * business domain — no persistence, no APIs, no infrastructure. The
 * application layer composes these with infrastructure implementations.
 *
 * For this vertical slice, Finance contributes the minimum useful model
 * proven out by the CFO workspace: budgets with an allocated amount and
 * period, expenses claimed against a budget with an approval decision, and
 * a deterministic over-threshold review flag. Invoice, Payment, and
 * CloseTask (DOMAIN_MODEL.md §4.4's full Phase-1 Finance app scope) are
 * NOT implemented — they require customer/vendor/ledger concepts this
 * vertical does not yet have a reason to model (S25–S28 ROADMAP scope,
 * later sprints, not "unnecessary enterprise accounting software" here).
 */

export * from './errors/index.js';
export * from './value-objects/index.js';
export * from './events/index.js';
export * from './entities/index.js';
export * from './policies/index.js';
export * from './repositories/index.js';
export * from './services/index.js';
