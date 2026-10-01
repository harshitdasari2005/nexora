import { describe, expect, it } from 'vitest';
import { estimateCost, parsePricing, type ModelPricing } from '../src/index.js';

const pricing: ModelPricing = {
  version: 'p-2026-01',
  currency: 'USD',
  models: { 'groq/llama': { promptPer1k: 0.5, completionPer1k: 1.5 } },
};
const call = {
  provider: 'groq',
  model: 'llama',
  usageAvailable: true,
  promptTokens: 2000,
  completionTokens: 1000,
};

describe('parsePricing', () => {
  it('returns undefined for absent, empty or invalid JSON', () => {
    expect(parsePricing(undefined)).toBeUndefined();
    expect(parsePricing('')).toBeUndefined();
    expect(parsePricing('   ')).toBeUndefined();
    expect(parsePricing('{not json')).toBeUndefined();
    expect(parsePricing('null')).toBeUndefined();
  });
  it('rejects wrong shapes and negative or non-numeric prices', () => {
    expect(parsePricing('{"currency":"USD","models":{}}')).toBeUndefined();
    expect(parsePricing('{"version":"v","models":{}}')).toBeUndefined();
    expect(parsePricing('{"version":"v","currency":"USD"}')).toBeUndefined();
    expect(parsePricing('{"version":"v","currency":"USD","models":null}')).toBeUndefined();
    const bad = (m: string): string => `{"version":"v","currency":"USD","models":{"a/b":${m}}}`;
    expect(parsePricing(bad('{"promptPer1k":-1,"completionPer1k":1}'))).toBeUndefined();
    expect(parsePricing(bad('{"promptPer1k":1,"completionPer1k":-1}'))).toBeUndefined();
    expect(parsePricing(bad('{"promptPer1k":"1","completionPer1k":1}'))).toBeUndefined();
    expect(parsePricing(bad('{"promptPer1k":1}'))).toBeUndefined();
    expect(parsePricing(bad('null'))).toBeUndefined();
  });
  it('parses a valid table', () => {
    expect(parsePricing(JSON.stringify(pricing))).toEqual(pricing);
  });
});

describe('estimateCost', () => {
  it('computes per-1k arithmetic and echoes version/currency', () => {
    expect(estimateCost(call, pricing)).toEqual({
      cost: 2.5,
      currency: 'USD',
      pricingVersion: 'p-2026-01',
    });
    expect(estimateCost({ ...call, promptTokens: 500, completionTokens: 0 }, pricing)?.cost).toBe(
      0.25,
    );
  });
  it('is null without pricing', () => {
    expect(estimateCost(call, undefined)).toBeNull();
  });
  it('is null unless usage was reported', () => {
    expect(estimateCost({ ...call, usageAvailable: false }, pricing)).toBeNull();
    const noPrompt: Record<string, unknown> = { ...call };
    delete noPrompt.promptTokens;
    expect(estimateCost(noPrompt as typeof call, pricing)).toBeNull();
    const noCompletion: Record<string, unknown> = { ...call };
    delete noCompletion.completionTokens;
    expect(estimateCost(noCompletion as typeof call, pricing)).toBeNull();
  });
  it('is null when the model is unknown or unpriced', () => {
    const noModel: Record<string, unknown> = { ...call };
    delete noModel.model;
    expect(estimateCost(noModel as typeof call, pricing)).toBeNull();
    expect(estimateCost({ ...call, model: 'other' }, pricing)).toBeNull();
    expect(estimateCost({ ...call, provider: 'ollama' }, pricing)).toBeNull();
  });
});
