/**
 * @nexora/module-workflow — platform module entry.
 *
 * The journaled workflow engine (SAD.md §12): definitions, the instance
 * aggregate, the step-execution journal, the runtime (dependency-ordered
 * execution through a capability-executor port, shared-approval gating,
 * retries, idempotent replay, tenant isolation) and the application service.
 * Public contracts are exported here (API_CONTRACTS.md §2).
 */

// Domain
export * from './domain/errors.js';
export * from './domain/input-resolver.js';
export * from './domain/workflow-definition.js';
export * from './domain/workflow-instance.js';
export * from './domain/workflow-status.js';
export * from './domain/workflow-step-execution.js';

// Events
export * from './events/index.js';

// Repositories (ports)
export * from './repositories/workflow-repository.js';

// Runtime
export * from './runtime/workflow-approval.js';
export * from './runtime/workflow-executor.js';
export * from './runtime/workflow-runtime.js';
export * from './runtime/rollback-summary.js';

// Application
export * from './application/workflow-application-service.js';
