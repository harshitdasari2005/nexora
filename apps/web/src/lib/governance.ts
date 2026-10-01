/**
 * @nexora/app-web — shared governance presentation helpers.
 *
 * Pure label functions for the actor / approval / verification facts shown on
 * the Runtime detail and the Audit decision trace. Wording is deliberately
 * honest: only a read-back is "verified"; a tool's own report never is.
 */

import type { GovernanceExecutionAuthority, GovernanceVerificationSource } from './types.js';

/** Plain-words label for the verification outcome and how it was established. */
export function verificationLabel(v: {
  verified: boolean;
  source: GovernanceVerificationSource | string;
}): string {
  switch (v.source) {
    case 'state_readback':
      return v.verified ? 'Verified by state read-back' : 'State read-back did not confirm';
    case 'provider_readback':
      return v.verified ? 'Verified by provider read-back' : 'Provider read-back did not confirm';
    case 'response_shape':
      return v.verified
        ? 'Response shape matched — not an independent read-back'
        : 'Response shape did not match';
    case 'redetection':
      return v.verified ? 'Verified by re-detection' : 'Re-detection did not confirm';
    case 'handler_result':
      return 'Reported by the tool — not independently verified';
    default:
      return 'Verification source unknown — not independently verified';
  }
}

/** True only for sources that independently re-read state. */
export function isIndependentlyVerified(v: { verified: boolean; source: string }): boolean {
  return (
    v.verified &&
    (v.source === 'state_readback' ||
      v.source === 'provider_readback' ||
      v.source === 'redetection')
  );
}

/** The execution authority in words. */
export function executionAuthorityLabel(a: GovernanceExecutionAuthority | string): string {
  return a === 'agent_delegation'
    ? "Agent's delegation (the agent's own granted permissions)"
    : a === 'requester_rbac'
      ? "Requester's role permissions"
      : 'Unknown authority';
}
