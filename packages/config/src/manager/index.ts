/**
 * @nexora/config — configuration manager.
 *
 * The typed, read-mostly access point for the platform. Holds the validated
 * configuration, provides typed getters, resolves schema defaults, supports
 * runtime overrides (BKD.md §11.3), and surfaces change events for
 * observability. Runtime overrides are in-memory; persistent settings are
 * the Configuration Platform's job (out of scope here).
 */

import { ValidationError } from '@nexora/shared/errors';

import { FeatureFlags } from '../feature-flags/index.js';
import { loadConfiguration, loadConfigurationSync } from '../loader/index.js';
import { configValuesEqual } from '../merging/index.js';
import type { ConfigProvider } from '../providers/index.js';
import { validateConfigValue, type ConfigSchemaMap } from '../schema/index.js';
import type { Secrets } from '../secrets/index.js';
import type { ConfigChange, ConfigKey, ConfigSource, ConfigValue } from '../types/index.js';

/** A listener notified when a configuration value changes at runtime. */
export type ConfigChangeListener = (change: ConfigChange) => void;

/**
 * The configuration manager.
 *
 * @example
 * ```ts
 * const config = await ConfigManager.create(schema, [
 *   environmentProvider(process.env, 'NEXORA_', kinds),
 * ]);
 * config.getString('app.port'); // typed access with runtime validation
 * config.flags.isEnabled('feature.autoApprove');
 * ```
 */
export class ConfigManager {
  /** Values as loaded (schema defaults applied, no runtime overrides). */
  readonly #base: Readonly<Record<string, ConfigValue>>;
  /** Winning source per key as loaded. */
  readonly #baseSources: Readonly<Record<string, ConfigSource>>;
  /** Active values (base + runtime overrides). */
  #active: Readonly<Record<string, ConfigValue>>;
  /** Active source per key (runtime overrides tracked here). */
  #sources: Readonly<Record<string, ConfigSource>>;
  readonly #schema: ConfigSchemaMap;
  readonly #listeners: Set<ConfigChangeListener>;
  /** Feature-flag reader over the active configuration. */
  readonly flags: FeatureFlags;
  /** Secrets interface supplied at construction. */
  readonly secrets: Secrets | undefined;

  /**
   * Loads and constructs a manager.
   *
   * @param schema    - the configuration schema.
   * @param providers - configuration providers (any order; precedence by source).
   * @param secrets   - optional secrets interface.
   * @param defaults  - extra default values.
   */
  static async create(
    schema: ConfigSchemaMap,
    providers: readonly ConfigProvider[],
    secrets?: Secrets,
    defaults: Readonly<Record<string, ConfigValue>> = {},
  ): Promise<ConfigManager> {
    const loaded = await loadConfiguration(schema, providers, defaults);
    return new ConfigManager(schema, loaded.values, loaded.sources, secrets);
  }

  /**
   * Synchronous variant of {@link ConfigManager.create} for synchronous
   * providers (static, environment, function providers).
   */
  static createSync(
    schema: ConfigSchemaMap,
    providers: readonly ConfigProvider[],
    secrets?: Secrets,
    defaults: Readonly<Record<string, ConfigValue>> = {},
  ): ConfigManager {
    const loaded = loadConfigurationSync(schema, providers, defaults);
    return new ConfigManager(schema, loaded.values, loaded.sources, secrets);
  }

  private constructor(
    schema: ConfigSchemaMap,
    base: Readonly<Record<string, ConfigValue>>,
    baseSources: Readonly<Record<string, ConfigSource>>,
    secrets?: Secrets,
  ) {
    this.#schema = schema;
    this.#base = base;
    this.#baseSources = baseSources;
    this.#active = base;
    this.#sources = baseSources;
    this.#listeners = new Set();
    this.secrets = secrets;
    this.flags = new FeatureFlags(
      (key) => {
        const value = this.#getTyped(key, 'boolean');
        return typeof value === 'boolean' ? value : undefined;
      },
      (key) => this.#sources[key],
    );
  }

  /** Reads a raw value (validated against the schema) or `undefined`. */
  get(key: ConfigKey): ConfigValue | undefined {
    return this.#active[key];
  }

  /** Reads a string value; `undefined` when absent. Throws on type mismatch. */
  getString(key: ConfigKey): string | undefined {
    return this.#getTyped(key, 'string') as string | undefined;
  }

