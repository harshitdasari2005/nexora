import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_RULES,
  POLICY_IDS,
  POLICY_REGISTRY,
  PolicyEngine,
  SUBMIT_EXPENSE_CAPABILITY,
  getPolicyRegistryEntry,
  validatePolicyConfig,
  type PolicyConfigEntry,
  type PolicyRequest,
} from '../src/index.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const engine = new PolicyEngine(DEFAULT_POLICY_RULES, () => NOW);

function request(
  overrides: Partial<PolicyRequest> = {},
  configs: Record<string, PolicyConfigEntry> = {},
): PolicyRequest {
  return {
    organizationId: 'org-a',
    workspaceId: 'ws-a',
    actor: { userId: 'user-1' },
    capabilityId: 'projects.create',
    toolId: 'tool.projects.create',
    action: 'tool.execute',
    sideEffectClass: 'consequential',
    autonomyTier: 'supervised',
    origin: 'chat',
    input: {},
    facts: { configs },
    ...overrides,
  };
}

const authority = (config: unknown, version = 1, enabled?: boolean): PolicyConfigEntry => ({
  version,
  config,
  ...(enabled === undefined ? {} : { enabled }),
});

describe('POLICY_APPROVAL_AUTHORITY', () => {
  const cfg = {
    rules: [
      { capabilityPrefix: 'projects.', separationOfDuties: true, ttlMinutes: 60 },
      {
        capabilityPrefix: 'projects.create',
        separationOfDuties: true,
        requiredApproverRoleId: 'executive.ceo',
        ttlMinutes: 15,
      },
    ],
  };

  it('attaches the requirement of the LONGEST matching prefix on REQUIRE_APPROVAL', () => {
    const d = engine.evaluate(request({}, { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg, 3) }));
    expect(d.outcome).toBe('REQUIRE_APPROVAL');
    expect(d.approval).toEqual({
      separationOfDuties: true,
      requiredApproverRoleId: 'executive.ceo',
      ttlMinutes: 15,
      policyId: 'POLICY_APPROVAL_AUTHORITY',
      policyVersion: '1+config.3',
    });
    // The decisive rule is unchanged; the governing config is in matchedRules.
    expect(d.policyId).toBe(POLICY_IDS.SIDE_EFFECT_APPROVAL);
    expect(d.matchedRules.map((m) => m.policyId)).toContain(POLICY_IDS.APPROVAL_AUTHORITY);
  });

  it('shorter prefix applies when the longer does not match', () => {
    const d = engine.evaluate(
      request(
        { capabilityId: 'projects.archive' },
        { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg) },
      ),
    );
    expect(d.approval?.ttlMinutes).toBe(60);
    expect(d.approval?.requiredApproverRoleId).toBeUndefined();
  });

  it('no config, disabled config, or non-matching capability: no approval requirement', () => {
    expect(engine.evaluate(request()).approval).toBeUndefined();
    expect(
      engine.evaluate(request({}, { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg, 2, false) }))
        .approval,
    ).toBeUndefined();
    expect(
      engine.evaluate(
        request(
          { capabilityId: 'docs.publish' },
          { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg) },
        ),
      ).approval,
    ).toBeUndefined();
  });

  it('changing the configuration version changes the fingerprint; disabling restores the original', () => {
    const base = engine.evaluate(request());
    const v1 = engine.evaluate(request({}, { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg, 1) }));
    const v2 = engine.evaluate(request({}, { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg, 2) }));
    const off = engine.evaluate(
      request({}, { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg, 3, false) }),
    );
    expect(new Set([base.fingerprint, v1.fingerprint, v2.fingerprint]).size).toBe(3);
    expect(off.fingerprint).toBe(base.fingerprint);
    // Deterministic.
    expect(
      engine.evaluate(request({}, { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg, 1) }))
        .fingerprint,
    ).toBe(v1.fingerprint);
  });

  it('never turns ALLOW into anything: read-only and autonomous state changes stay ALLOW without approval', () => {
    const configs = { [POLICY_IDS.APPROVAL_AUTHORITY]: authority(cfg) };
    const ro = engine.evaluate(request({ sideEffectClass: 'read_only' }, configs));
    expect(ro.outcome).toBe('ALLOW');
    expect(ro.approval).toBeUndefined();
    const auto = engine.evaluate(
      request({ sideEffectClass: 'state_change', autonomyTier: 'autonomous' }, configs),
    );
    expect(auto.outcome).toBe('ALLOW');
    expect(auto.approval).toBeUndefined();
    expect(auto.policyId).toBe(POLICY_IDS.SIDE_EFFECT_APPROVAL);
  });

  it('never overrides DENY (closed budget stays DENY, no approval attached)', () => {
    const d = engine.evaluate(
      request(
        {
          capabilityId: SUBMIT_EXPENSE_CAPABILITY,
          input: { amountMinorUnits: 100, currency: 'USD' },
          facts: {
            configs: {
              [POLICY_IDS.APPROVAL_AUTHORITY]: authority({
                rules: [{ capabilityPrefix: 'finance.', separationOfDuties: true }],
              }),
            },
            budget: {
              state: 'resolved',
              value: {
                status: 'closed',
                allocatedMinorUnits: 1000,
                spentMinorUnits: 0,
                currency: 'USD',
              },
            },
          },
        },
        {},
      ),
    );
    expect(d.outcome).toBe('DENY');
    expect(d.approval).toBeUndefined();
    expect(d.reasonCode).toBe('BUDGET_CLOSED');
  });

  it('invalid enabled configuration fails closed for non-read-only, ignored for read-only', () => {
    const bad = { [POLICY_IDS.APPROVAL_AUTHORITY]: authority({ rules: 'nope' }, 4) };
    const d = engine.evaluate(request({}, bad));
    expect(d.outcome).toBe('DENY');
    expect(d.policyId).toBe(POLICY_IDS.APPROVAL_AUTHORITY);
    expect(d.reasonCode).toBe('POLICY_CONFIGURATION_INVALID');
    expect(d.approval).toBeUndefined();
    expect(engine.evaluate(request({ sideEffectClass: 'read_only' }, bad)).outcome).toBe('ALLOW');
    // Disabled invalid config does not apply.
    expect(
      engine.evaluate(
        request({}, { [POLICY_IDS.APPROVAL_AUTHORITY]: authority({ rules: 'nope' }, 4, false) }),
      ).outcome,
    ).toBe('REQUIRE_APPROVAL');
  });

  it('a disabled budget-limit configuration does not apply', () => {
    const facts = {
      budget: {
        state: 'resolved' as const,
        value: {
          status: 'active' as const,
          allocatedMinorUnits: 100,
          spentMinorUnits: 90,
          currency: 'USD',
        },
      },
    };
    const input = { amountMinorUnits: 50, currency: 'USD' };
    const on = engine.evaluate(
      request({
        capabilityId: SUBMIT_EXPENSE_CAPABILITY,
        input,
        facts: {
          ...facts,
          configs: { [POLICY_IDS.FINANCE_BUDGET_LIMIT]: { version: 1, config: { mode: 'deny' } } },
        },
      }),
    );
    expect(on.outcome).toBe('DENY');
    const off = engine.evaluate(
      request({
        capabilityId: SUBMIT_EXPENSE_CAPABILITY,
        input,
        facts: {
          ...facts,
          configs: {
            [POLICY_IDS.FINANCE_BUDGET_LIMIT]: {
              version: 2,
              config: { mode: 'deny' },
              enabled: false,
            },
          },
        },
      }),
    );
    expect(off.outcome).toBe('REQUIRE_APPROVAL');
  });
});

