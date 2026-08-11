/**
 * @nexora/config — configuration merging.
 *
 * Merges provider values into a single layered view using the documented
 * precedence (BKD.md §11.2): defaults → global → company → workspace →
 * plugin → AI → environment → runtime override. Higher-precedence layers
 * win; missing values fall through to lower layers and finally to schema
 * defaults.
 */

import { CONFIG_SOURCES, type ConfigSource, type ConfigValue } from '../types/index.js';
import type { ConfigSchemaMap } from '../schema/index.js';

/** Precedence rank: higher wins (index 0 = lowest). */
const SOURCE_RANK: Readonly<Record<ConfigSource, number>> = Object.fromEntries(
  CONFIG_SOURCES.map((source, index) => [source, index]),
) as Readonly<Record<ConfigSource, number>>;

/** A single layer of configuration values with its source. */
export interface ConfigLayer {
  source: ConfigSource;
  values: Readonly<Record<string, ConfigValue>>;
}

/**
 * Collects every schema default into a single value map. Shared by the async
 * and sync loaders so the two paths apply defaults identically.
 */
export function schemaDefaults(schema: ConfigSchemaMap): Readonly<Record<string, ConfigValue>> {
  const defaults: Record<string, ConfigValue> = {};
  for (const definition of Object.values(schema)) {
    if (definition.default !== undefined) {
      defaults[definition.key] = definition.default;
    }
  }
  return defaults;
}

/**
 * Merges layers by precedence, then applies `defaults` for any key still
 * missing. Returns the merged value map plus the winning source per key.
 */
export function mergeLayers(
  layers: readonly ConfigLayer[],
  defaults: Readonly<Record<string, ConfigValue>>,
): Readonly<Record<string, ConfigValue>> {
  const sorted = [...layers].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  const merged: Record<string, ConfigValue> = { ...defaults };
  for (const layer of sorted) {
    for (const [key, value] of Object.entries(layer.values)) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Resolves the winning source for every key across the layers (for
 * observability: which layer actually supplied each value).
 */
export function resolveSources(
  layers: readonly ConfigLayer[],
): Readonly<Record<string, ConfigSource>> {
  const sorted = [...layers].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  const sources: Record<string, ConfigSource> = {};
  for (const layer of sorted) {
    for (const key of Object.keys(layer.values)) {
      sources[key] = layer.source;
    }
  }
  return sources;
}

/** Compares two values for equality (primitive or homogeneous array). */
export function configValuesEqual(a: ConfigValue, b: ConfigValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}
