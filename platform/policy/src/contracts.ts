/**
 * @nexora/module-policy — the policy decision contract.
 *
 * Three different questions, three different layers (never collapsed):
 *
 * - RBAC / agent delegation: "may this actor perform this capability at all?"
 * - **Policy** (this module): "under what conditions may it be performed?"
 * - Approval: "does an authorized human have to say yes to this exact action?"
 *
 * A policy can only CONSTRAIN authority (deny it, or attach conditions); it
 * can never manufacture authority. The engine runs after RBAC, agent
 * delegation and resource scope have already allowed the action, and its
 * outcome is combined with them by "any deny wins".
 *
 * Everything in a {@link PolicyRequest} is trusted, server-side state — the
 * authenticated user, the persisted agent, the resolved organization and
 * workspace, persisted resource facts, persisted policy configuration.
 * Model output, retrieved text, tool responses and client-supplied fields
 * never reach the engine as policy inputs (tool arguments reach it only as
 * operands the rules compare, e.g. an amount, never as claims).
 */

import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';

/** The three possible policy outcomes. */
export type PolicyOutcome = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

/** A persisted organization budget, as resolved by trusted repositories. */
export interface BudgetFact {
  status: 'active' | 'under_review' | 'closed';
  allocatedMinorUnits: number;
  /** Approved spend (the finance utilization projection). */
  spentMinorUnits: number;
  currency: string;
}

/** A trusted fact that may not have been resolvable (fails closed in rules that need it). */
export type Resolvable<T> = { state: 'resolved'; value: T } | { state: 'unresolvable' };

/** One persisted policy configuration entry of the run's organization. */
export interface PolicyConfigEntry {
  /** The configuration version (monotonic per organization + policy). */
  version: number;
  /** The raw persisted configuration (validated by the owning rule). */
  config: unknown;
  /**
   * Whether the configuration is enabled. A disabled configuration does not
   * apply (safe: configurations only tighten). Absent means enabled.
   */
  enabled?: boolean;
}

/** Trusted facts resolved by the caller before evaluation (never by the model). */
export interface PolicyFacts {
  /** The budget an expense targets (only resolved for budget-scoped capabilities). */
  budget?: Resolvable<BudgetFact>;
  /** The organization's persisted policy configuration, by policy id. */
  configs: Readonly<Record<string, PolicyConfigEntry>>;
}

/** The request a policy decision is made about. */
export interface PolicyRequest {
  organizationId: string;
  workspaceId?: string;
  /** The initiating human. */
  actor: { userId: string };
  /** The persisted agent, when the run is an agent run. */
  agent?: { agentId: string; delegationId?: string };
  capabilityId: string;
  toolId: string;
  /** The action name (audit vocabulary), e.g. `tool.execute`. */
  action: string;
  sideEffectClass: SideEffectClass;
  autonomyTier: AutonomyTier;
  /** Where the invocation came from (`chat`, `agent`, `mcp`, `workflow`, …). */
  origin: string;
  /** The (approved) arguments. Operands only — never claims. */
  input: Readonly<Record<string, unknown>>;
  facts: PolicyFacts;
}

/** What one rule concluded (a rule that does not apply returns `undefined`). */
export interface RuleVerdict {
  outcome: PolicyOutcome;
  reasonCode: string;
  /** A human-readable reason (no secrets, no argument values beyond amounts/ids). */
  reason: string;
  /** Overrides the rule's version (e.g. the configuration version it evaluated). */
  version?: string;
  /** Structured, machine-readable conditions (e.g. the limit that applied). */
  constraints?: Readonly<Record<string, string | number | boolean>>;
}

/** A pure, deterministic policy rule. */
export interface PolicyRule {
  /** Stable id, e.g. `POLICY_FINANCE_BUDGET_LIMIT`. */
  readonly id: string;
  /** The rule's code version (bump on any behavioural change). */
  readonly version: string;
  evaluate(request: PolicyRequest): RuleVerdict | undefined;
}

/** One rule that took part in a decision. */
export interface MatchedRule {
  policyId: string;
  version: string;
  outcome: PolicyOutcome;
  reasonCode: string;
}

/** The approval governance a policy decision attaches to a REQUIRE_APPROVAL outcome. */
export interface ApprovalRequirementSpec {
  /** The decider must differ from the requester. */
  separationOfDuties: boolean;
  /** The decider's resolved role in the approval's workspace must equal this role id. */
  requiredApproverRoleId?: string;
  /** How long the approval stays decidable/executable (minutes). */
  ttlMinutes?: number;
  /** Always `POLICY_APPROVAL_AUTHORITY`. */
  policyId: string;
  /** The rule version plus the governing configuration version, e.g. `1+config.3`. */
  policyVersion: string;
}

/** The machine-readable policy decision. */
export interface PolicyDecision {
  outcome: PolicyOutcome;
  /** The deciding rule (the first of the most restrictive matches). */
  policyId: string;
  version: string;
  reasonCode: string;
  reason: string;
  /** Every rule that produced a verdict, most restrictive first, then by policy id. */
  matchedRules: readonly MatchedRule[];
  /** Set when the outcome is REQUIRE_APPROVAL. */
  approvalRequirement?: { type: 'human' };
  /**
   * The approval governance that applies, set ONLY when the outcome is
   * REQUIRE_APPROVAL and an enabled POLICY_APPROVAL_AUTHORITY configuration
   * matches the request's capability. It can only tighten the approval
   * (who may decide, how long it stays valid); it never removes the need for
   * approval and never overrides a DENY.
   */
  approval?: ApprovalRequirementSpec;
  constraints?: Readonly<Record<string, string | number | boolean>>;
  /**
   * A stable digest of WHICH rules (id + version) decided WHAT: the same
   * trusted state and request always produce the same fingerprint. Recorded
   * on approvals so a resumed run can tell that the policy changed.
   */
  fingerprint: string;
  /** ISO-8601 evaluation time (informational; not part of the fingerprint). */
  evaluatedAt: string;
  /**
   * A digest of the TRUSTED FACTS the decision was made over (e.g. the
   * budget's status and spend, the configuration versions) — set by the host
   * that resolved them (Prompt 6). It lets lineage show "this decision was
   * made over that state" without storing the state, and shows that a later
   * decision was made over different state. Informational: not part of the
   * decision `fingerprint` and never an input to any decision.
   */
  contextFingerprint?: string;
}
