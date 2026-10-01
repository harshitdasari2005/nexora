import { describe, expect, it } from 'vitest';
import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';
import {
  DEFAULT_POLICY_RULES,
  POLICY_IDS,
  PolicyEngine,
  SUBMIT_EXPENSE_CAPABILITY,
  fingerprintOf,
  policyIdForReason,
  policyUnavailableDecision,
  sideEffectRequiresApproval,
  type BudgetFact,
  type PolicyOutcome,
  type PolicyRequest,
  type PolicyRule,
  type Resolvable,
  type RuleVerdict,
} from '../src/index.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function request(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    organizationId: 'org-a',
    workspaceId: 'ws-a',
    actor: { userId: 'user-1' },
    capabilityId: 'projects.create',
    toolId: 'tool.projects.create',
    action: 'tool.execute',
    sideEffectClass: 'read_only',
    autonomyTier: 'supervised',
    origin: 'chat',
    input: {},
    facts: { configs: {} },
    ...overrides,
  };
}

function rule(id: string, outcome: PolicyOutcome | 'skip', version = '1'): PolicyRule {
  return {
    id,
    version,
    evaluate(): RuleVerdict | undefined {
      if (outcome === 'skip') return undefined;
      return { outcome, reasonCode: `${id}_${outcome}`, reason: `${id} says ${outcome}` };
    },
  };
}

