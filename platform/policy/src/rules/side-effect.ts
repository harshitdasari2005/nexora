import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';
import { POLICY_IDS } from '../ids.js';
import type { PolicyRule, RuleVerdict } from '../contracts.js';

/**
 * The single definition of "does this side-effect class need approval under
 * this autonomy tier" (BR-13, AC-3, PSD §7.20). The planner, the executor
 * and the engine all consult THIS function — there is no second copy.
 *
 * Consequential → always; state_change → unless the tier is `autonomous`;
 * read_only → never.
 */
export function sideEffectRequiresApproval(
  sideEffectClass: SideEffectClass,
  autonomyTier: AutonomyTier,
): boolean {
  if (sideEffectClass === 'read_only') {
    return false;
  }
  if (sideEffectClass === 'consequential') {
    return true;
  }
  return autonomyTier !== 'autonomous';
}

/** POLICY_SIDE_EFFECT_APPROVAL. */
export const sideEffectApprovalRule: PolicyRule = {
  id: POLICY_IDS.SIDE_EFFECT_APPROVAL,
  version: '1',
  evaluate(request): RuleVerdict {
    const { sideEffectClass, autonomyTier } = request;
    if (sideEffectClass === 'read_only') {
      return {
        outcome: 'ALLOW',
        reasonCode: 'READ_ONLY',
        reason: 'Read-only actions never require approval',
      };
    }
    if (sideEffectClass === 'consequential') {
      return {
        outcome: 'REQUIRE_APPROVAL',
        reasonCode: 'CONSEQUENTIAL_ACTION',
        reason: 'Consequential actions always require human approval (BR-13)',
        constraints: { sideEffectClass, autonomyTier },
      };
    }
    return sideEffectRequiresApproval(sideEffectClass, autonomyTier)
      ? {
          outcome: 'REQUIRE_APPROVAL',
          reasonCode: 'STATE_CHANGE_UNDER_TIER',
          reason: 'State changes require approval under the current autonomy tier',
          constraints: { sideEffectClass, autonomyTier },
        }
      : {
          outcome: 'ALLOW',
          reasonCode: 'STATE_CHANGE_AUTONOMOUS',
          reason: 'State changes are permitted under the autonomous tier',
          constraints: { sideEffectClass, autonomyTier },
        };
  },
};
