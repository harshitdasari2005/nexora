/**
 * @nexora/module-policy — the deterministic policy engine (Prompt 5).
 *
 * RBAC and agent delegation decide WHO may perform a capability; policy
 * decides UNDER WHAT CONDITIONS; approval decides whether an authorized
 * human must say yes to this exact action. See
 * `platform/ai-runtime/docs/TRUST_MODEL.md` §9.
 */

export * from './contracts.js';
export * from './engine.js';
export * from './ids.js';
export * from './registry.js';
export * from './config-validation.js';
export {
  APPROVAL_AUTHORITY_MAX_RULES,
  APPROVAL_AUTHORITY_RULE_VERSION,
  APPROVAL_TTL_MAX_MINUTES,
  APPROVAL_TTL_MIN_MINUTES,
  POLICY_ID_LIKE,
  parseApprovalAuthorityConfig,
  resolveApprovalAuthority,
  type ApprovalAuthorityConfig,
  type ApprovalAuthorityResolution,
  type ApprovalAuthorityRule,
} from './rules/approval-authority.js';
export { sideEffectRequiresApproval, sideEffectApprovalRule } from './rules/side-effect.js';
export {
  DIRECT_HIRE_CAPABILITIES,
  hiringChannelRule,
  parseHiringChannelConfig,
  type HiringChannelConfig,
} from './rules/hiring.js';
export {
  SUBMIT_EXPENSE_CAPABILITY,
  financeBudgetLimitRule,
  financeBudgetStateRule,
  financeExpenseApprovalRule,
  parseBudgetLimitConfig,
  type BudgetLimitConfig,
} from './rules/finance.js';
