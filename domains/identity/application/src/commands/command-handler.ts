/**
 * @nexora/application-identity — command handler contract.
 *
 * Re-exported from `@nexora/contracts/commands` (the canonical definition,
 * API_CONTRACTS.md §3): the application-layer entry point for a use case
 * (BACKEND.md §4). A handler validates its command, delegates to the
 * application service, and returns a `Result`. HTTP adapters (apps/api)
 * depend on handlers, never on domain services directly.
 */

export type { CommandHandler } from '@nexora/contracts/commands';
