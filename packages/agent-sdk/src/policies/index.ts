/**
 * @nexora/agent-sdk — policies.
 *
 * Policy evaluation contracts (AIR.md §13). Policies are deny-wins: any
 * evaluated requirement that is not satisfied denies the execution. The
 * `PolicyEvaluator` is the extension point — the platform Policy Engine
 * plugs in at runtime; the SDK stays provider-independent.
 */

/** A requirement a policy places on an execution. */
export interface PolicyRequirement {
  /** The policy id that owns the requirement. */
  policyId: string;
  /** Human-readable description of what is required. */
  description: string;
}

/** The decision of a single policy evaluation. */
export interface PolicyDecision {
  /** Whether the policy allows the execution. */
  allowed: boolean;
  /** The policy id evaluated. */
  policyId: string;
  /** The reason for the decision, when denied. */
  reason?: string;
}

/**
 * The policy evaluation context a decision is made against. (Distinct from
 * the `PolicyContext` view in the contexts module, which records applied
 * policy ids on an execution.)
 */
export interface PolicyEvaluationContext {
  /** Tenant scope. */
  tenantId: string;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: string;
  /** The action being evaluated, e.g. `skills.hire_employee`. */
  action: string;
  /** The actor (user or agent) performing the action. */
  actor: string;
  /** Requirements that must all be satisfied (deny-wins). */
  requirements: readonly PolicyRequirement[];
}

/** The result of evaluating a set of requirements (deny-wins). */
export interface PolicyEvaluation {
  /** Whether all requirements were satisfied. */
  allowed: boolean;
  /** Per-requirement decisions. */
  decisions: readonly PolicyDecision[];
  /** The policy that denied the execution, when denied. */
  deniedBy?: string;
}

/**
 * Evaluates requirements deny-wins: every requirement must be satisfied.
 * A single denial fails the evaluation.
 */
export function evaluatePolicies(
  context: PolicyEvaluationContext,
  satisfy: (requirement: PolicyRequirement) => boolean,
): PolicyEvaluation {
  const decisions = context.requirements.map((requirement) => {
    const satisfied = satisfy(requirement);
    return {
      allowed: satisfied,
      policyId: requirement.policyId,
      reason: satisfied ? undefined : `Requirement not satisfied: ${requirement.description}`,
    };
  });
  const denied = decisions.find((decision) => !decision.allowed);
  return {
    allowed: denied === undefined,
    decisions,
    deniedBy: denied?.policyId,
  };
}

/**
 * The policy evaluator contract. The platform Policy Engine implements this
 * and is injected into agents at construction time.
 */
export interface PolicyEvaluator {
  /** The evaluator name, for observability. */
  name: string;
  /** Evaluates an action against the execution's policies. */
  evaluate(context: PolicyEvaluationContext): Promise<PolicyEvaluation>;
}
