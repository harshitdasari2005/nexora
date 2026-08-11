/**
 * @nexora/ai-runtime — execution verifier.
 *
 * The verifier (AIR.md §1.2 R3 Reasoner, §7 stage 8) decides whether an
 * executed action is *verified*. The default implementation composes
 * verification rules deny-wins and derives a confidence score; the interface
 * is the extension point for domain-specific verification (read-back checks,
 * state queries).
 */

import type { VerifiableResult, VerificationRule } from './verification-rule.js';
import type { VerificationResult } from './verification-result.js';
import { clampConfidence } from './verification-result.js';

/** Built-in rule ids provided by the default verifier. */
export const DEFAULT_VERIFICATION_RULES = ['result.successful'] as const;

/** The built-in "execution reported success" rule. */
export function successRule(): VerificationRule {
  return {
    id: 'result.successful',
    description: 'The execution reported a successful result',
    check: (result: VerifiableResult) => result.ok,
  };
}

/** The verifier contract: runs rules and produces a {@link VerificationResult}. */
export interface ExecutionVerifier {
  /**
   * Verifies an execution result.
   *
   * @param result - the executed action's result.
   * @param rules  - optional extra rules; the built-in success rule always runs first.
   */
  verify(
    result: VerifiableResult,
    rules?: readonly VerificationRule[],
  ): Promise<VerificationResult>;
}

/**
 * The default verifier: runs the built-in success rule plus any supplied
 * rules, deny-wins. Confidence is the fraction of passed checks, clamped to
 * 0..1.
 */
export class DefaultExecutionVerifier implements ExecutionVerifier {
  /**
   * @param extraRules - rules appended to the built-in success rule.
   */
  constructor(private readonly extraRules: readonly VerificationRule[] = []) {}

  async verify(
    result: VerifiableResult,
    rules: readonly VerificationRule[] = [],
  ): Promise<VerificationResult> {
    const allRules = [successRule(), ...this.extraRules, ...rules];
    const checks = await Promise.all(
      allRules.map(async (rule) => {
        const passed = await rule.check(result);
        return {
          ruleId: rule.id,
          passed,
          detail: passed ? undefined : `Rule ${rule.id} failed`,
        };
      }),
    );
    const verified = checks.every((check) => check.passed);
    const passedCount = checks.filter((check) => check.passed).length;
    return {
      verified,
      checks,
      confidence: clampConfidence(checks.length === 0 ? 0 : passedCount / checks.length),
      message: verified
        ? 'Result verified'
        : `Verification failed (${checks.length - passedCount} rule(s))`,
    };
  }
}
