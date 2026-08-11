/**
 * @nexora/config — configuration providers.
 *
 * Providers supply raw configuration values from a source. The manager
 * merges providers by precedence (BKD.md §11.2): defaults → global →
 * company → workspace → plugin → AI → environment → runtime override.
 * Providers are independent of the schema — validation happens at load.
 */

import { loadEnvValue } from '../environment/index.js';
import type { ConfigSource, ConfigValue, ConfigValueKind } from '../types/index.js';

/** A provider of configuration values. */
export interface ConfigProvider {
  /** The configuration source this provider represents. */
  readonly source: ConfigSource;
  /**
   * Returns the provider's values. May throw for genuinely unrecoverable
   * provider failures; the manager catches and degrades to an empty set.
   */
  load(): Readonly<Record<string, ConfigValue>> | Promise<Readonly<Record<string, ConfigValue>>>;
}

/** Static values supplied by a provider (e.g. a parsed config file). */
export interface StaticValues {
  [key: string]: ConfigValue;
}

/**
 * A provider backed by a static record of values.
 *
 * @example
 * ```ts
 * const company = staticProvider('company', { 'hr.approval.required': true });
 * ```
 */
export function staticProvider(source: ConfigSource, values: StaticValues): ConfigProvider {
  return { source, load: () => values };
}

/**
 * A provider backed by the process environment. Values are parsed according
 * to `kinds` (a map of env var name → config value kind). The `prefix` is
 * stripped from env var names to produce config keys: e.g. prefix `NEXORA_`,
 * env `NEXORA_APP_PORT` → key `app.port` when `app.port` is listed in kinds.
 *
 * @param kinds - map of config key → kind, and optionally the env var name
 *   override; by default the env var name is `prefix + key.toUpperCase().replaceAll('.', '_')`.
 */
export function environmentProvider(
  env: NodeJS.ProcessEnv,
  prefix: string,
  kinds: Readonly<Record<string, ConfigValueKind>>,
): ConfigProvider {
  return {
    source: 'environment',
    load: () => {
      const values: Record<string, ConfigValue> = {};
      for (const [key, kind] of Object.entries(kinds)) {
        const envName = `${prefix}${key.toUpperCase().replaceAll('.', '_')}`;
        const parsed = loadEnvValue(env, envName, kind);
        if (parsed !== undefined && parsed !== null) {
          values[key] = parsed;
        }
      }
      return values;
    },
  };
}

/** A provider backed by a synchronous function returning values. */
export function functionProvider(
  source: ConfigSource,
  load: () => Readonly<Record<string, ConfigValue>>,
): ConfigProvider {
  return { source, load };
}
