/**
 * @nexora/ai-runtime — security decision records.
 *
 * When the runtime BLOCKS an AI action for a security reason (a capability
 * outside the caller's trusted ceiling, forged scope/authority in tool
 * arguments, arguments outside the tool's schema, approval arguments that no
 * longer match what was approved, a narration that leaked system
 * instructions), it emits one {@link SecurityDecision}. The composition root
 * persists it into the audit trail.
 *
 * The record is STRUCTURED decision metadata only: identifiers, the rule that
 * fired, and a safe reason built from field names and rule names. It never
 * carries argument values, secrets, raw model output, or chain-of-thought.
 */

/** Where the blocked action entered the runtime. */
export type SecurityOrigin =
  | 'orchestrator'
  | 'mcp'
  | 'workflow'
  | 'agent'
  | 'remediation'
  | 'approval'
  | 'narration'
  | 'inbound_email'
  | 'agent_management'
  | 'rest';

/** The rule that blocked the action. */
export type SecurityReasonCode =
  | 'CAPABILITY_NOT_PERMITTED'
  | 'RESERVED_ARGUMENT'
  | 'ARGUMENT_TOO_DEEP'
  | 'INVALID_ARGUMENTS'
  | 'APPROVAL_ARGUMENTS_MISMATCH'
  // Prompt 9 — a resumed approval that no step consumed (never silent).
  | 'APPROVAL_NOT_BOUND'
  // Prompt 9 — a composite's inner step needs approval governance the outer approval never covered.
  | 'WORKFLOW_INNER_APPROVAL_UNCOVERED'
  | 'APPROVAL_DECISION_NOT_PERMITTED'
  | 'APPROVAL_EXPIRED'
  // Prompt 8 — approval governance (who may decide).
  | 'WRONG_APPROVER_ROLE'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'SYSTEM_PROMPT_DISCLOSURE'
  // Prompt 4 — agent identity + delegated capabilities.
  | 'FORGED_AGENT_CONTEXT'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_SUSPENDED'
  | 'AGENT_REVOKED'
  | 'AGENT_OUT_OF_SCOPE'
  | 'AGENT_AUTHORITY_UNAVAILABLE'
  | 'AGENT_APPROVAL_MISMATCH'
  | 'CAPABILITY_NOT_DELEGABLE'
  | 'CAPABILITY_OUTSIDE_AGENT_DEFINITION'
  | 'CAPABILITY_OUTSIDE_DELEGATION'
  | 'INITIATOR_LACKS_CAPABILITY'
  | 'DELEGATION_MISSING'
  | 'DELEGATION_REVOKED'
  | 'DELEGATION_EXPIRED'
  | 'DELEGATION_GRANTOR_LACKS_CAPABILITY'
  | 'DELEGATION_RESOURCE_OUT_OF_SCOPE'
  | 'DELEGATION_EXCEEDS_USER_AUTHORITY'
  | 'AGENT_TO_AGENT_NOT_SUPPORTED'
  // Prompt 5 — the central policy engine.
  | 'POLICY_DENIED'
  | 'POLICY_UNAVAILABLE'
  | 'POLICY_CHANGED_AFTER_APPROVAL';

/** One blocked-action record (structured; safe to persist and display). */
export interface SecurityDecision {
  /** The trusted actor (user id) on whose behalf the action was attempted. */
  actorId: string;
  /** The agent principal that attempted it, when the action ran as an agent. */
  agentId?: string;
  /** The delegation involved, when one was identified. */
  delegationId?: string;
  /** The entry point / agent that attempted it. */
  origin: SecurityOrigin;
  /** The invocation/run id (correlation). */
  invocationId: string;
  /** Trusted organization (tenant) id. */
  organizationId: string;
  /** Trusted workspace id, when scoped. */
  workspaceId?: string;
  /** The tool the action targeted, when one. */
  toolId?: string;
  /** The capability the action targeted, when known. */
  capabilityId?: string;
  /** The attempted action (e.g. `tool.execute`, `approval.decide`). */
  action: string;
  /**
   * The stable policy that produced (or is enforced by) this block, e.g.
   * `POLICY_FINANCE_BUDGET_STATE` — set by the engine for policy decisions,
   * derived from the reason code (`policyIdForReason`) for earlier layers.
   */
  policyId?: string;
  /** The version of that policy (a rule/config version, as recorded in the decision). */
  policyVersion?: string;
  /** Every matched rule as `policyId@version=OUTCOME` (policy decisions only). */
  policyRules?: readonly string[];
  /** The policy decision — always `deny` for a block. */
  policyDecision: 'deny';
  /** The rule that fired. */
  reasonCode: SecurityReasonCode;
  /** A safe, human-readable reason (field/rule names only, never values). */
  reason: string;
  /** The outcome — the action did not run. */
  outcome: 'blocked';
  /** ISO-8601 UTC time of the decision. */
  occurredAt: string;
}

/** Receives security decisions (best-effort: a sink failure never un-blocks). */
export type SecurityDecisionSink = (decision: SecurityDecision) => void | Promise<void>;

/** Emits a decision to a sink, swallowing sink failures (the block stands regardless). */
export async function emitSecurityDecision(
  sink: SecurityDecisionSink | undefined,
  decision: SecurityDecision,
): Promise<void> {
  if (sink === undefined) {
    return;
  }
  try {
    await sink(decision);
  } catch {
    // Auditing is best-effort; the action is already blocked.
  }
}
