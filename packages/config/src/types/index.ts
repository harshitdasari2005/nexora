/**
 * @nexora/config — core types.
 *
 * The shared vocabulary of the configuration framework: config values, keys,
 * and sources. Everything else in the package builds on these types.
 */

/**
 * A configuration value. Configuration is intentionally limited to
 * JSON-compatible primitives and homogeneous arrays — no nested objects,
 * no functions (BKD.md §11, configuration over customization).
 */
export type ConfigValue = string | number | boolean | readonly string[] | readonly number[];

/**
 * A dot-notation configuration key path, e.g. `app.port` or
 * `hr.approval.timeoutMs`. Branded so raw strings cannot be used as keys
 * without intent.
 */
export type ConfigKey = string & { readonly __configKey: unique symbol };

/**
 * Upcasts a dot-notation string to a {@link ConfigKey}. Use at schema
 * declaration sites and when reading a key from external input that is
 * already known to be declared. No runtime validation is performed — the
 * schema (and {@link ConfigManager} typed getters) is the validation gate.
 */
export function key(value: string): ConfigKey {
  return value as ConfigKey;
}

/**
 * The source (layer) a configuration value came from. Precedence is low to
 * high (BKD.md §11.2): defaults → global → company → workspace → plugin →
 * AI → environment → runtime override.
 */
export const CONFIG_SOURCES = [
  'default',
  'global',
  'company',
  'workspace',
  'plugin',
  'ai',
  'environment',
  'runtime',
] as const;

/** Single configuration source literal. */
export type ConfigSource = (typeof CONFIG_SOURCES)[number];

/** The declared kind of a configuration value, used for validation. */
export type ConfigValueKind = 'string' | 'number' | 'boolean' | 'string_array' | 'number_array';

/**
 * A resolved configuration entry: the value plus where it came from.
 * Used by the manager for observability and change events.
 */
export interface ResolvedConfigEntry {
  /** The configuration key. */
  key: ConfigKey;
  /** The resolved value. */
  value: ConfigValue;
  /** The highest-precedence source that supplied the value. */
  source: ConfigSource;
}

/**
 * A change to a configuration value at runtime.
 */
export interface ConfigChange {
  /** The configuration key that changed. */
  key: ConfigKey;
  /** Value before the change (absent when the key was unset). */
  previousValue?: ConfigValue;
  /** Value after the change (absent when the key was unset). */
  nextValue?: ConfigValue;
  /** The source the value moved from (absent when the key was unset). */
  previousSource?: ConfigSource;
  /** The source the value moved to (absent when the key was unset). */
  nextSource?: ConfigSource;
}
