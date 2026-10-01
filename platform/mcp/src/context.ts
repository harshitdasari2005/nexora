/**
 * @nexora/mcp — trusted MCP execution context.
 *
 * The context every Nexora MCP tool call runs under. It is assembled by the
 * composition layer (apps/api) from TRUSTED server-side sources — the
 * authenticated identity that spawned the server, the membership
 * repositories, and the Phase 1 Domain → Role → Capability catalog. A tool
 * argument can never supply these values: `userId`/`tenantId`/`workspaceId`
 * identify WHO the caller is (process-spawn trust), and the business
 * domain/role/capabilities are DERIVED from trusted membership, never
 * claimed by the caller (S24 Phase 5 security contract: MCP must not become
 * a privilege-escalation mechanism).
 */

/**
 * The trusted execution context of a Nexora MCP invocation.
 *
 * - Identity (userId, tenantId, workspaceId) is process-scoped trust: the
 *   parent that spawns the stdio server supplies it out-of-band (env), and
 *   the server validates it against the membership repositories before any
 *   tool executes.
 * - Business context (domain, role, capabilities) is derived server-side
 *   from the SAME membership seam the Command Center and AI Runtime use —
 *   there is ONE source of truth (S24 Phase 3).
 * - `capabilityIds` are the caller's executable AI capability affinities.
 *   Capability-aware discovery (S24 Phase 5) filters the visible MCP tool
 *   set by these ids; an empty set exposes NO tools (fail closed).
 */
export interface NexoraMCPContext {
  /** The authenticated user id (trusted). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The verified workspace scope, when workspace-scoped (trusted). */
  workspaceId?: string;
  /** The resolved business domain id (e.g. `executive`), when resolvable. */
  businessDomain?: string;
  /** The resolved business role id (e.g. `executive.ceo`), when resolvable. */
  businessRole?: string;
  /** The caller's executable capability affinities (trusted, derived). */
  capabilityIds: readonly string[];
  /** Correlation/run id for tracing and approval correlation. */
  correlationId: string;
  /**
   * The TRUSTED agent principal the session operates as (Prompt 4), when the
   * session was opened for an agent. Resolved and validated by the server
   * from persisted state (organization, workspace, status) — never from a
   * tool argument. Every tool call is re-authorized against the agent's
   * delegations at execution time.
   */
  agent?: { agentId: string; definitionId: string; name: string };
}
