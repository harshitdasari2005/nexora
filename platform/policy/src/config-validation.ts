/**
 * Policy configuration is DATA, never code. This is the strict allow-list
 * validator every write path must pass before a configuration is persisted:
 * exact keys, exact types, enums / id-like strings, bounded size and depth,
 * and no string (key or value) with executable-looking content. Rejection
 * messages name the JSON path and the rule broken — never the offending value.
 */

import { POLICY_IDS } from './ids.js';
import {
  APPROVAL_AUTHORITY_MAX_RULES,
  APPROVAL_TTL_MAX_MINUTES,
  APPROVAL_TTL_MIN_MINUTES,
  POLICY_ID_LIKE,
  type ApprovalAuthorityConfig,
  type ApprovalAuthorityRule,
} from './rules/approval-authority.js';
import { parseBudgetLimitConfig, type BudgetLimitConfig } from './rules/finance.js';

/** The result of validating a configuration. */
export type PolicyConfigValidation<T = unknown> =
  { ok: true; value: T } | { ok: false; errors: readonly string[] };

/** Serialized-size cap for any configuration (bytes of canonical JSON). */
export const POLICY_CONFIG_MAX_BYTES = 8192;
/** Nesting cap (root object = depth 1). */
export const POLICY_CONFIG_MAX_DEPTH = 4;

/** Policy ids whose configuration may be written, mapped to their value types. */
export interface ConfigurablePolicyValues {
  POLICY_FINANCE_BUDGET_LIMIT: BudgetLimitConfig;
  POLICY_APPROVAL_AUTHORITY: ApprovalAuthorityConfig;
}

