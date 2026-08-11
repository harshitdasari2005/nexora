/**
 * @nexora/ai-runtime — verification tests.
 */

import { describe, expect, it } from 'vitest';

import { DefaultExecutionVerifier } from '../src/verification/execution-verifier.js';
import { clampConfidence } from '../src/verification/verification-result.js';
import {
  evaluateSafety,
  type SafetyCheck,
  type SafetyCheckInput,
} from '../src/verification/safety-check.js';

describe('DefaultExecutionVerifier', () => {
  const verifier = new DefaultExecutionVerifier();

  it('verifies a successful result', async () => {
    const result = await verifier.verify({ ok: true, output: { id: 1 } });
    expect(result.verified).toBe(true);
    expect(result.confidence).toBe(1);
  });

  it('fails an unsuccessful result', async () => {
    const result = await verifier.verify({ ok: false, error: { code: 'X', message: 'x' } });
    expect(result.verified).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('runs extra rules deny-wins', async () => {
    const result = await verifier.verify({ ok: true, output: { id: 1 } }, [
      {
        id: 'has-id',
        description: 'output has id',
        check: (r) => (r.output as { id?: number }).id !== undefined,
      },
    ]);
    expect(result.verified).toBe(true);
  });

  it('reports a failing extra rule with detail', async () => {
    const result = await verifier.verify({ ok: true, output: {} }, [
      {
        id: 'has-id',
        description: 'output has id',
        check: (r) => (r.output as { id?: number }).id !== undefined,
      },
    ]);
    expect(result.verified).toBe(false);
    expect(result.checks.find((c) => c.ruleId === 'has-id')?.passed).toBe(false);
  });

  it('supports async rules', async () => {
    const result = await verifier.verify({ ok: true, output: { verified: true } }, [
      {
        id: 'async',
        description: 'async check',
        check: async (r) => (r.output as { verified?: boolean }).verified === true,
      },
    ]);
    expect(result.verified).toBe(true);
  });

  it('composes constructor rules with per-call rules', async () => {
    const withBase = new DefaultExecutionVerifier([
      { id: 'base', description: 'base', check: () => true },
    ]);
    const result = await withBase.verify({ ok: true }, [
      { id: 'extra', description: 'extra', check: () => false },
    ]);
    expect(result.verified).toBe(false);
    expect(result.checks.length).toBe(3); // success + base + extra
  });
});

describe('clampConfidence', () => {
  it('clamps below zero and above one', () => {
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence(2)).toBe(1);
  });

  it('passes through valid values', () => {
    expect(clampConfidence(0.5)).toBe(0.5);
    expect(clampConfidence(0)).toBe(0);
    expect(clampConfidence(1)).toBe(1);
  });

  it('maps NaN to zero', () => {
    expect(clampConfidence(Number.NaN)).toBe(0);
  });
});

describe('evaluateSafety', () => {
  const input: SafetyCheckInput = {
    toolId: 't1',
    input: {},
    sideEffectClass: 'state_change',
    tenantId: 't',
  };

  const blockCheck: SafetyCheck = {
    id: 'blocker',
    description: 'blocks',
    evaluate: () => ({ checkId: 'blocker', safe: false, reason: 'blocked by test' }),
  };
  const passCheck: SafetyCheck = {
    id: 'passer',
    description: 'passes',
    evaluate: () => ({ checkId: 'passer', safe: true }),
  };

  it('allows when every check passes', async () => {
    const outcome = await evaluateSafety([passCheck], input);
    expect(outcome.safe).toBe(true);
  });

  it('blocks deny-wins when any check fails', async () => {
    const outcome = await evaluateSafety([passCheck, blockCheck], input);
    expect(outcome.safe).toBe(false);
    expect(outcome.results.find((r) => r.checkId === 'blocker')?.reason).toBe('blocked by test');
  });

  it('handles async checks', async () => {
    const asyncCheck: SafetyCheck = {
      id: 'async',
      description: 'async',
      evaluate: async () => ({ checkId: 'async', safe: true }),
    };
    const outcome = await evaluateSafety([asyncCheck], input);
    expect(outcome.safe).toBe(true);
  });
});
