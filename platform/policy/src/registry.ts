import { POLICY_IDS } from './ids.js';
import { APPROVAL_AUTHORITY_RULE_VERSION } from './rules/approval-authority.js';

/** What a policy does when it applies. */
export type PolicyBehavior = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'CONFIGURABLE';

/** One entry of the policy registry (read model for policy administration). */
export interface PolicyRegistryEntry {
  policyId: string;
  title: string;
  description: string;
  /** Whether an organization may configure it (structured, validated, tighten-only). */
  configurable: boolean;
  /** `platform` = fixed by code, shown read-only; `organization` = org-tunable. */
  managedBy: 'platform' | 'organization';
  /** The current static rule (code) version. */
  ruleVersion: string;
  behavior: PolicyBehavior;
  /**
   * `engine` = evaluated by the PolicyEngine; `enforcement` = enforced by an
   * earlier layer (agent authority, argument guard, approval authorization)
   * and named here so denials share one vocabulary.
   */
  layer: 'engine' | 'enforcement';
}

const platform = (
  policyId: string,
  title: string,
  description: string,
  behavior: PolicyBehavior,
  layer: 'engine' | 'enforcement',
  ruleVersion = '1',
): PolicyRegistryEntry => ({
  policyId,
  title,
  description,
  configurable: false,
  managedBy: 'platform',
  ruleVersion,
  behavior,
  layer,
});

const organization = (
  policyId: string,
  title: string,
  description: string,
  ruleVersion: string,
): PolicyRegistryEntry => ({
  policyId,
  title,
  description,
  configurable: true,
  managedBy: 'organization',
  ruleVersion,
  behavior: 'CONFIGURABLE',
  layer: 'engine',
});

/**
 * Every policy id, with its title, description, whether it is configurable and
 * its current static rule version. The engine's DEFAULT_POLICY_RULES ids are
 * all present (asserted by tests). Sorted by policy id.
 */
export const POLICY_REGISTRY: readonly PolicyRegistryEntry[] = [
  platform(
    POLICY_IDS.AGENT_DELEGATION_EXPIRY,
    'Agent delegation expiry',
    'An agent may act only under an unexpired, unrevoked delegation.',
    'DENY',
    'enforcement',
  ),
  platform(
    POLICY_IDS.AGENT_DELEGATION_REQUIRED,
    'Agent delegation required',
    'An agent needs a delegation that covers the capability, within the delegator authority.',
    'DENY',
    'enforcement',
  ),
  platform(
    POLICY_IDS.AGENT_DELEGATION_SCOPE,
    'Agent delegation scope',
    'An agent may act only on resources inside its delegation scope.',
    'DENY',
    'enforcement',
  ),
  platform(
    POLICY_IDS.AGENT_IDENTITY,
    'Agent identity',
    'Agents must be persisted, active identities inside the run organization and workspace.',
    'DENY',
    'enforcement',
  ),
  platform(
    POLICY_IDS.AGENT_NON_DELEGABLE,
    'Non-delegable capabilities',
    'Some capabilities (for example policy administration) can never be delegated to an agent.',
    'DENY',
    'enforcement',
  ),
  organization(
    POLICY_IDS.APPROVAL_AUTHORITY,
    'Approval authority',
    'Who may decide an approval (separation of duties, required approver role) and how long it stays valid. Tighten-only; applies only to actions that already require approval.',
    APPROVAL_AUTHORITY_RULE_VERSION,
  ),
  platform(
    POLICY_IDS.APPROVAL_SEPARATION,
    'Approval decisions',
    'Approval decisions are made by an authenticated, authorized human on the exact approved arguments.',
    'DENY',
    'enforcement',
  ),
  platform(
    POLICY_IDS.ARGUMENT_TRUST,
    'Argument trust',
    'Untrusted values may never set identity, scope, authority, approval or policy.',
    'DENY',
    'enforcement',
  ),
  platform(
    POLICY_IDS.ENGINE,
    'Policy engine',
    'Fails closed: missing policy, incomplete context or an evaluation failure denies the action.',
    'DENY',
    'engine',
  ),
  organization(
    POLICY_IDS.FINANCE_BUDGET_LIMIT,
    'Finance budget limit',
    'An expense that would overrun its budget is denied or requires approval (organization-configurable).',
    '1',
  ),
  platform(
    POLICY_IDS.FINANCE_BUDGET_STATE,
    'Finance budget state',
    'Expenses cannot target a closed or unresolvable budget; an under-review budget requires approval.',
    'DENY',
    'engine',
  ),
  platform(
    POLICY_IDS.FINANCE_EXPENSE_APPROVAL,
    'Finance expense approval',
    'Submitting an expense moves money and always requires human approval.',
    'REQUIRE_APPROVAL',
    'engine',
  ),
  organization(
    POLICY_IDS.HIRING_CHANNEL,
    'Hiring through hiring requests',
    'People are hired through a hiring request (the team asks, the CEO and Finance decide, HR recruits). When on, a direct hire by the assistant or an agent is denied.',
    '1',
  ),
  platform(
    POLICY_IDS.SIDE_EFFECT_APPROVAL,
    'Side-effect approval',
    'Consequential actions always require approval; state changes require it unless the autonomy tier is autonomous.',
    'REQUIRE_APPROVAL',
    'engine',
  ),
  platform(
    POLICY_IDS.TENANT_ISOLATION,
    'Tenant isolation',
    'Every action is confined to the trusted organization.',
    'DENY',
    'enforcement',
  ),
  platform(
    POLICY_IDS.WORKSPACE_SCOPE,
    'Workspace scope',
    'Every action is confined to the trusted workspace.',
    'DENY',
    'enforcement',
  ),
].sort((a, b) => (a.policyId < b.policyId ? -1 : 1));

/** The registry entry of a policy id. */
export function getPolicyRegistryEntry(policyId: string): PolicyRegistryEntry | undefined {
  return POLICY_REGISTRY.find((entry) => entry.policyId === policyId);
}
