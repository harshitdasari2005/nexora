/**
 * @nexora/config — loader.
 *
 * Loads and validates a complete configuration from providers: collects all
 * provider layers, merges them by precedence, applies schema defaults, and
 * validates the result. The loaded, validated payload is what the manager
 * exposes to the platform.
 */

import { mergeLayers, resolveSources, schemaDefaults, type ConfigLayer } from '../merging/index.js';
import { ValidationError } from '@nexora/shared/errors';
import type { ConfigProvider } from '../providers/index.js';
import type { ConfigSchemaMap } from '../schema/index.js';
import { validateConfiguration } from '../validation/index.js';
import type { ConfigSource, ConfigValue } from '../types/index.js';

/** The result of loading a configuration. */
export interface LoadedConfig {
  /** The merged, validated values (defaults applied). */
  values: Readonly<Record<string, ConfigValue>>;
  /** Winning source per key (for observability). */
  sources: Readonly<Record<string, ConfigSource>>;
}

/**
 * Loads a configuration from the given providers.
 *
 * @param schema    - the schema the configuration must satisfy.
 * @param providers - providers in any order; precedence is derived from each
 *   provider's `source`.
 * @param defaults  - extra default values (beyond the schema's own defaults).
 * @throws {Error} when a required key is missing or a value is invalid after
 *   merging; the thrown error carries every field issue.
 */
export async function loadConfiguration(
  schema: ConfigSchemaMap,
  providers: readonly ConfigProvider[],
  defaults: Readonly<Record<string, ConfigValue>> = {},
): Promise<LoadedConfig> {
  const layers: ConfigLayer[] = await collectLayers(providers);

  const values = mergeLayers(layers, { ...schemaDefaults(schema), ...defaults });
  const error = validateConfiguration(schema, values);
  if (error !== null) {
    throw error;
  }
  return { values, sources: resolveSources(layers) };
}

/**
 * Synchronous variant of {@link loadConfiguration} for providers that never
 * reject (static and environment providers). Throws the same validation
 * error on failure.
 */
export function loadConfigurationSync(
  schema: ConfigSchemaMap,
  providers: readonly ConfigProvider[],
  defaults: Readonly<Record<string, ConfigValue>> = {},
): LoadedConfig {
  const layers: ConfigLayer[] = providers.map((provider) => {
    const loaded = provider.load();
    if (loaded instanceof Promise) {
      throw new ValidationError(
        'Synchronous configuration load received an asynchronous provider',
        [
          {
            path: provider.source,
            message: 'Provider must return values synchronously in the sync loader',
          },
        ],
      );
    }
    return { source: provider.source, values: loaded };
  });

  const values = mergeLayers(layers, { ...schemaDefaults(schema), ...defaults });
  const error = validateConfiguration(schema, values);
  if (error !== null) {
    throw error;
  }
  return { values, sources: resolveSources(layers) };
}

/** Loads every provider layer, tolerating provider failures per layer. */
async function collectLayers(providers: readonly ConfigProvider[]): Promise<ConfigLayer[]> {
  const layers: ConfigLayer[] = [];
  for (const provider of providers) {
    try {
      layers.push({ source: provider.source, values: await provider.load() });
    } catch {
      // A failing provider degrades to an empty layer; required keys will
      // surface as validation errors if they were not supplied elsewhere.
      layers.push({ source: provider.source, values: {} });
    }
  }
  return layers;
}
