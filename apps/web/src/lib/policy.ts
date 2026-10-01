/**
 * @nexora/app-web — Policy administration + approval governance client.
 *
 * Typed wrappers over `/api/policy/*` and `/api/approvals/pending`, plus the
 * PURE structured-form helpers. Policy configuration is data, never code:
 * the form only ever produces the allow-listed shapes below, and the server
 * re-validates everything (422) — the client checks are UX, not security.
 */

import { api } from './api.js';
import type {
  ApprovalAuthorityRule,
  ApprovalGovernanceDto,
  PolicyAdminDto,
  PolicyVersionDto,
  PolicyVersionRequest,
} from './types.js';

/** The (required) tenant + workspace scope of a request. */
export interface PolicyScope {
  organizationId: string;
  workspaceId: string;
}

export const POLICY_FINANCE_BUDGET_LIMIT = 'POLICY_FINANCE_BUDGET_LIMIT';
export const POLICY_APPROVAL_AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';

/** Budget-limit modes (tighten-only enum). */
export const BUDGET_MODES = ['deny', 'require_approval'] as const;
export type BudgetMode = (typeof BUDGET_MODES)[number];

/** Maximum approval-authority rules the server accepts. */
export const MAX_APPROVAL_RULES = 20;
/** Id-like pattern: letters, digits, `.`, `_`, `-`, `:` only. */
export const ID_LIKE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const qs = (scope: PolicyScope): string =>
  `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;

/** Lists every policy with its admin state. */
export async function listPolicies(scope: PolicyScope): Promise<PolicyAdminDto[]> {
  const res = await api<{ policies: PolicyAdminDto[] }>(`/policy/policies?${qs(scope)}`);
  return res.policies;
}

/** Fetches a policy's version history (newest first). */
export async function getPolicyHistory(
  scope: PolicyScope,
  policyId: string,
): Promise<PolicyVersionDto[]> {
  const res = await api<{ versions: PolicyVersionDto[] }>(
    `/policy/policies/${encodeURIComponent(policyId)}/history?${qs(scope)}`,
  );
  return res.versions;
}

/** Appends a new policy version (structured body only). */
export async function createPolicyVersion(
  scope: PolicyScope,
  policyId: string,
  body: PolicyVersionRequest,
): Promise<PolicyVersionDto> {
  const res = await api<{ version: PolicyVersionDto }>(
    `/policy/policies/${encodeURIComponent(policyId)}/versions?${qs(scope)}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return res.version;
}

/** Lists pending approvals with the server-computed `canDecide`. */
export async function listPendingApprovals(scope: PolicyScope): Promise<ApprovalGovernanceDto[]> {
  const res = await api<{ approvals: ApprovalGovernanceDto[] }>(`/approvals/pending?${qs(scope)}`);
  return res.approvals;
}

/** A form row of the approval-authority editor (strings/booleans only). */
export interface RuleDraft {
  capabilityPrefix: string;
  separationOfDuties: boolean;
  requiredApproverRoleId: string;
  ttlMinutes: string;
}

/** Empty rule row. */
export const emptyRuleDraft = (): RuleDraft => ({
  capabilityPrefix: '',
  separationOfDuties: false,
  requiredApproverRoleId: '',
  ttlMinutes: '',
});

/** Reads existing approval-authority rules out of a config object (defensively). */
export function rulesFromConfig(config: Record<string, unknown> | undefined): RuleDraft[] {
  const raw = config?.['rules'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      capabilityPrefix: typeof r['capabilityPrefix'] === 'string' ? r['capabilityPrefix'] : '',
      separationOfDuties: r['separationOfDuties'] === true,
      requiredApproverRoleId:
        typeof r['requiredApproverRoleId'] === 'string' ? r['requiredApproverRoleId'] : '',
      ttlMinutes: typeof r['ttlMinutes'] === 'number' ? String(r['ttlMinutes']) : '',
    }));
}

/** Client-side field validation; returns an error message or null. */
export function validateRuleDrafts(rules: readonly RuleDraft[]): string | null {
  if (rules.length > MAX_APPROVAL_RULES) return `At most ${MAX_APPROVAL_RULES} rules.`;
  for (const [i, rule] of rules.entries()) {
    const n = i + 1;
    if (!ID_LIKE.test(rule.capabilityPrefix)) {
      return `Rule ${n}: capability prefix must be an id (letters, digits, . _ : -).`;
    }
    if (rule.requiredApproverRoleId !== '' && !ID_LIKE.test(rule.requiredApproverRoleId)) {
      return `Rule ${n}: approver role must be an id (letters, digits, . _ : -).`;
    }
    if (rule.ttlMinutes !== '') {
      const ttl = Number(rule.ttlMinutes);
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > 10080) {
        return `Rule ${n}: TTL must be a whole number of minutes between 1 and 10080.`;
      }
    }
  }
  return null;
}

/** Builds the structured approval-authority config from validated drafts. */
export function rulesToConfig(rules: readonly RuleDraft[]): { rules: ApprovalAuthorityRule[] } {
  return {
    rules: rules.map((rule) => ({
      capabilityPrefix: rule.capabilityPrefix,
      separationOfDuties: rule.separationOfDuties,
      ...(rule.requiredApproverRoleId !== ''
        ? { requiredApproverRoleId: rule.requiredApproverRoleId }
        : {}),
      ...(rule.ttlMinutes !== '' ? { ttlMinutes: Number(rule.ttlMinutes) } : {}),
    })),
  };
}

/** Relative time to an ISO instant (`in 5 min`, `2 h ago`, `expired`). Pure given `now`. */
export function relativeTo(iso: string, now: number = Date.now()): string {
  const diffMs = new Date(iso).getTime() - now;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  const text =
    mins < 1
      ? 'less than a minute'
      : mins < 60
        ? `${mins} min`
        : mins < 2880
          ? `${Math.round(mins / 60)} h`
          : `${Math.round(mins / 1440)} d`;
  return diffMs >= 0 ? `in ${text}` : `${text} ago`;
}
