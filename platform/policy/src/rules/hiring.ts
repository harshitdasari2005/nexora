/**
 * @nexora/module-policy — hiring channel.
 *
 * In an office a person is hired through a hiring request: the team asks, the
 * CEO and Finance decide, HR recruits. An organization that works that way
 * turns this policy on, and the shortcut — asking the assistant (or an agent)
 * to create an employee directly — is refused with a pointer to the proper way.
 */

import { POLICY_IDS } from '../ids.js';
import type { PolicyRule, RuleVerdict } from '../contracts.js';

/** The capabilities that put a person on the payroll without a hiring request. */
export const DIRECT_HIRE_CAPABILITIES: readonly string[] = [
  'hr.create_employee',
  'workflow.hire_and_assign_employee',
];

/** The validated configuration of POLICY_HIRING_CHANNEL. */
export interface HiringChannelConfig {
  /** What happens to a direct hire. Only tightening is possible. */
  directHire: 'deny';
}

/**
 * Parses a persisted hiring-channel configuration (lenient about extra keys so
 * a stored value never silently stops applying; the write-side validator in
 * `config-validation.ts` is strict).
 */
export function parseHiringChannelConfig(raw: unknown): HiringChannelConfig | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  return (raw as Record<string, unknown>)['directHire'] === 'deny'
    ? { directHire: 'deny' }
    : undefined;
}

/**
 * POLICY_HIRING_CHANNEL — OPT-IN, per organization. When the organization has
 * configured it, a direct hire is denied. With no configuration the rule does
 * not apply, so default behaviour is unchanged. A configuration that cannot be
 * understood fails closed (DENY) — a broken policy never silently becomes "no
 * policy".
 */
export const hiringChannelRule: PolicyRule = {
  id: POLICY_IDS.HIRING_CHANNEL,
  version: '1',
  evaluate(request): RuleVerdict | undefined {
    if (!DIRECT_HIRE_CAPABILITIES.includes(request.capabilityId)) {
      return undefined;
    }
    const entry = request.facts.configs[POLICY_IDS.HIRING_CHANNEL];
    if (entry === undefined || entry.enabled === false) {
      return undefined;
    }
    const version = `${this.version}+config.${entry.version}`;
    if (parseHiringChannelConfig(entry.config) === undefined) {
      return {
        outcome: 'DENY',
        reasonCode: 'POLICY_CONFIGURATION_INVALID',
        reason: 'The organization policy configuration is invalid; failing closed',
        version,
      };
    }
    return {
      outcome: 'DENY',
      reasonCode: 'HIRING_REQUEST_REQUIRED',
      reason:
        'Hiring here goes through a hiring request: raise one under Hiring, the CEO and Finance decide, and HR recruits',
      version,
    };
  },
};
