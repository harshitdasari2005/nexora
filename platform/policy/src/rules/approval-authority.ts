import { POLICY_IDS } from '../ids.js';
import type { ApprovalRequirementSpec, PolicyRequest } from '../contracts.js';

/** The code version of the approval-authority resolution logic (bump on behavioural change). */
export const APPROVAL_AUTHORITY_RULE_VERSION = '1';

/** Maximum rules in one POLICY_APPROVAL_AUTHORITY configuration. */
export const APPROVAL_AUTHORITY_MAX_RULES = 20;
/** Approval TTL bounds in minutes (1 minute .. 7 days). */
export const APPROVAL_TTL_MIN_MINUTES = 1;
export const APPROVAL_TTL_MAX_MINUTES = 10080;

/** One approval governance rule. */
export interface ApprovalAuthorityRule {
  /** Matches a capability id equal to it or starting with it (longest prefix wins). */
  capabilityPrefix: string;
  /** The decider must differ from the requester. */
  separationOfDuties?: boolean;
  /** The decider's role in the approval's workspace must equal this role id. */
  requiredApproverRoleId?: string;
  ttlMinutes?: number;
}

/** The validated configuration of POLICY_APPROVAL_AUTHORITY. */
export interface ApprovalAuthorityConfig {
  rules: readonly ApprovalAuthorityRule[];
}

/** Id-like strings: lowercase, digits and `_ . : -`, at most 80 characters. */
export const POLICY_ID_LIKE = /^[a-z][a-z0-9_.:-]{0,79}$/;

/**
 * Parses a persisted approval-authority configuration. Returns `undefined`
 * when it cannot be understood (the caller fails closed). Strict about shape
 * (the same allow-list the write-side validator enforces).
 */
export function parseApprovalAuthorityConfig(raw: unknown): ApprovalAuthorityConfig | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'rules') return undefined;
  const rules = (raw as Record<string, unknown>)['rules'];
  if (!Array.isArray(rules) || rules.length > APPROVAL_AUTHORITY_MAX_RULES) return undefined;
  const out: ApprovalAuthorityRule[] = [];
  const seen = new Set<string>();
  for (const item of rules as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (
        key !== 'capabilityPrefix' &&
        key !== 'separationOfDuties' &&
        key !== 'requiredApproverRoleId' &&
        key !== 'ttlMinutes'
      ) {
        return undefined;
      }
    }
    const prefix = record['capabilityPrefix'];
    if (typeof prefix !== 'string' || !POLICY_ID_LIKE.test(prefix) || seen.has(prefix)) {
      return undefined;
    }
    seen.add(prefix);
    const rule: ApprovalAuthorityRule = { capabilityPrefix: prefix };
    const sod = record['separationOfDuties'];
    if (sod !== undefined) {
      if (typeof sod !== 'boolean') return undefined;
      rule.separationOfDuties = sod;
    }
    const role = record['requiredApproverRoleId'];
    if (role !== undefined) {
      if (typeof role !== 'string' || !POLICY_ID_LIKE.test(role)) return undefined;
      rule.requiredApproverRoleId = role;
    }
    const ttl = record['ttlMinutes'];
    if (ttl !== undefined) {
      if (
        typeof ttl !== 'number' ||
        !Number.isInteger(ttl) ||
        ttl < APPROVAL_TTL_MIN_MINUTES ||
        ttl > APPROVAL_TTL_MAX_MINUTES
      ) {
        return undefined;
      }
      rule.ttlMinutes = ttl;
    }
    out.push(rule);
  }
  return { rules: out };
}

/** What resolving the approval authority for a request concluded. */
export type ApprovalAuthorityResolution =
  | { state: 'none' }
  | { state: 'invalid'; policyVersion: string }
  | { state: 'applies'; requirement: ApprovalRequirementSpec };

/**
 * Resolves which approval governance (if any) applies to the request's
 * capability: an ENABLED POLICY_APPROVAL_AUTHORITY configuration whose
 * longest matching `capabilityPrefix` wins. Pure; reads only trusted facts.
 * A matching rule with no effective requirement still "applies" (separation
 * of duties defaults to false) so its configuration version is recorded.
 */
export function resolveApprovalAuthority(request: PolicyRequest): ApprovalAuthorityResolution {
  const entry = request.facts.configs[POLICY_IDS.APPROVAL_AUTHORITY];
  if (entry === undefined || entry.enabled === false) return { state: 'none' };
  const policyVersion = `${APPROVAL_AUTHORITY_RULE_VERSION}+config.${entry.version}`;
  const config = parseApprovalAuthorityConfig(entry.config);
  if (config === undefined) return { state: 'invalid', policyVersion };
  let best: ApprovalAuthorityRule | undefined;
  for (const rule of config.rules) {
    if (
      request.capabilityId.startsWith(rule.capabilityPrefix) &&
      (best === undefined || rule.capabilityPrefix.length > best.capabilityPrefix.length)
    ) {
      best = rule;
    }
  }
  if (best === undefined) return { state: 'none' };
  return {
    state: 'applies',
    requirement: {
      separationOfDuties: best.separationOfDuties === true,
      ...(best.requiredApproverRoleId === undefined
        ? {}
        : { requiredApproverRoleId: best.requiredApproverRoleId }),
      ...(best.ttlMinutes === undefined ? {} : { ttlMinutes: best.ttlMinutes }),
      policyId: POLICY_IDS.APPROVAL_AUTHORITY,
      policyVersion,
    },
  };
}
