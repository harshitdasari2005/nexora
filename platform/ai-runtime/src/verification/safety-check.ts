/**
 * @nexora/ai-runtime — safety checks.
 *
 * Pre-execution {@link SafetyCheck}s run *before* a tool is invoked
 * (AIR.md §7 stage 5 Risk Analysis). They are distinct from verification
 * rules (which inspect results after the fact): safety checks veto
 * invocations up front (side-effect class, destructive input, budget).
 */

/** The input being checked (pre-invocation view). */
export interface SafetyCheckInput {
  /** The tool id being invoked. */
  toolId: string;
  /** The invocation input. */
  input: Record<string, unknown>;
  /** Side-effect class of the tool. */
  sideEffectClass: 'read_only' | 'state_change' | 'consequential';
  /** Tenant scope. */
  tenantId: string;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: string;
}

/** The outcome of a single safety check. */
export interface SafetyCheckResult {
  /** The check id. */
  checkId: string;
  /** Whether the invocation is safe to proceed. */
  safe: boolean;
  /** Reason when the invocation is blocked. */
  reason?: string;
}

/**
 * A single pre-execution safety check. Checks are pure; the
 * {@link SafetyEvaluator} aggregates them deny-wins.
 */
export interface SafetyCheck {
  /** Stable check id, e.g. `side-effect-class`. */
  id: string;
  /** Human-readable description of what the check guards. */
  description: string;
  /** Evaluates the invocation; returns safe / blocked. */
  evaluate(input: SafetyCheckInput): SafetyCheckResult | Promise<SafetyCheckResult>;
}

/**
 * Evaluates a list of safety checks deny-wins: the invocation is safe only
 * when every check passes. Blocked checks report their reasons.
 */
export async function evaluateSafety(
  checks: readonly SafetyCheck[],
  input: SafetyCheckInput,
): Promise<{ safe: boolean; results: readonly SafetyCheckResult[] }> {
  const results = await Promise.all(checks.map((check) => check.evaluate(input)));
  const blocked = results.filter((result) => !result.safe);
  return { safe: blocked.length === 0, results };
}