describe('POLICY_REGISTRY', () => {
  it('covers every default rule and the new approval authority policy', () => {
    const ids = POLICY_REGISTRY.map((e) => e.policyId);
    for (const rule of DEFAULT_POLICY_RULES) {
      const entry = getPolicyRegistryEntry(rule.id);
      expect(entry, rule.id).toBeDefined();
      expect(entry?.ruleVersion).toBe(rule.version);
    }
    expect(ids).toContain(POLICY_IDS.APPROVAL_AUTHORITY);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks exactly the two organization-tunable policies configurable', () => {
    const configurable = POLICY_REGISTRY.filter((e) => e.configurable).map((e) => e.policyId);
    expect(configurable.sort()).toEqual([
      'POLICY_APPROVAL_AUTHORITY',
      'POLICY_FINANCE_BUDGET_LIMIT',
    ]);
    for (const entry of POLICY_REGISTRY) {
      expect(entry.managedBy).toBe(entry.configurable ? 'organization' : 'platform');
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

describe('validatePolicyConfig', () => {
  const AA = POLICY_IDS.APPROVAL_AUTHORITY;
  const BL = POLICY_IDS.FINANCE_BUDGET_LIMIT;

  it('accepts valid configurations and returns the normalized value', () => {
    expect(validatePolicyConfig(BL, { mode: 'deny' })).toEqual({
      ok: true,
      value: { mode: 'deny' },
    });
    expect(
      validatePolicyConfig(AA, {
        rules: [
          { capabilityPrefix: 'finance.', separationOfDuties: true, ttlMinutes: 10080 },
          { capabilityPrefix: 'hr.hire', requiredApproverRoleId: 'executive.ceo', ttlMinutes: 1 },
        ],
      }).ok,
    ).toBe(true);
    expect(validatePolicyConfig(AA, { rules: [] })).toEqual({ ok: true, value: { rules: [] } });
  });

  const rule = (over: Record<string, unknown>): unknown => ({
    rules: [{ capabilityPrefix: 'finance.', ...over }],
  });
  const rejections: readonly [string, string, unknown][] = [
    ['unknown policy', 'POLICY_NOPE', {}],
    ['non-configurable policy', POLICY_IDS.SIDE_EFFECT_APPROVAL, {}],
    ['budget: bad mode', BL, { mode: 'allow' }],
    ['budget: unknown key', BL, { mode: 'deny', extra: 1 }],
    ['budget: array', BL, ['deny']],
    ['budget: null', BL, null],
    ['budget: string', BL, 'deny'],
    ['aa: unknown top key', AA, { rules: [], extra: true }],
    ['aa: rules not array', AA, { rules: {} }],
    ['aa: missing rules', AA, {}],
    [
      'aa: 21 rules',
      AA,
      { rules: Array.from({ length: 21 }, (_, i) => ({ capabilityPrefix: `p${i}` })) },
    ],
    ['aa: rule unknown key', AA, rule({ evil: 1 })],
    [
      'aa: __proto__ key',
      AA,
      JSON.parse('{"rules":[{"capabilityPrefix":"a","__proto__":{"x":1}}]}'),
    ],
    ['aa: missing prefix', AA, { rules: [{}] }],
    ['aa: prefix uppercase', AA, rule({ capabilityPrefix: 'Finance.' })],
    ['aa: prefix starts with digit', AA, rule({ capabilityPrefix: '1abc' })],
    ['aa: prefix too long', AA, rule({ capabilityPrefix: 'a'.repeat(81) })],
    ['aa: prefix number', AA, rule({ capabilityPrefix: 5 })],
    ['aa: duplicate prefix', AA, { rules: [{ capabilityPrefix: 'a' }, { capabilityPrefix: 'a' }] }],
    ['aa: sod string', AA, rule({ separationOfDuties: 'yes' })],
    ['aa: ttl 0', AA, rule({ ttlMinutes: 0 })],
    ['aa: ttl 10081', AA, rule({ ttlMinutes: 10081 })],
    ['aa: ttl fractional', AA, rule({ ttlMinutes: 1.5 })],
    ['aa: ttl string', AA, rule({ ttlMinutes: '5' })],
    ['aa: ttl NaN', AA, rule({ ttlMinutes: Number.NaN })],
    ['aa: role uppercase', AA, rule({ requiredApproverRoleId: 'CEO' })],
    ['exec: template ${', AA, rule({ requiredApproverRoleId: '${process.env.X}' })],
    ['exec: {{', AA, rule({ capabilityPrefix: '{{x}}' })],
    ['exec: backtick', AA, rule({ requiredApproverRoleId: '`id`' })],
    ['exec: <script', AA, rule({ requiredApproverRoleId: '<script>alert(1)' })],
    ['exec: semicolon', AA, rule({ requiredApproverRoleId: 'a;drop' })],
    ['exec: sql comment', AA, rule({ requiredApproverRoleId: 'a--b' })],
    ['exec: $(', AA, rule({ requiredApproverRoleId: '$(id)' })],
    ['exec: newline', AA, rule({ requiredApproverRoleId: 'a\nb' })],
    ['exec: in key', BL, { 'mode;x': 'deny' }],
    ['exec: budget mode with content', BL, { mode: 'deny; rm -rf' }],
    ['too deep', AA, { rules: [{ capabilityPrefix: 'a', x: { y: { z: 1 } } }] }],
    [
      'too big',
      AA,
      { rules: [{ capabilityPrefix: 'a', requiredApproverRoleId: 'a'.repeat(9000) }] },
    ],
    ['function value', BL, { mode: () => 'deny' }],
    [
      'class instance',
      BL,
      new (class X {
        mode = 'deny';
      })(),
    ],
  ];
  it.each(rejections)('rejects: %s', (_name, policyId, config) => {
    const result = validatePolicyConfig(policyId, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      // Errors never echo the offending value.
      const joined = result.errors.join('|');
      expect(joined).not.toContain('process.env');
      expect(joined).not.toContain('drop');
      expect(joined).not.toContain('rm -rf');
    }
  });

  it('rejects cyclic structures without throwing', () => {
    const a: Record<string, unknown> = { mode: 'deny' };
    a['self'] = a;
    expect(validatePolicyConfig(BL, a).ok).toBe(false);
  });
});
