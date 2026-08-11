/**
 * @nexora/ai-runtime — verification rules.
 *
 * A {@link VerificationRule} is a single, named check over an execution
 * result (AIR.md §7 stage 8 Result Verification). Rules compose: the
 * {@link ExecutionVerifier} runs every rule and aggregates the outcome.
 */

/** The result shape a verification rule inspects. */
export interface VerifiableResult {
  /** Whether the execution reported success. */
  ok: boolean;
  /** The output produced on success. */
  output?: unknown;
  /** The error payload on failure. */
  error?: { code: string; message: string };
}

/**
 * A single verification rule. Rules are pure — they inspect a result and
 * answer "did this check pass?" without side effects.
 */
export interface VerificationRule {
  /** Stable rule id, e.g. `result.successful`. */
  id: string;
  /** Human-readable description of what the rule checks. */
  description: string;
  /** Runs the check over the result. */
  check(result: VerifiableResult): boolean | Promise<boolean>;
}

/** The outcome of a single rule check. */
export interface VerificationCheck {
  /** The rule id. */
  ruleId: string;
  /** Whether the rule passed. */
  passed: boolean;
  /** Optional detail when the rule failed. */
  detail?: string;
}