function engineOf(rules: readonly PolicyRule[]): PolicyEngine {
  return new PolicyEngine(rules, () => NOW);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const engine = new PolicyEngine(DEFAULT_POLICY_RULES, () => NOW);

function budget(overrides: Partial<BudgetFact> = {}): Resolvable<BudgetFact> {
  return {
    state: 'resolved',
    value: {
      status: 'active',
      allocatedMinorUnits: 100_000,
      spentMinorUnits: 40_000,
      currency: 'INR',
      ...overrides,
    },
  };
}

function expense(overrides: Partial<PolicyRequest> = {}, amount: unknown = 10_000): PolicyRequest {
  return request({
    capabilityId: SUBMIT_EXPENSE_CAPABILITY,
    toolId: 'tool.finance.submit_expense',
    sideEffectClass: 'consequential',
    input: { amountMinorUnits: amount, currency: 'INR', budgetId: 'b-1' },
    facts: { budget: budget(), configs: {} },
    ...overrides,
  });
}

function withLimit(
  config: unknown,
  version = 3,
  extra: Partial<PolicyRequest> = {},
): PolicyRequest {
  const base = expense(extra);
  return {
    ...base,
    facts: {
      ...base.facts,
      configs: { [POLICY_IDS.FINANCE_BUDGET_LIMIT]: { version, config } },
    },
  };
}

describe('precedence and determinism', () => {
  it('DENY beats REQUIRE_APPROVAL beats ALLOW', () => {
    expect(
      engineOf([rule('A', 'ALLOW'), rule('B', 'REQUIRE_APPROVAL')]).evaluate(request()).outcome,
    ).toBe('REQUIRE_APPROVAL');
    expect(
      engineOf([rule('A', 'ALLOW'), rule('B', 'REQUIRE_APPROVAL'), rule('C', 'DENY')]).evaluate(
        request(),
      ).outcome,
    ).toBe('DENY');
    // positive control: without the DENY rule the same set is not a DENY
    expect(
      engineOf([rule('A', 'ALLOW'), rule('B', 'REQUIRE_APPROVAL')]).evaluate(request()).outcome,
    ).not.toBe('DENY');
    expect(engineOf([rule('A', 'ALLOW')]).evaluate(request()).outcome).toBe('ALLOW');
  });

  it('is deterministic: same request gives the same decision and fingerprint', () => {
    const req = expense();
    const first = engine.evaluate(req);
    const second = engine.evaluate(req);
    expect(second).toEqual(first);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toBe(fingerprintOf(first.outcome, first.matchedRules));
  });

  it('shuffling registration order never changes the decision (INVARIANT 11)', () => {
    const rules = [
      rule('R_D', 'DENY'),
      rule('R_A', 'ALLOW'),
      rule('R_Q1', 'REQUIRE_APPROVAL'),
      rule('R_Q2', 'REQUIRE_APPROVAL'),
      rule('R_S', 'skip'),
    ];
    const reference = engineOf(rules).evaluate(request());
    for (const order of permutations(rules)) {
      const decision = engineOf(order).evaluate(request());
      expect(decision).toEqual(reference);
    }
    expect(reference.outcome).toBe('DENY');
  });

  it('default rules give the same decision in every registration order', () => {
    const scenarios: Record<string, PolicyRequest> = {
      underReviewRequireApproval: withLimit({ mode: 'require_approval' }, 2, {
        facts: { budget: budget({ status: 'under_review' }), configs: {} },
      }),
      closedWithLimit: withLimit({ mode: 'deny' }, 2, {
        facts: { budget: budget({ status: 'closed' }), configs: {} },
      }),
      overrunDeny: withLimit({ mode: 'deny' }, 2, {
        input: { amountMinorUnits: 90_000, currency: 'INR' },
      }),
      invalidConfig: withLimit({ mode: 'nope' }, 2),
      plain: request({ sideEffectClass: 'state_change' }),
    };
    for (const [name, req] of Object.entries(scenarios)) {
      const reference = engineOf(DEFAULT_POLICY_RULES).evaluate(req);
      expect(reference.matchedRules.length, name).toBeGreaterThan(0);
      for (const order of permutations(DEFAULT_POLICY_RULES)) {
        expect(engineOf(order).evaluate(req), name).toEqual(reference);
      }
    }
    // the scenarios really do differ (the loop is not comparing four identical decisions)
    const outcomes = new Set(
      Object.values(scenarios).map((r) => engineOf(DEFAULT_POLICY_RULES).evaluate(r).outcome),
    );
    expect(outcomes).toEqual(new Set(['DENY', 'REQUIRE_APPROVAL']));
  });

  it('the engine copies its rule list (mutating the array after construction changes nothing)', () => {
    const rules: PolicyRule[] = [rule('A', 'ALLOW')];
    const e = engineOf(rules);
    rules.push(rule('B', 'DENY'));
    expect(e.evaluate(request()).outcome).toBe('ALLOW');
    expect(engineOf(rules).evaluate(request()).outcome).toBe('DENY');
  });

  it('ties between equal outcomes are broken by policy id ascending', () => {
    const decision = engineOf([
      rule('Z_RULE', 'DENY'),
      rule('B_RULE', 'DENY'),
      rule('M_RULE', 'DENY'),
    ]).evaluate(request());
    expect(decision.policyId).toBe('B_RULE');
    expect(decision.reasonCode).toBe('B_RULE_DENY');
    // positive control: a lower id with a weaker outcome does not win
    const weaker = engineOf([rule('A_RULE', 'ALLOW'), rule('Z_RULE', 'DENY')]).evaluate(request());
    expect(weaker.policyId).toBe('Z_RULE');
  });

  it('matchedRules lists every verdict, most restrictive first, then by id; skipped rules absent', () => {
    const decision = engineOf([
      rule('C', 'ALLOW'),
      rule('A', 'REQUIRE_APPROVAL'),
      rule('D', 'DENY'),
      rule('B', 'DENY'),
      rule('E', 'skip'),
    ]).evaluate(request());
    expect(decision.matchedRules.map((m) => `${m.policyId}=${m.outcome}`)).toEqual([
      'B=DENY',
      'D=DENY',
      'A=REQUIRE_APPROVAL',
      'C=ALLOW',
    ]);
    expect(decision.fingerprint).toBe('DENY|B@1=DENY,D@1=DENY,A@1=REQUIRE_APPROVAL,C@1=ALLOW');
  });

  it('fingerprint changes when a rule version changes, and outcome sets approvalRequirement', () => {
    const v1 = engineOf([rule('A', 'REQUIRE_APPROVAL', '1')]).evaluate(request());
    const v2 = engineOf([rule('A', 'REQUIRE_APPROVAL', '2')]).evaluate(request());
    expect(v1.fingerprint).not.toBe(v2.fingerprint);
    expect(v1.approvalRequirement).toEqual({ type: 'human' });
    expect(engineOf([rule('A', 'ALLOW')]).evaluate(request()).approvalRequirement).toBeUndefined();
    expect(engineOf([rule('A', 'DENY')]).evaluate(request()).approvalRequirement).toBeUndefined();
  });

  it('evaluatedAt comes from the injected clock and is not part of the fingerprint', () => {
    const a = new PolicyEngine(
      [rule('A', 'ALLOW')],
      () => new Date('2026-01-01T00:00:00.000Z'),
    ).evaluate(request());
    const b = new PolicyEngine(
      [rule('A', 'ALLOW')],
      () => new Date('2030-06-06T00:00:00.000Z'),
    ).evaluate(request());
    expect(a.evaluatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(b.evaluatedAt).not.toBe(a.evaluatedAt);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('describe() reports registered rules sorted by id', () => {
    expect(engineOf([rule('B', 'ALLOW', '2'), rule('A', 'ALLOW', '1')]).describe()).toEqual([
      { policyId: 'A', version: '1' },
      { policyId: 'B', version: '2' },
    ]);
  });
});

describe('fail closed', () => {
  it('a throwing rule yields DENY POLICY_EVALUATION_FAILED (with ALLOW control)', () => {
    const thrower: PolicyRule = {
      id: 'THROWS',
      version: '1',
      evaluate() {
        throw new Error('boom');
      },
    };
    const denied = engineOf([rule('A', 'ALLOW'), thrower]).evaluate(request());
    expect(denied.outcome).toBe('DENY');
    expect(denied.policyId).toBe('THROWS');
    expect(denied.reasonCode).toBe('POLICY_EVALUATION_FAILED');
    expect(denied.reason).not.toContain('boom');
    expect(engineOf([rule('A', 'ALLOW')]).evaluate(request()).outcome).toBe('ALLOW');
  });

  it('a rule throwing a non-Error value also fails closed and other verdicts stay reported', () => {
    const thrower: PolicyRule = {
      id: 'THROWS_STRING',
      version: '1',
      evaluate() {
        throw 'secret-detail';
      },
    };
    const decision = engineOf([rule('A', 'ALLOW'), thrower]).evaluate(request());
    expect(decision.outcome).toBe('DENY');
    expect(decision.reasonCode).toBe('POLICY_EVALUATION_FAILED');
    expect(JSON.stringify(decision)).not.toContain('secret-detail');
    expect(decision.matchedRules.map((m) => `${m.policyId}=${m.outcome}`)).toEqual([
      'THROWS_STRING=DENY',
      'A=ALLOW',
    ]);
  });

  it('a throwing rule is deterministic regardless of order', () => {
    const thrower: PolicyRule = {
      id: 'THROWS',
      version: '1',
      evaluate() {
        throw new Error('boom');
      },
    };
    const a = engineOf([thrower, rule('A', 'ALLOW')]).evaluate(request());
    const b = engineOf([rule('A', 'ALLOW'), thrower]).evaluate(request());
    expect(a).toEqual(b);
  });

  it('an empty rule set yields DENY POLICY_MISSING', () => {
    const decision = engineOf([]).evaluate(request());
    expect(decision.outcome).toBe('DENY');
    expect(decision.reasonCode).toBe('POLICY_MISSING');
    expect(decision.policyId).toBe(POLICY_IDS.ENGINE);
  });

  it('rules that all skip yield DENY POLICY_MISSING (control: one applicable rule allows)', () => {
    expect(engineOf([rule('S', 'skip')]).evaluate(request()).reasonCode).toBe('POLICY_MISSING');
    expect(engineOf([rule('S', 'skip'), rule('A', 'ALLOW')]).evaluate(request()).outcome).toBe(
      'ALLOW',
    );
  });

  it.each([
    ['organizationId', { organizationId: '' }],
    ['actor.userId', { actor: { userId: '' } }],
    ['capabilityId', { capabilityId: '' }],
  ] as const)('an empty %s yields DENY POLICY_CONTEXT_INCOMPLETE', (_name, override) => {
    const permissive = engineOf([rule('A', 'ALLOW')]);
    const decision = permissive.evaluate(request(override));
    expect(decision.outcome).toBe('DENY');
    expect(decision.reasonCode).toBe('POLICY_CONTEXT_INCOMPLETE');
    // positive control: the same engine allows the complete request
    expect(permissive.evaluate(request()).outcome).toBe('ALLOW');
  });

  it('workspaceId is optional context (control for the incomplete-context denials)', () => {
    const permissive = engineOf([rule('A', 'ALLOW')]);
    const withoutWorkspace: PolicyRequest = { ...request() };
    delete withoutWorkspace.workspaceId;
    expect(permissive.evaluate(withoutWorkspace).outcome).toBe('ALLOW');
  });

  it('an incomplete request is denied even when the only rule would ALLOW and never reaches rules', () => {
    let called = false;
    const spy: PolicyRule = {
      id: 'SPY',
      version: '1',
      evaluate() {
        called = true;
        return { outcome: 'ALLOW', reasonCode: 'X', reason: 'x' };
      },
    };
    const e = engineOf([spy]);
    expect(e.evaluate(request({ organizationId: '' })).reasonCode).toBe(
      'POLICY_CONTEXT_INCOMPLETE',
    );
    expect(called).toBe(false);
    expect(e.evaluate(request()).outcome).toBe('ALLOW');
    expect(called).toBe(true);
  });

  it('rejects duplicate rule ids', () => {
    expect(() => new PolicyEngine([rule('A', 'ALLOW'), rule('A', 'DENY')])).toThrow(
      /Duplicate policy rule id A/,
    );
    expect(() => new PolicyEngine([rule('A', 'ALLOW'), rule('B', 'DENY')])).not.toThrow();
  });

  it('policyUnavailableDecision is a DENY', () => {
    const decision = policyUnavailableDecision(NOW);
    expect(decision.outcome).toBe('DENY');
    expect(decision.policyId).toBe(POLICY_IDS.ENGINE);
    expect(decision.reasonCode).toBe('POLICY_MISSING');
    expect(decision.evaluatedAt).toBe(NOW.toISOString());
    expect(decision.matchedRules).toHaveLength(1);
    expect(decision.fingerprint).toBe('DENY|POLICY_ENGINE@1=DENY');
    expect(decision.approvalRequirement).toBeUndefined();
  });
});

describe('default rules: side-effect table', () => {
  const classes: SideEffectClass[] = ['read_only', 'state_change', 'consequential'];
  const tiers: AutonomyTier[] = ['human_only', 'supervised', 'autonomous'];
  // The pre-engine evaluateSideEffect table.
  const legacy = (c: SideEffectClass, t: AutonomyTier): boolean =>
    c === 'read_only' ? false : c === 'consequential' ? true : t !== 'autonomous';

  for (const c of classes) {
    for (const t of tiers) {
      it(`${c} x ${t}`, () => {
        const expected = legacy(c, t);
        expect(sideEffectRequiresApproval(c, t)).toBe(expected);
        const decision = engine.evaluate(request({ sideEffectClass: c, autonomyTier: t }));
        expect(decision.outcome).toBe(expected ? 'REQUIRE_APPROVAL' : 'ALLOW');
        expect(decision.policyId).toBe(POLICY_IDS.SIDE_EFFECT_APPROVAL);
        expect(decision.reasonCode).toBe(
          c === 'read_only'
            ? 'READ_ONLY'
            : c === 'consequential'
              ? 'CONSEQUENTIAL_ACTION'
              : expected
                ? 'STATE_CHANGE_UNDER_TIER'
                : 'STATE_CHANGE_AUTONOMOUS',
        );
        expect(decision.matchedRules).toHaveLength(1);
      });
    }
  }

  it('read_only never needs approval, consequential always, state_change unless autonomous', () => {
    for (const t of tiers) {
      expect(sideEffectRequiresApproval('read_only', t)).toBe(false);
      expect(sideEffectRequiresApproval('consequential', t)).toBe(true);
    }
    expect(sideEffectRequiresApproval('state_change', 'autonomous')).toBe(false);
    expect(sideEffectRequiresApproval('state_change', 'supervised')).toBe(true);
    expect(sideEffectRequiresApproval('state_change', 'human_only')).toBe(true);
  });

  it('carries approvalRequirement only when approval is required', () => {
    expect(
      engine.evaluate(request({ sideEffectClass: 'state_change' })).approvalRequirement,
    ).toEqual({ type: 'human' });
    expect(
      engine.evaluate(request({ sideEffectClass: 'state_change', autonomyTier: 'autonomous' }))
        .approvalRequirement,
    ).toBeUndefined();
  });
});

describe('default rules: finance', () => {
  it('finance rules do not apply to other capabilities', () => {
    const other = request({
      capabilityId: 'projects.create',
      sideEffectClass: 'state_change',
      autonomyTier: 'autonomous',
      input: { amountMinorUnits: 10, currency: 'INR' },
      facts: {
        budget: budget({ status: 'closed' }),
        configs: { [POLICY_IDS.FINANCE_BUDGET_LIMIT]: { version: 1, config: { mode: 'deny' } } },
      },
    });
    const decision = engine.evaluate(other);
    expect(decision.outcome).toBe('ALLOW');
    expect(decision.matchedRules.map((m) => m.policyId)).toEqual([POLICY_IDS.SIDE_EFFECT_APPROVAL]);
    // control: the same facts on the expense capability are refused
    expect(engine.evaluate({ ...other, capabilityId: SUBMIT_EXPENSE_CAPABILITY }).outcome).toBe(
      'DENY',
    );
  });

  it('expense submission always requires approval, even autonomous and within budget', () => {
    const decision = engine.evaluate(
      expense({ autonomyTier: 'autonomous', sideEffectClass: 'state_change' }),
    );
    expect(decision.outcome).toBe('REQUIRE_APPROVAL');
    expect(decision.matchedRules.map((m) => m.policyId)).toContain(
      POLICY_IDS.FINANCE_EXPENSE_APPROVAL,
    );
    expect(
      decision.matchedRules.find((m) => m.policyId === POLICY_IDS.FINANCE_EXPENSE_APPROVAL)
        ?.reasonCode,
    ).toBe('MONEY_MOVEMENT');
  });

  it('closed budget => DENY BUDGET_CLOSED (control: active budget is not denied)', () => {
    const closed = engine.evaluate(
      expense({ facts: { budget: budget({ status: 'closed' }), configs: {} } }),
    );
    expect(closed.outcome).toBe('DENY');
    expect(closed.policyId).toBe(POLICY_IDS.FINANCE_BUDGET_STATE);
    expect(closed.reasonCode).toBe('BUDGET_CLOSED');
    expect(closed.constraints).toEqual({ budgetStatus: 'closed' });
    expect(engine.evaluate(expense()).outcome).toBe('REQUIRE_APPROVAL');
  });

  it('under_review budget => REQUIRE_APPROVAL BUDGET_UNDER_REVIEW', () => {
    const decision = engine.evaluate(
      expense({ facts: { budget: budget({ status: 'under_review' }), configs: {} } }),
    );
    expect(decision.outcome).toBe('REQUIRE_APPROVAL');
    expect(
      decision.matchedRules.find((m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_STATE)?.reasonCode,
    ).toBe('BUDGET_UNDER_REVIEW');
    // active budget contributes no budget-state verdict
    expect(
      engine
        .evaluate(expense())
        .matchedRules.some((m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_STATE),
    ).toBe(false);
  });

  it('unresolvable or missing budget => DENY BUDGET_UNRESOLVABLE', () => {
    const unresolvable = engine.evaluate(
      expense({ facts: { budget: { state: 'unresolvable' }, configs: {} } }),
    );
    expect(unresolvable.outcome).toBe('DENY');
    expect(unresolvable.reasonCode).toBe('BUDGET_UNRESOLVABLE');
    const missing = engine.evaluate(expense({ facts: { configs: {} } }));
    expect(missing.outcome).toBe('DENY');
    expect(missing.reasonCode).toBe('BUDGET_UNRESOLVABLE');
    expect(engine.evaluate(expense()).outcome).not.toBe('DENY');
  });

  it('budget limit does not apply without configuration', () => {
    const decision = engine.evaluate(
      expense({ facts: { budget: budget({ spentMinorUnits: 99_999 }), configs: {} } }),
    );
    expect(decision.outcome).toBe('REQUIRE_APPROVAL');
    expect(decision.matchedRules.some((m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT)).toBe(
      false,
    );
  });

  it('without limit configuration an unusable amount is not denied by the limit rule', () => {
    const noConfig = engine.evaluate(expense({}, undefined));
    expect(noConfig.outcome).toBe('REQUIRE_APPROVAL');
    expect(noConfig.matchedRules.some((m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT)).toBe(
      false,
    );
    // control: the same request with the limit configured is denied
    const configured = withLimit({ mode: 'deny' }, 1, {
      input: { currency: 'INR', budgetId: 'b-1' },
    });
    expect(engine.evaluate(configured).outcome).toBe('DENY');
  });

  it('overrun boundary: projected == allocation is within, +1 is an overrun', () => {
    const at = engine.evaluate(
      withLimit({ mode: 'deny' }, 1, { input: { amountMinorUnits: 60_000, currency: 'INR' } }),
    );
    const over = engine.evaluate(
      withLimit({ mode: 'deny' }, 1, { input: { amountMinorUnits: 60_001, currency: 'INR' } }),
    );
    expect(at.outcome).not.toBe('DENY');
    expect(over.outcome).toBe('DENY');
  });

  it('overrun in deny mode => DENY BUDGET_OVERRUN; within budget => ALLOW verdict (control)', () => {
    const over = engine.evaluate(
      withLimit({ mode: 'deny' }, 3, { input: { amountMinorUnits: 60_001, currency: 'INR' } }),
    );
    expect(over.outcome).toBe('DENY');
    expect(over.policyId).toBe(POLICY_IDS.FINANCE_BUDGET_LIMIT);
    expect(over.reasonCode).toBe('BUDGET_OVERRUN');
    expect(over.constraints).toEqual({
      allocatedMinorUnits: 100_000,
      projectedMinorUnits: 100_001,
      mode: 'deny',
    });
    const within = engine.evaluate(
      withLimit({ mode: 'deny' }, 3, { input: { amountMinorUnits: 60_000, currency: 'INR' } }),
    );
    const verdict = within.matchedRules.find((m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT);
    expect(verdict?.outcome).toBe('ALLOW');
    expect(verdict?.reasonCode).toBe('WITHIN_BUDGET');
    // still needs approval from the always-approval rule, but never denied
    expect(within.outcome).toBe('REQUIRE_APPROVAL');
  });

  it('overrun in require_approval mode => REQUIRE_APPROVAL', () => {
    const decision = engine.evaluate(
      withLimit({ mode: 'require_approval' }, 4, {
        input: { amountMinorUnits: 90_000, currency: 'INR' },
      }),
    );
    expect(decision.outcome).toBe('REQUIRE_APPROVAL');
    const verdict = decision.matchedRules.find(
      (m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT,
    );
    expect(verdict?.outcome).toBe('REQUIRE_APPROVAL');
    expect(verdict?.reasonCode).toBe('BUDGET_OVERRUN');
  });

  it('currency mismatch => DENY (case-insensitive match is fine)', () => {
    const mismatch = engine.evaluate(
      withLimit({ mode: 'require_approval' }, 1, {
        input: { amountMinorUnits: 10, currency: 'USD' },
      }),
    );
    expect(mismatch.outcome).toBe('DENY');
    expect(mismatch.reasonCode).toBe('CURRENCY_MISMATCH');
    const sameCase = engine.evaluate(
      withLimit({ mode: 'require_approval' }, 1, {
        input: { amountMinorUnits: 10, currency: 'inr' },
      }),
    );
    expect(sameCase.outcome).toBe('REQUIRE_APPROVAL');
    const missingCurrency = engine.evaluate(
      withLimit({ mode: 'deny' }, 1, { input: { amountMinorUnits: 10 } }),
    );
    expect(missingCurrency.reasonCode).toBe('CURRENCY_MISMATCH');
  });

  it.each([
    ['null', null],
    ['string', 'deny'],
    ['number', 5],
    ['array', []],
    ['empty object', {}],
    ['wrong mode', { mode: 'allow' }],
    ['non-string mode', { mode: 1 }],
  ])('invalid config (%s) => DENY POLICY_CONFIGURATION_INVALID', (_n, config) => {
    const decision = engine.evaluate(withLimit(config));
    expect(decision.outcome).toBe('DENY');
    expect(decision.policyId).toBe(POLICY_IDS.FINANCE_BUDGET_LIMIT);
    expect(decision.reasonCode).toBe('POLICY_CONFIGURATION_INVALID');
    // control: a valid config on the same request does not deny
    expect(engine.evaluate(withLimit({ mode: 'deny' })).outcome).not.toBe('DENY');
  });

  it.each([
    ['undefined', undefined],
    ['zero', 0],
    ['negative', -5],
    ['fractional', 1.5],
    ['string', '100'],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])(
    'unusable amount (%s) with a limit configured => DENY POLICY_CONTEXT_INCOMPLETE',
    (_n, amount) => {
      const req = withLimit({ mode: 'require_approval' });
      const decision = engine.evaluate({
        ...req,
        input: { amountMinorUnits: amount, currency: 'INR' },
      });
      expect(decision.outcome).toBe('DENY');
      expect(decision.reasonCode).toBe('POLICY_CONTEXT_INCOMPLETE');
      expect(engine.evaluate(withLimit({ mode: 'require_approval' })).outcome).toBe(
        'REQUIRE_APPROVAL',
      );
    },
  );

  it('limit configured with unresolvable or missing budget => limit rule itself denies', () => {
    const base = withLimit({ mode: 'require_approval' });
    const variants: Record<string, PolicyRequest> = {
      unresolvable: { ...base, facts: { ...base.facts, budget: { state: 'unresolvable' } } },
      missing: { ...base, facts: { configs: base.facts.configs } },
    };
    for (const [name, req] of Object.entries(variants)) {
      const decision = engine.evaluate(req);
      expect(decision.outcome, name).toBe('DENY');
      const limit = decision.matchedRules.find(
        (m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT,
      );
      expect(limit?.outcome, name).toBe('DENY');
      expect(limit?.reasonCode, name).toBe('POLICY_CONTEXT_INCOMPLETE');
    }
    // control: with a resolved budget the limit rule does not deny
    const ok = engine
      .evaluate(base)
      .matchedRules.find((m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT);
    expect(ok?.outcome).toBe('ALLOW');
  });

  it('version strings include the config version', () => {
    const three = engine.evaluate(withLimit({ mode: 'deny' }, 3));
    const seven = engine.evaluate(withLimit({ mode: 'deny' }, 7));
    const find = (d: typeof three) =>
      d.matchedRules.find((m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT);
    expect(find(three)?.version).toBe('1+config.3');
    expect(find(seven)?.version).toBe('1+config.7');
    expect(three.fingerprint).not.toBe(seven.fingerprint);
    expect(three.fingerprint).toContain('POLICY_FINANCE_BUDGET_LIMIT@1+config.3=');
    const invalid = engine.evaluate(withLimit({ mode: 'x' }, 9));
    expect(invalid.version).toBe('1+config.9');
    // the other rules keep their code version
    expect(
      three.matchedRules.find((m) => m.policyId === POLICY_IDS.FINANCE_EXPENSE_APPROVAL)?.version,
    ).toBe('1');
    // without configuration no config-suffixed version appears
    expect(
      engine.evaluate(expense()).matchedRules.every((m) => !m.version.includes('+config.')),
    ).toBe(true);
  });
});

describe('purity and invariants', () => {
  it('never mutates its input (deep-frozen request evaluates cleanly)', () => {
    const req = deepFreeze(withLimit({ mode: 'deny' }, 2));
    const snapshot = JSON.stringify(req);
    expect(() => engine.evaluate(req)).not.toThrow();
    expect(JSON.stringify(req)).toBe(snapshot);
    expect(engine.evaluate(req).matchedRules.length).toBeGreaterThan(1);
  });

  it('decisions do not alias mutable request state', () => {
    const req = withLimit({ mode: 'deny' }, 2);
    const decision = engine.evaluate(req);
    const before = JSON.stringify(decision);
    (req.input as Record<string, unknown>)['amountMinorUnits'] = 1;
    (req.facts.configs as Record<string, unknown>)[POLICY_IDS.FINANCE_BUDGET_LIMIT] = {
      version: 99,
      config: { mode: 'x' },
    };
    expect(JSON.stringify(decision)).toBe(before);
    // control: re-evaluating the mutated request does give a different decision
    expect(JSON.stringify(engine.evaluate(req))).not.toBe(before);
  });

  it("an ALLOW from one rule never turns another rule's DENY into ALLOW (INVARIANT 1/15)", () => {
    const denied = engineOf([
      rule('A_ALLOW', 'ALLOW'),
      rule('B_ALLOW', 'ALLOW'),
      rule('Z_DENY', 'DENY'),
    ]).evaluate(request());
    expect(denied.outcome).toBe('DENY');
    expect(denied.matchedRules[0]?.policyId).toBe('Z_DENY');
    // control: same allow rules alone are allowed
    expect(
      engineOf([rule('A_ALLOW', 'ALLOW'), rule('B_ALLOW', 'ALLOW')]).evaluate(request()).outcome,
    ).toBe('ALLOW');
    // real rules: WITHIN_BUDGET ALLOW does not lift a closed budget DENY
    const closedButFits = engine.evaluate(
      withLimit({ mode: 'deny' }, 1, {
        facts: { budget: budget({ status: 'closed' }), configs: {} },
      }),
    );
    expect(closedButFits.outcome).toBe('DENY');
  });

  it('the request and decision carry no field that could grant authority', () => {
    const decision = engine.evaluate(request());
    const keys = Object.keys(decision).sort();
    expect(keys).toEqual(
      [
        'evaluatedAt',
        'fingerprint',
        'matchedRules',
        'outcome',
        'policyId',
        'reason',
        'reasonCode',
        'version',
      ].sort(),
    );
    const forbidden = /capabilit|permission|grant|role|scope|delegat/i;
    expect(keys.filter((k) => forbidden.test(k))).toEqual([]);
    // an ALLOW decision cannot substitute for a missing capability: the engine has no capability
    // grant input, and a request for a capability that no rule handles still fails closed when
    // nothing applies.
    expect(
      engineOf([rule('S', 'skip')]).evaluate(request({ capabilityId: 'admin.everything' })).outcome,
    ).toBe('DENY');
    // injected authority-looking operands are inert data for the default rules
    const injected = request({ input: { permissions: ['*'], approved: true, outcome: 'ALLOW' } });
    expect(engine.evaluate(injected)).toEqual(engine.evaluate(request({ input: {} })));
  });

  it('facts of tenant A never affect a request for tenant B', () => {
    const tenantA = withLimit({ mode: 'deny' }, 5, {
      organizationId: 'org-a',
      input: { amountMinorUnits: 90_000, currency: 'INR' },
    });
    const tenantB = expense({
      organizationId: 'org-b',
      input: { amountMinorUnits: 90_000, currency: 'INR' },
    });
    const bAlone = engine.evaluate(tenantB);
    const aDecision = engine.evaluate(tenantA);
    expect(aDecision.outcome).toBe('DENY');
    // evaluating A first leaves B's decision untouched (no cross-request state)
    expect(engine.evaluate(tenantB)).toEqual(bAlone);
    expect(bAlone.outcome).toBe('REQUIRE_APPROVAL');
    expect(bAlone.matchedRules.some((m) => m.policyId === POLICY_IDS.FINANCE_BUDGET_LIMIT)).toBe(
      false,
    );
    // control: giving B the same config produces the same DENY
    const bWithConfig = withLimit({ mode: 'deny' }, 5, {
      organizationId: 'org-b',
      input: { amountMinorUnits: 90_000, currency: 'INR' },
    });
    expect(engine.evaluate(bWithConfig).outcome).toBe('DENY');
  });
});

describe('policyIdForReason', () => {
  const documented: Record<string, string> = {
    DELEGATION_RESOURCE_OUT_OF_SCOPE: POLICY_IDS.AGENT_DELEGATION_SCOPE,
    DELEGATION_EXPIRED: POLICY_IDS.AGENT_DELEGATION_EXPIRY,
    DELEGATION_REVOKED: POLICY_IDS.AGENT_DELEGATION_EXPIRY,
    DELEGATION_MISSING: POLICY_IDS.AGENT_DELEGATION_REQUIRED,
    CAPABILITY_OUTSIDE_DELEGATION: POLICY_IDS.AGENT_DELEGATION_REQUIRED,
    DELEGATION_GRANTOR_LACKS_CAPABILITY: POLICY_IDS.AGENT_DELEGATION_REQUIRED,
    DELEGATION_EXCEEDS_USER_AUTHORITY: POLICY_IDS.AGENT_DELEGATION_REQUIRED,
    INITIATOR_LACKS_CAPABILITY: POLICY_IDS.AGENT_DELEGATION_REQUIRED,
    CAPABILITY_OUTSIDE_AGENT_DEFINITION: POLICY_IDS.AGENT_DELEGATION_REQUIRED,
    AGENT_NOT_FOUND: POLICY_IDS.AGENT_IDENTITY,
    AGENT_SUSPENDED: POLICY_IDS.AGENT_IDENTITY,
    AGENT_REVOKED: POLICY_IDS.AGENT_IDENTITY,
    FORGED_AGENT_CONTEXT: POLICY_IDS.AGENT_IDENTITY,
    AGENT_AUTHORITY_UNAVAILABLE: POLICY_IDS.AGENT_IDENTITY,
    AGENT_OUT_OF_SCOPE: POLICY_IDS.WORKSPACE_SCOPE,
    CAPABILITY_NOT_DELEGABLE: POLICY_IDS.AGENT_NON_DELEGABLE,
    AGENT_TO_AGENT_NOT_SUPPORTED: POLICY_IDS.AGENT_NON_DELEGABLE,
    APPROVAL_DECISION_NOT_PERMITTED: POLICY_IDS.APPROVAL_SEPARATION,
    APPROVAL_ARGUMENTS_MISMATCH: POLICY_IDS.APPROVAL_SEPARATION,
    AGENT_APPROVAL_MISMATCH: POLICY_IDS.APPROVAL_SEPARATION,
    RESERVED_ARGUMENT: POLICY_IDS.ARGUMENT_TRUST,
    ARGUMENT_TOO_DEEP: POLICY_IDS.ARGUMENT_TRUST,
    APPROVAL_NOT_BOUND: POLICY_IDS.APPROVAL_SEPARATION,
  };

  for (const [code, policyId] of Object.entries(documented)) {
    it(`maps ${code} to ${policyId}`, () => {
      expect(policyIdForReason(code)).toBe(policyId);
      expect(policyId.startsWith('POLICY_')).toBe(true);
    });
  }

  it('returns undefined for unknown codes', () => {
    for (const code of ['', 'NOPE', 'delegation_expired', 'POLICY_MISSING', 'BUDGET_CLOSED']) {
      expect(policyIdForReason(code)).toBeUndefined();
    }
  });

  it('every POLICY_IDS value carries the POLICY_ prefix', () => {
    for (const id of Object.values(POLICY_IDS)) expect(id.startsWith('POLICY_')).toBe(true);
  });
});
