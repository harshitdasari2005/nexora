/**
 * Stable policy identifiers. They appear in audit records, approvals,
 * evaluation scenarios and (future) configuration, so they never change
 * meaning: a behavioural change bumps the rule's `version`, not its id.
 */
export const POLICY_IDS = {
  /** Side-effect class × autonomy tier decides whether approval is required (BR-13, AC-3). */
  SIDE_EFFECT_APPROVAL: 'POLICY_SIDE_EFFECT_APPROVAL',
  /** Money movement (expense submission) always requires human approval (BR-19). */
  FINANCE_EXPENSE_APPROVAL: 'POLICY_FINANCE_EXPENSE_APPROVAL',
  /** An expense cannot target a closed (or unresolvable) budget. */
  FINANCE_BUDGET_STATE: 'POLICY_FINANCE_BUDGET_STATE',
  /** Organization-configurable: an expense that would overrun its budget is denied / needs approval. */
  FINANCE_BUDGET_LIMIT: 'POLICY_FINANCE_BUDGET_LIMIT',
  /**
   * Organization-configurable approval governance: separation of duties, the
   * approver role and the approval TTL for REQUIRE_APPROVAL capabilities.
   * Tighten-only — it never turns REQUIRE_APPROVAL into ALLOW.
   */
  APPROVAL_AUTHORITY: 'POLICY_APPROVAL_AUTHORITY',
  /** Agent delegation — resource scope. */
  AGENT_DELEGATION_SCOPE: 'POLICY_AGENT_DELEGATION_SCOPE',
  /** Agent delegation — expiry and revocation. */
  AGENT_DELEGATION_EXPIRY: 'POLICY_AGENT_DELEGATION_EXPIRY',
  /** Agent delegation — missing, or capability outside it. */
  AGENT_DELEGATION_REQUIRED: 'POLICY_AGENT_DELEGATION_REQUIRED',
  /** Agent identity and lifecycle status. */
  AGENT_IDENTITY: 'POLICY_AGENT_IDENTITY',
  /** Capabilities that can never be delegated to an agent. */
  AGENT_NON_DELEGABLE: 'POLICY_AGENT_NON_DELEGABLE',
  /** Approval decisions: who may decide, exact arguments, agent binding. */
  APPROVAL_SEPARATION: 'POLICY_APPROVAL_SEPARATION',
  /** Workspace scope of an action. */
  WORKSPACE_SCOPE: 'POLICY_WORKSPACE_SCOPE',
  /** Tenant isolation. */
  TENANT_ISOLATION: 'POLICY_TENANT_ISOLATION',
  /** Untrusted values may never set identity, scope, authority, approval or policy. */
  ARGUMENT_TRUST: 'POLICY_ARGUMENT_TRUST',
  /** The engine itself (missing policy, evaluation failure, incomplete context). */
  ENGINE: 'POLICY_ENGINE',
} as const;

/** A stable policy id. */
export type PolicyId = (typeof POLICY_IDS)[keyof typeof POLICY_IDS];

/**
 * Maps the security reason codes raised by the layers that run BEFORE the
 * engine (agent authority, argument guard, approval authorization) onto the
 * policy that they enforce, so every denial in the audit trail names a
 * stable policy id — one vocabulary for "why was this refused?".
 */
export function policyIdForReason(reasonCode: string): PolicyId | undefined {
  switch (reasonCode) {
    case 'DELEGATION_RESOURCE_OUT_OF_SCOPE':
      return POLICY_IDS.AGENT_DELEGATION_SCOPE;
    case 'DELEGATION_EXPIRED':
    case 'DELEGATION_REVOKED':
      return POLICY_IDS.AGENT_DELEGATION_EXPIRY;
    case 'DELEGATION_MISSING':
    case 'CAPABILITY_OUTSIDE_DELEGATION':
    case 'DELEGATION_GRANTOR_LACKS_CAPABILITY':
    case 'DELEGATION_EXCEEDS_USER_AUTHORITY':
    case 'INITIATOR_LACKS_CAPABILITY':
    case 'CAPABILITY_OUTSIDE_AGENT_DEFINITION':
      return POLICY_IDS.AGENT_DELEGATION_REQUIRED;
    case 'AGENT_NOT_FOUND':
    case 'AGENT_SUSPENDED':
    case 'AGENT_REVOKED':
    case 'FORGED_AGENT_CONTEXT':
    case 'AGENT_AUTHORITY_UNAVAILABLE':
      return POLICY_IDS.AGENT_IDENTITY;
    case 'AGENT_OUT_OF_SCOPE':
      return POLICY_IDS.WORKSPACE_SCOPE;
    case 'CAPABILITY_NOT_DELEGABLE':
    case 'AGENT_TO_AGENT_NOT_SUPPORTED':
      return POLICY_IDS.AGENT_NON_DELEGABLE;
    case 'APPROVAL_DECISION_NOT_PERMITTED':
    case 'APPROVAL_EXPIRED':
    case 'WRONG_APPROVER_ROLE':
    case 'SELF_APPROVAL_FORBIDDEN':
    case 'APPROVAL_ARGUMENTS_MISMATCH':
    case 'AGENT_APPROVAL_MISMATCH':
    case 'APPROVAL_NOT_BOUND':
    case 'WORKFLOW_INNER_APPROVAL_UNCOVERED':
      return POLICY_IDS.APPROVAL_SEPARATION;
    case 'RESERVED_ARGUMENT':
    case 'ARGUMENT_TOO_DEEP':
      return POLICY_IDS.ARGUMENT_TRUST;
    default:
      return undefined;
  }
}
