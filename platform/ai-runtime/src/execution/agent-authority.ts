/**
 * @nexora/ai-runtime — agent authority port (Prompt 4).
 *
 * When an invocation runs AS an agent principal, the {@link ToolExecutor}
 * asks this port — at EXECUTION time, for every tool call — whether the
 * agent may exercise the capability for exactly these arguments. The API
 * implements it over the persisted agent identity + delegations (status,
 * organization/workspace, capability, resource scope, expiry, revocation,
 * the initiating user's and grantor's CURRENT authority, and the agent
 * definition's ceiling). The runtime never decides agent authority itself,
 * and an agent invocation with no port wired FAILS CLOSED.
 */

import type { AgentPrincipalContext } from '@nexora/contracts/agent';

import type { SecurityReasonCode } from './security-decision.js';

/** One agent authority question. All fields are trusted server-side values. */
export interface AgentAuthorityRequest {
  /** The trusted agent principal of the run. */
  agent: AgentPrincipalContext;
  /** The initiating human user. */
  userId: string;
  /** Trusted organization. */
  tenantId: string;
  /** Trusted workspace. */
  workspaceId?: string;
  /** The capability being exercised. */
  capabilityId: string;
  /** The tool being invoked. */
  toolId: string;
  /** The (already argument-guarded) input — used ONLY to resolve touched resources. */
  input: Record<string, unknown>;
}

/** The answer of {@link AgentAuthorityPort.authorize}. */
export type AgentAuthorityCheck =
  | { ok: true; delegationId: string }
  | { ok: false; reasonCode: SecurityReasonCode; reason: string };

/** Decides agent authority from persisted identity + delegations. */
export interface AgentAuthorityPort {
  authorize(request: AgentAuthorityRequest): Promise<AgentAuthorityCheck>;
}
