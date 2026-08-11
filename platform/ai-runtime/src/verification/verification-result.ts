/**
 * @nexora/ai-runtime — verification results.
 *
 * The aggregate outcome of running verification rules over an execution
 * (AIR.md §7 stage 8). A result is only ever reported as `verified` when
 * every applicable rule passed; anything less is reported as unverified —
 * never silently treated as done (AI-6, TLR-3).
 */

import type { VerificationCheck } from './verification-rule.js';

/** Confidence in the verification outcome, 0..1 (displayed, never a gate). */
export type ConfidenceScore = number;

/** Clamps a raw confidence value into the 0..1 range. */
export function clampConfidence(value: number): ConfidenceScore {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * The outcome of verifying an execution result. `verified` is true only when
 * every rule passed; `checks` records each rule's individual outcome.
 */
export interface VerificationResult {
  /** Whether the result is verified (every rule passed). */
  verified: boolean;
  /** Per-rule outcomes, in rule order. */
  checks: readonly VerificationCheck[];
  /** Confidence 0..1 derived from the rule outcomes. */
  confidence: ConfidenceScore;
  /** Human-readable summary of the outcome. */
  message: string;
}