const EXECUTABLE_PATTERNS: readonly RegExp[] = [
  /\$\{/,
  /\{\{/,
  /`/,
  /<\s*script/i,
  /;/,
  /--/,
  /\$\(/,
  /[\r\n]/,
];

/** Whether a string looks executable / injectable (template, shell, SQL comment, markup). */
export function looksExecutable(value: string): boolean {
  return EXECUTABLE_PATTERNS.some((pattern) => pattern.test(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Structural guards shared by every policy: depth, size, plain data, no executable strings. */
function structuralErrors(config: unknown): string[] {
  const errors: string[] = [];
  const walk = (value: unknown, path: string, depth: number): void => {
    if (errors.length >= 20) return;
    if (depth > POLICY_CONFIG_MAX_DEPTH) {
      errors.push(`${path}: nesting is deeper than ${POLICY_CONFIG_MAX_DEPTH}`);
      return;
    }
    if (typeof value === 'string') {
      if (looksExecutable(value)) errors.push(`${path}: contains executable-looking content`);
      return;
    }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) errors.push(`${path}: must be a finite number`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (looksExecutable(key) || key === '__proto__') {
          errors.push(`${path}: contains a key with executable-looking content`);
          continue;
        }
        walk(child, `${path}.${key}`, depth + 1);
      }
      return;
    }
    errors.push(`${path}: unsupported value type`);
  };
  walk(config, '$', 1);
  if (errors.length === 0) {
    try {
      if (JSON.stringify(config).length > POLICY_CONFIG_MAX_BYTES) {
        errors.push(`$: exceeds ${POLICY_CONFIG_MAX_BYTES} bytes`);
      }
    } catch {
      errors.push('$: is not serializable');
    }
  }
  return errors;
}

function validateBudgetLimit(config: unknown): PolicyConfigValidation<BudgetLimitConfig> {
  const errors: string[] = [];
  if (!isPlainObject(config)) return { ok: false, errors: ['$: must be an object'] };
  const keys = Object.keys(config);
  if (keys.some((key) => key !== 'mode')) errors.push('$: contains an unknown key');
  const parsed = parseBudgetLimitConfig(config);
  if (parsed === undefined) errors.push('$.mode: must be "deny" or "require_approval"');
  return errors.length > 0 || parsed === undefined
    ? { ok: false, errors }
    : { ok: true, value: parsed };
}

function validateApprovalAuthority(
  config: unknown,
): PolicyConfigValidation<ApprovalAuthorityConfig> {
  const errors: string[] = [];
  if (!isPlainObject(config)) return { ok: false, errors: ['$: must be an object'] };
  if (Object.keys(config).some((key) => key !== 'rules')) errors.push('$: contains an unknown key');
  const rules = config['rules'];
  if (!Array.isArray(rules)) {
    errors.push('$.rules: must be an array');
    return { ok: false, errors };
  }
  if (rules.length > APPROVAL_AUTHORITY_MAX_RULES) {
    errors.push(`$.rules: at most ${APPROVAL_AUTHORITY_MAX_RULES} rules`);
  }
  const seen = new Set<string>();
  const out: ApprovalAuthorityRule[] = [];
  (rules as unknown[]).forEach((item, index) => {
    const path = `$.rules[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (
        key !== 'capabilityPrefix' &&
        key !== 'separationOfDuties' &&
        key !== 'requiredApproverRoleId' &&
        key !== 'ttlMinutes'
      ) {
        errors.push(`${path}: contains an unknown key`);
      }
    }
    const rule: Partial<ApprovalAuthorityRule> = {};
    const prefix = item['capabilityPrefix'];
    if (typeof prefix !== 'string' || !POLICY_ID_LIKE.test(prefix)) {
      errors.push(
        `${path}.capabilityPrefix: must be an id-like string (^[a-z][a-z0-9_.:-]{0,79}$)`,
      );
    } else if (seen.has(prefix)) {
      errors.push(`${path}.capabilityPrefix: duplicate prefix`);
    } else {
      seen.add(prefix);
      rule.capabilityPrefix = prefix;
    }
    const sod = item['separationOfDuties'];
    if (sod !== undefined) {
      if (typeof sod !== 'boolean') errors.push(`${path}.separationOfDuties: must be a boolean`);
      else rule.separationOfDuties = sod;
    }
    const role = item['requiredApproverRoleId'];
    if (role !== undefined) {
      if (typeof role !== 'string' || !POLICY_ID_LIKE.test(role)) {
        errors.push(`${path}.requiredApproverRoleId: must be an id-like string`);
      } else rule.requiredApproverRoleId = role;
    }
    const ttl = item['ttlMinutes'];
    if (ttl !== undefined) {
      if (
        typeof ttl !== 'number' ||
        !Number.isInteger(ttl) ||
        ttl < APPROVAL_TTL_MIN_MINUTES ||
        ttl > APPROVAL_TTL_MAX_MINUTES
      ) {
        errors.push(
          `${path}.ttlMinutes: must be an integer between ${APPROVAL_TTL_MIN_MINUTES} and ${APPROVAL_TTL_MAX_MINUTES}`,
        );
      } else rule.ttlMinutes = ttl;
    }
    if (rule.capabilityPrefix !== undefined) out.push(rule as ApprovalAuthorityRule);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { rules: out } };
}

/**
 * Validates a configuration for a policy id (STRICT allow-list). Unknown
 * policies and non-configurable policies are rejected. On success `value` is
 * the normalized configuration to persist (only allow-listed keys).
 */
export function validatePolicyConfig(
  policyId: string,
  config: unknown,
): PolicyConfigValidation<ConfigurablePolicyValues[keyof ConfigurablePolicyValues]> {
  if (policyId !== POLICY_IDS.FINANCE_BUDGET_LIMIT && policyId !== POLICY_IDS.APPROVAL_AUTHORITY) {
    return { ok: false, errors: ['policy is not configurable'] };
  }
  const structural = structuralErrors(config);
  if (structural.length > 0) return { ok: false, errors: structural };
  return policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT
    ? validateBudgetLimit(config)
    : validateApprovalAuthority(config);
}
