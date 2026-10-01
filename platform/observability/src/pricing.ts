import type { ModelCall } from './contracts.js';

/** Trusted, versioned per-model pricing. Absent by default: cost is then `null`, never invented. */
export interface ModelPricing {
  /** The pricing table version, recorded on every priced call. */
  version: string;
  currency: string;
  /** Keyed `provider/model`. Prices are per 1,000 tokens. */
  models: Readonly<Record<string, { promptPer1k: number; completionPer1k: number }>>;
}

/**
 * Parses pricing from configuration JSON. Returns `undefined` for absent or
 * invalid input — a broken price table must never silently produce numbers.
 */
export function parsePricing(raw: string | undefined): ModelPricing | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ModelPricing>;
    if (
      typeof parsed.version !== 'string' ||
      typeof parsed.currency !== 'string' ||
      typeof parsed.models !== 'object' ||
      parsed.models === null
    ) {
      return undefined;
    }
    for (const entry of Object.values(parsed.models)) {
      if (
        typeof entry?.promptPer1k !== 'number' ||
        typeof entry.completionPer1k !== 'number' ||
        entry.promptPer1k < 0 ||
        entry.completionPer1k < 0
      ) {
        return undefined;
      }
    }
    return { version: parsed.version, currency: parsed.currency, models: parsed.models };
  } catch {
    return undefined;
  }
}

/** The cost of one call, or `null` unless usage was REPORTED and a price is configured. */
export function estimateCost(
  call: Pick<
    ModelCall,
    'provider' | 'model' | 'usageAvailable' | 'promptTokens' | 'completionTokens'
  >,
  pricing: ModelPricing | undefined,
): { cost: number; currency: string; pricingVersion: string } | null {
  if (
    pricing === undefined ||
    !call.usageAvailable ||
    call.model === undefined ||
    call.promptTokens === undefined ||
    call.completionTokens === undefined
  ) {
    return null;
  }
  const price = pricing.models[`${call.provider}/${call.model}`];
  if (price === undefined) {
    return null;
  }
  const cost =
    (call.promptTokens / 1000) * price.promptPer1k +
    (call.completionTokens / 1000) * price.completionPer1k;
  return {
    cost: Math.round(cost * 1e8) / 1e8,
    currency: pricing.currency,
    pricingVersion: pricing.version,
  };
}
