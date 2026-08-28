/**
 * @nexora/module-remediation — approval routing policy (Phase 10).
 *
 * The approval-ROUTING layer on top of the EXISTING ApprovalEngine: it
 * decides, per step capability, WHETHER approval is required and WHICH role
 * should approve — derived server-side from the capability's side-effect
 * class (existing vocabulary) + a deterministic role routing table (policy
 * configuration, never hard-coded job titles in the engine). The actual
 * GATE remains the existing ApprovalEngine: this policy only routes, it
 * never grants. The client can never choose the approver.
 *
 * The default policy: read-only capabilities never require approval;
 * state-changing/consequential capabilities always require approval, with
 * the approver role resolved from the capability-prefix routing table
 * (falling back to the most senior role `executive.ceo` for anything
 * unmapped). A domain registers its own routing entries the same way —
 * no engine changes.
 */

import type { RemediationCapabilityMetadata } from './remediation-ports.js';

/** The routing decision for one capability. */
export interface ApprovalRoutingDecision {
  /** Whether approval is required before the step executes. */
  approvalRequired: boolean;
  /** The server-derived approver role id, when approval is required. */
  requiredApproverRoleId?: string;
  /** A human-readable reason (explainability). */
  reason: string;
}

/**
 * The approval-routing policy port. Implemented by the default policy or a
 * domain-specific policy — the engine is agnostic.
 */
export interface ApprovalRoutingPolicy {
  resolve(capability: RemediationCapabilityMetadata): Promise<ApprovalRoutingDecision>;
}

/** A capability-prefix → approver-role routing entry (configuration). */
export interface ApprovalRoutingEntry {
  /** A capability id prefix, e.g. `projects.`. */
  capabilityPrefix: string;
  /** The role id that must approve capabilities with this prefix. */
  approverRoleId: string;
}

/** The fallback approver role for unmapped consequential capabilities. */
export const DEFAULT_APPROVER_ROLE_ID = 'executive.ceo';

/**
 * The default routing table (Phase 10 registrations, deterministic). These
 * are POLICY CONFIGURATION: an unlisted consequential capability routes to
 * the most senior role (fail closed toward stricter approval); a domain
 * registers its own entries without touching this table or the engine.
 */
export const DEFAULT_APPROVAL_ROUTING: readonly ApprovalRoutingEntry[] = [
  { capabilityPrefix: 'github.', approverRoleId: 'executive.ceo' },
  { capabilityPrefix: 'slack.', approverRoleId: 'delivery.manager' },
  { capabilityPrefix: 'calendar.', approverRoleId: 'delivery.manager' },
  { capabilityPrefix: 'workflow.', approverRoleId: 'delivery.manager' },
  { capabilityPrefix: 'projects.', approverRoleId: 'delivery.manager' },
  { capabilityPrefix: 'hr.', approverRoleId: 'executive.ceo' },
  { capabilityPrefix: 'notifications.', approverRoleId: 'delivery.manager' },
  { capabilityPrefix: 'connector.', approverRoleId: 'executive.ceo' },
  // S35 Finance vertical: the CFO approves consequential actions within
  // their own domain (money movements, BR-19) — the same "domain owner
  // approves" pattern already used for `projects.` → `delivery.manager`.
  { capabilityPrefix: 'finance.', approverRoleId: 'finance.cfo' },
];

/** The default {@link ApprovalRoutingPolicy} (deterministic, config-driven). */
export class DefaultApprovalRoutingPolicy implements ApprovalRoutingPolicy {
  readonly #entries: readonly ApprovalRoutingEntry[];

  constructor(entries: readonly ApprovalRoutingEntry[] = DEFAULT_APPROVAL_ROUTING) {
    this.#entries = entries;
  }

  async resolve(capability: RemediationCapabilityMetadata): Promise<ApprovalRoutingDecision> {
    if (capability.sideEffectClass === 'read_only') {
      return {
        approvalRequired: false,
        reason: 'Read-only capabilities never require approval (BR-13)',
      };
    }
    const entry = this.#entries.find((candidate) =>
      capability.capabilityId.startsWith(candidate.capabilityPrefix),
    );
    const requiredApproverRoleId = entry?.approverRoleId ?? DEFAULT_APPROVER_ROLE_ID;
    return {
      approvalRequired: true,
      requiredApproverRoleId,
      reason:
        capability.sideEffectClass === 'consequential'
          ? `Consequential actions always require approval (BR-13); routed to ${requiredApproverRoleId}`
          : `State changes require approval; routed to ${requiredApproverRoleId}`,
    };
  }
}
