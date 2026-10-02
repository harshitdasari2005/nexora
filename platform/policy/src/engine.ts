import type {
  MatchedRule,
  PolicyDecision,
  PolicyOutcome,
  PolicyRequest,
  PolicyRule,
  RuleVerdict,
} from './contracts.js';
import { POLICY_IDS } from './ids.js';
import { resolveApprovalAuthority } from './rules/approval-authority.js';
import {
  financeBudgetLimitRule,
  financeBudgetStateRule,
  financeExpenseApprovalRule,
} from './rules/finance.js';
import { hiringChannelRule } from './rules/hiring.js';
import { sideEffectApprovalRule } from './rules/side-effect.js';

/** Restrictiveness order: a higher number wins. */
const SEVERITY: Readonly<Record<PolicyOutcome, number>> = {
  ALLOW: 0,
  REQUIRE_APPROVAL: 1,
  DENY: 2,
};

/** The rules every Nexora deployment runs, in no significant order (see precedence). */
export const DEFAULT_POLICY_RULES: readonly PolicyRule[] = [
  sideEffectApprovalRule,
  financeExpenseApprovalRule,
  financeBudgetStateRule,
  financeBudgetLimitRule,
  hiringChannelRule,
];

/** A verdict together with the rule that produced it. */
interface Matched extends MatchedRule {
  reason: string;
  constraints?: RuleVerdict['constraints'];
}

/**
 * The deterministic policy engine.
 *
 * Precedence (documented, and independent of registration or iteration
 * order): DENY beats REQUIRE_APPROVAL beats ALLOW; among verdicts of the
 * same outcome, the lexicographically smallest policy id decides. Every
 * matched rule is reported, sorted the same way, so two engines built from
 * the same rules in any order return the same decision.
 *
 * It fails closed: a rule that throws yields DENY (`POLICY_EVALUATION_FAILED`),
 * an incomplete request yields DENY (`POLICY_CONTEXT_INCOMPLETE`), and a
 * request no rule applies to yields DENY (`POLICY_MISSING`). It is pure — no
 * I/O, no clock other than the injected one, and it never mutates state.
 */
export class PolicyEngine {
  readonly #rules: readonly PolicyRule[];
  readonly #now: () => Date;

  constructor(
    rules: readonly PolicyRule[] = DEFAULT_POLICY_RULES,
    now: () => Date = () => new Date(),
  ) {
    const seen = new Set<string>();
    for (const rule of rules) {
      if (seen.has(rule.id)) {
        throw new Error(`Duplicate policy rule id ${rule.id}`);
      }
      seen.add(rule.id);
    }
    this.#rules = [...rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.#now = now;
  }

  /** The ids and versions of the registered rules (sorted). */
  describe(): readonly { policyId: string; version: string }[] {
    return this.#rules.map((rule) => ({ policyId: rule.id, version: rule.version }));
  }

