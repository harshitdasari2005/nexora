/**
 * @nexora/ai-runtime — side-effect guard.
 *
 * The pre-invocation gatekeeper (AIR.md §10, §12; BR-13): classifies a tool's
 * side-effect class against the autonomy tier and decides whether human
 * approval is required before invocation. Consequential actions always
 * require approval (AC-3); read-only actions never do.
 */

import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';
import { sideEffectRequiresApproval } from '@nexora/module-policy';
import { SIDE_EFFECT_WEIGHT } from '@nexora/shared/constants';

/** The decision of the side-effect guard. */
export interface SideEffectDecision {
  /** Whether approval is required before invocation. */
  requiresApproval: boolean;
  /** The side-effect class of the action. */
  sideEffectClass: SideEffectClass;
  /** The autonomy tier the decision was made under. */
  autonomyTier: AutonomyTier;
  /** Human-readable reason (explainability). */
  reason: string;
}

/**
 * Evaluates whether an action requires approval under the given tier.
 * Consequential → always; state_change → unless the tier is `autonomous`;
 * read_only → never (BR-13, PSD.md §7.20).
 */
export function evaluateSideEffect(
  sideEffectClass: SideEffectClass,
  autonomyTier: AutonomyTier,
): SideEffectDecision {
  // One definition of the rule (POLICY_SIDE_EFFECT_APPROVAL); this wrapper
  // only adds the explainability text this module has always returned.
  const requiresApproval = sideEffectRequiresApproval(sideEffectClass, autonomyTier);
  const reason =
    sideEffectClass === 'read_only'
      ? 'Read-only actions never require approval'
      : sideEffectClass === 'consequential'
        ? 'Consequential actions always require human approval (BR-13)'
        : requiresApproval
          ? 'State changes require approval under the current autonomy tier'
          : 'State changes are permitted under the autonomous tier';
  return { requiresApproval, sideEffectClass, autonomyTier, reason };
}

/** Compares two side-effect classes by severity (for risk analysis). */
export function isMoreSevereThan(a: SideEffectClass, b: SideEffectClass): boolean {
  return SIDE_EFFECT_WEIGHT[a] > SIDE_EFFECT_WEIGHT[b];
}
