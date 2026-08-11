/**
 * @nexora/contracts — command contracts.
 *
 * Command/query separation (API_CONTRACTS.md §3, BKD.md §8): commands are
 * imperative, idempotent, and produce a {@link CommandResult}; they never
 * return query data. Every command carries a context (actor, tenant,
 * workspace) and metadata (id, idempotency key, correlation).
 */

import type { CorrelationId, TenantId, Timestamp, UserId, WorkspaceId } from '../common/index.js';

/**
 * The actor issuing a command — a human user or an AI agent execution.
 */
export interface CommandActor {
  /** Actor kind: a human user or an AI agent execution. */
  kind: 'user' | 'agent';
  /** Actor id (user id or agent id). */
  id: UserId | string;
}

/**
 * The context a command executes under: who is acting, and in which tenant
 * and workspace. Downstream modules never re-derive authorization
 * (API_CONTRACTS.md §8).
 */
export interface CommandContext {
  /** The actor issuing the command. */
  actor: CommandActor;
  /** Tenant the command is scoped to. */
  tenantId: TenantId;
  /** Workspace the command is scoped to, when workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** Whether the actor's session is elevated (MFA confirmed). */
  mfaVerified?: boolean;
}

/**
 * Metadata attached to every command: identity, idempotency, and correlation
 * (BKD.md §8.2 idempotency).
 */
export interface CommandMetadata {
  /** Unique command id. */
  id: string;
  /** Command name, e.g. `projects.create_project`. */
  name: string;
  /** Correlation id tying the command to its originating execution. */
  correlationId: CorrelationId;
  /** Client idempotency key; retries with the same key are deduplicated. */
  idempotencyKey?: string;
  /** ISO-8601 UTC time the command was issued. */
  issuedAt: Timestamp;
}

/**
 * The base command contract. Concrete commands extend this with typed
 * `input` payloads.
 */
export interface BaseCommand<TInput = unknown> {
  /** Command metadata. */
  metadata: CommandMetadata;
  /** The context the command executes under. */
  context: CommandContext;
  /** The command input, typed by the concrete command. */
  input: TInput;
}

/**
 * The result of executing a command. `ok` discriminates success from
 * failure; failures carry a stable error code (API_CONTRACTS.md §10).
 */
export type CommandResult<TOutput = void> =
  { ok: true; output: TOutput } | { ok: false; code: string; message: string };

/**
 * A transport envelope wrapping a command for delivery (e.g. via the event
 * bus or a queue).
 */
export interface CommandEnvelope<TInput = unknown> {
  /** The wrapped command. */
  command: BaseCommand<TInput>;
  /** Whether delivery should be retried on transient failure. */
  retryable: boolean;
}

/**
 * The application-layer command handler contract (BACKEND.md §4). A handler
 * validates its command, delegates to the application service, and returns a
 * `Result`. HTTP adapters (apps/api) depend on handlers, never on domain
 * services directly. Defined once here so every application package shares
 * the same contract.
 */
export interface CommandHandler<C, R, E extends Error = Error> {
  /** Validates and executes the command. */
  handle(command: C): Promise<{ ok: true; value: R } | { ok: false; error: E }>;
}