  evaluate(request: PolicyRequest): PolicyDecision {
    const evaluatedAt = this.#now().toISOString();
    if (
      request.organizationId.length === 0 ||
      request.actor.userId.length === 0 ||
      request.capabilityId.length === 0
    ) {
      return this.#failure(
        'POLICY_CONTEXT_INCOMPLETE',
        'The request is missing trusted context needed for policy evaluation',
        evaluatedAt,
      );
    }
    const matched: Matched[] = [];
    for (const rule of this.#rules) {
      let verdict: RuleVerdict | undefined;
      try {
        verdict = rule.evaluate(request);
      } catch {
        matched.push({
          policyId: rule.id,
          version: rule.version,
          outcome: 'DENY',
          reasonCode: 'POLICY_EVALUATION_FAILED',
          reason: 'A policy rule failed to evaluate; failing closed',
        });
        continue;
      }
      if (verdict !== undefined) {
        matched.push({
          policyId: rule.id,
          version: verdict.version ?? rule.version,
          outcome: verdict.outcome,
          reasonCode: verdict.reasonCode,
          reason: verdict.reason,
          ...(verdict.constraints === undefined ? {} : { constraints: verdict.constraints }),
        });
      }
    }
    // Approval governance (tighten-only): an invalid enabled configuration
    // fails closed for anything that could need approval; a matching one is
    // attached below, ONLY when the decision is REQUIRE_APPROVAL.
    const authority =
      request.sideEffectClass === 'read_only'
        ? ({ state: 'none' } as const)
        : resolveApprovalAuthority(request);
    if (authority.state === 'invalid') {
      matched.push({
        policyId: POLICY_IDS.APPROVAL_AUTHORITY,
        version: authority.policyVersion,
        outcome: 'DENY',
        reasonCode: 'POLICY_CONFIGURATION_INVALID',
        reason: 'The organization policy configuration is invalid; failing closed',
      });
    }
    if (matched.length === 0) {
      return this.#failure(
        'POLICY_MISSING',
        'No policy applies to this request; failing closed',
        evaluatedAt,
      );
    }
    matched.sort(
      (a, b) =>
        SEVERITY[b.outcome] - SEVERITY[a.outcome] ||
        (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0),
    );
    const decisive = matched[0] as Matched;
    const rules: MatchedRule[] = matched.map(({ policyId, version, outcome, reasonCode }) => ({
      policyId,
      version,
      outcome,
      reasonCode,
    }));
    // The governing configuration version is part of the decision fingerprint
    // (so a changed configuration is POLICY_CHANGED_AFTER_APPROVAL on resume).
    // It is added AFTER the decisive rule is chosen: it never changes the
    // outcome, the deciding rule or the reason.
    const approval =
      decisive.outcome === 'REQUIRE_APPROVAL' && authority.state === 'applies'
        ? authority.requirement
        : undefined;
    if (approval !== undefined) {
      const entry: MatchedRule = {
        policyId: approval.policyId,
        version: approval.policyVersion,
        outcome: 'REQUIRE_APPROVAL',
        reasonCode: 'APPROVAL_AUTHORITY_APPLIED',
      };
      const at = rules.findIndex(
        (rule) =>
          SEVERITY[rule.outcome] < SEVERITY.REQUIRE_APPROVAL ||
          (rule.outcome === 'REQUIRE_APPROVAL' && rule.policyId > entry.policyId),
      );
      rules.splice(at === -1 ? rules.length : at, 0, entry);
    }
    return {
      outcome: decisive.outcome,
      policyId: decisive.policyId,
      version: decisive.version,
      reasonCode: decisive.reasonCode,
      reason: decisive.reason,
      matchedRules: rules,
      ...(decisive.outcome === 'REQUIRE_APPROVAL'
        ? { approvalRequirement: { type: 'human' as const } }
        : {}),
      ...(approval === undefined ? {} : { approval }),
      ...(decisive.constraints === undefined ? {} : { constraints: decisive.constraints }),
      fingerprint: fingerprintOf(decisive.outcome, rules),
      evaluatedAt,
    };
  }

  #failure(reasonCode: string, reason: string, evaluatedAt: string): PolicyDecision {
    const rules: MatchedRule[] = [
      { policyId: POLICY_IDS.ENGINE, version: '1', outcome: 'DENY', reasonCode },
    ];
    return {
      outcome: 'DENY',
      policyId: POLICY_IDS.ENGINE,
      version: '1',
      reasonCode,
      reason,
      matchedRules: rules,
      fingerprint: fingerprintOf('DENY', rules),
      evaluatedAt,
    };
  }
}

/** The stable fingerprint of a decision: outcome plus every matched rule@version=outcome. */
export function fingerprintOf(outcome: PolicyOutcome, rules: readonly MatchedRule[]): string {
  return `${outcome}|${rules.map((rule) => `${rule.policyId}@${rule.version}=${rule.outcome}`).join(',')}`;
}

/**
 * Builds a fail-closed DENY decision for callers whose policy evaluation
 * itself broke (a throwing port, unreachable configuration store).
 */
export function policyUnavailableDecision(now: Date = new Date()): PolicyDecision {
  return new PolicyEngine([], () => now).evaluate({
    organizationId: 'unavailable',
    actor: { userId: 'unavailable' },
    capabilityId: 'unavailable',
    toolId: 'unavailable',
    action: 'policy.unavailable',
    sideEffectClass: 'consequential',
    autonomyTier: 'supervised',
    origin: 'policy',
    input: {},
    facts: { configs: {} },
  });
}
