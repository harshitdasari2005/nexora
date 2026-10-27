/**
 * POLICY_HIRING_CHANNEL: an organization that hires through hiring requests
 * turns it on, and a direct hire is then denied — only a direct hire, only for
 * that organization's configuration, and a broken configuration fails closed.
 */

import { describe, expect, it } from 'vitest';

import {
  DIRECT_HIRE_CAPABILITIES,
  POLICY_IDS,
  PolicyEngine,
  getPolicyRegistryEntry,
  parseHiringChannelConfig,
  validatePolicyConfig,
  type PolicyConfigEntry,
  type PolicyRequest,
} from '../src/index.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const engine = new PolicyEngine(undefined, () => NOW);
const ID = POLICY_IDS.HIRING_CHANNEL;

function hire(
  capabilityId: string,
  entry?: PolicyConfigEntry,
  overrides: Partial<PolicyRequest> = {},
): PolicyRequest {
  return {
    organizationId: 'org-a',
    workspaceId: 'ws-a',
    actor: { userId: 'user-1' },
    capabilityId,
    toolId: capabilityId,
    action: 'tool.execute',
    sideEffectClass: 'consequential',
    autonomyTier: 'supervised',
    origin: 'chat',
    input: { employeeName: 'Sarah Thomas' },
    facts: { configs: entry === undefined ? {} : { [ID]: entry } },
    ...overrides,
  };
}
const ON: PolicyConfigEntry = { version: 2, config: { directHire: 'deny' } };

describe('POLICY_HIRING_CHANNEL', () => {
  it('names the two ways of hiring without a hiring request', () => {
    expect([...DIRECT_HIRE_CAPABILITIES].sort()).toEqual([
      'hr.create_employee',
      'workflow.hire_and_assign_employee',
    ]);
  });

  it('does not apply to an organization that has not turned it on', () => {
    for (const capability of DIRECT_HIRE_CAPABILITIES) {
      const decision = engine.evaluate(hire(capability));
      expect(decision.outcome).toBe('REQUIRE_APPROVAL');
      expect(decision.matchedRules.some((rule) => rule.policyId === ID)).toBe(false);
    }
  });

  it('denies every direct hire once the organization turned it on, saying what to do instead', () => {
    for (const capability of DIRECT_HIRE_CAPABILITIES) {
      const decision = engine.evaluate(hire(capability, ON));
      expect(decision.outcome).toBe('DENY');
      expect(decision.policyId).toBe(ID);
      expect(decision.reasonCode).toBe('HIRING_REQUEST_REQUIRED');
      expect(decision.reason).toContain('hiring request');
      expect(decision.version).toBe('1+config.2');
    }
  });

  it('denies it for agents and workflow steps as well as chat', () => {
    for (const origin of ['chat', 'agent', 'mcp', 'workflow']) {
      expect(engine.evaluate(hire('hr.create_employee', ON, { origin })).outcome).toBe('DENY');
    }
  });

  it('leaves every other capability alone', () => {
    for (const capability of [
      'hr.find_employee',
      'hr.revoke_hire',
      'projects.assign_employee',
      'workflow.create_project_and_assign_employee',
    ]) {
      const decision = engine.evaluate(hire(capability, ON));
      expect(decision.matchedRules.some((rule) => rule.policyId === ID)).toBe(false);
      expect(decision.outcome).not.toBe('DENY');
    }
  });

  it('does not apply while disabled', () => {
    const decision = engine.evaluate(hire('hr.create_employee', { ...ON, enabled: false }));
    expect(decision.outcome).toBe('REQUIRE_APPROVAL');
  });

  it('fails closed on a configuration it cannot understand', () => {
    for (const config of [{}, { directHire: 'allow' }, 'deny', null]) {
      const decision = engine.evaluate(hire('hr.create_employee', { version: 1, config }));
      expect(decision.outcome).toBe('DENY');
      expect(decision.reasonCode).toBe('POLICY_CONFIGURATION_INVALID');
    }
  });

  it('is an organization-configurable policy with one strict setting', () => {
    expect(getPolicyRegistryEntry(ID)).toMatchObject({
      configurable: true,
      managedBy: 'organization',
      layer: 'engine',
    });
    expect(validatePolicyConfig(ID, { directHire: 'deny' })).toEqual({
      ok: true,
      value: { directHire: 'deny' },
    });
    for (const config of [
      { directHire: 'allow' },
      { directHire: 'deny', extra: true },
      {},
      [],
      'deny',
    ]) {
      expect(validatePolicyConfig(ID, config).ok).toBe(false);
    }
    expect(parseHiringChannelConfig({ directHire: 'deny' })).toEqual({ directHire: 'deny' });
    expect(parseHiringChannelConfig({ directHire: 'require_approval' })).toBeUndefined();
  });
});