  /** Reads a number value; `undefined` when absent. Throws on type mismatch. */
  getNumber(key: ConfigKey): number | undefined {
    return this.#getTyped(key, 'number') as number | undefined;
  }

  /** Reads a boolean value; `undefined` when absent. Throws on type mismatch. */
  getBoolean(key: ConfigKey): boolean | undefined {
    return this.#getTyped(key, 'boolean') as boolean | undefined;
  }

  /** Reads a string-array value; `undefined` when absent. */
  getStringArray(key: ConfigKey): readonly string[] | undefined {
    return this.#getTyped(key, 'string_array') as readonly string[] | undefined;
  }

  /** Reads a number-array value; `undefined` when absent. */
  getNumberArray(key: ConfigKey): readonly number[] | undefined {
    return this.#getTyped(key, 'number_array') as readonly number[] | undefined;
  }

  /** The winning source for a key (observability). */
  sourceOf(key: ConfigKey): ConfigSource | undefined {
    return this.#sources[key];
  }

  /**
   * Sets a runtime override for a key (highest precedence). Validates the
   * value against the schema and notifies listeners on change.
   *
   * @throws {ValidationError} when the value does not match the schema.
   */
  setRuntimeValue(key: ConfigKey, value: ConfigValue): void {
    const definition = this.#schema[key];
    if (definition === undefined) {
      throw new ValidationError('Configuration key is not declared in the schema', [
        { path: key, message: 'Runtime overrides are only allowed for declared keys' },
      ]);
    }
    const issue = validateConfigValue(key, definition, value);
    if (issue !== null) {
      throw new ValidationError('Runtime configuration rejected', [issue]);
    }
    const previousValue = this.#active[key];
    const previousSource = this.#sources[key];
    this.#active = { ...this.#active, [key]: value };
    this.#sources = { ...this.#sources, [key]: 'runtime' };
    if (previousValue === undefined || !configValuesEqual(previousValue, value)) {
      this.#notify({ key, previousValue, nextValue: value, previousSource, nextSource: 'runtime' });
    }
  }

  /**
   * Removes a runtime override, restoring the value supplied by the
   * underlying layers. No-op when the key has no runtime override.
   */
  clearRuntimeValue(key: ConfigKey): void {
    if (this.#sources[key] !== 'runtime') {
      return;
    }
    const previousValue = this.#active[key];
    const previousSource = 'runtime';
    const next = { ...this.#active };
    const baseValue = this.#base[key];
    if (baseValue === undefined) {
      delete next[key];
    } else {
      next[key] = baseValue;
    }
    this.#active = next;
    const baseSource = this.#baseSources[key];
    if (baseSource === undefined) {
      const sources = { ...this.#sources };
      delete sources[key];
      this.#sources = sources;
    } else {
      this.#sources = { ...this.#sources, [key]: baseSource };
    }
    // Only notify on a real change: setting the value back to the same base
    // value is a no-op. Clearing a runtime-only key (no base value) is a
    // removal, which is still a real change.
    if (
      baseValue !== undefined &&
      previousValue !== undefined &&
      configValuesEqual(previousValue, baseValue)
    ) {
      return;
    }
    this.#notify({
      key,
      previousValue,
      nextValue: baseValue,
      previousSource,
      nextSource: baseSource,
    });
  }

  /** Subscribes to runtime change events. Returns an unsubscribe function. */
  subscribe(listener: ConfigChangeListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** All active values. Never log secrets from this snapshot directly. */
  snapshot(): Readonly<Record<string, ConfigValue>> {
    return this.#active;
  }

  #getTyped(key: ConfigKey, kind: string): ConfigValue | undefined {
    const value = this.#active[key];
    if (value === undefined) {
      return undefined;
    }
    const definition = this.#schema[key];
    if (definition === undefined) {
      throw new ValidationError('Configuration key is not declared in the schema', [
        { path: key, message: 'Typed access is only allowed for declared keys' },
      ]);
    }
    if (definition.kind !== kind) {
      throw new ValidationError('Configuration type mismatch', [
        { path: key, message: `Expected kind ${definition.kind}, requested ${kind}` },
      ]);
    }
    return value;
  }

  #notify(change: ConfigChange): void {
    for (const listener of this.#listeners) {
      listener(change);
    }
  }
}
