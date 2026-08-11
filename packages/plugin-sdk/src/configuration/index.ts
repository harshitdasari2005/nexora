/**
 * @nexora/plugin-sdk — configuration.
 *
 * Configuration contributions: the plugin's typed settings surface
 * (SAD.md §11 configuration platform). The SDK provides a schema contract, a
 * typed accessor store, and the contribution that registers the schema with
 * the platform.
 */

/** A single configuration property. */
export interface ConfigProperty {
  /** Property type. */
  type: 'string' | 'number' | 'boolean' | 'json' | 'enum';
  /** Human-readable description. */
  description?: string;
  /** Default value. */
  default?: unknown;
  /** Allowed values for `enum` properties. */
  enum?: readonly (string | number)[];
  /** Whether the value is a secret (never exposed in plaintext). */
  secret?: boolean;
}

/** A configuration schema: an object of typed properties. */
export interface ConfigurationSchema {
  /** Schema id, unique within the plugin. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Property definitions keyed by name. */
  properties: Readonly<Record<string, ConfigProperty>>;
  /** Property names that are required. */
  required?: readonly string[];
}

/** Default values for a configuration schema, keyed by property name. */
export type ConfigurationDefaults = Readonly<Record<string, unknown>>;

/** A configuration contribution: registers a schema with the platform. */
export interface ConfigurationContribution {
  /** Contribution kind discriminant. */
  kind: 'configuration';
  /** The schema the plugin exposes. */
  schema: ConfigurationSchema;
  /** Default values for the schema. */
  defaults: ConfigurationDefaults;
}

/**
 * A typed, in-memory configuration store for a plugin. Initialized from
 * defaults; runtime overrides are layered on top. Values are read via
 * {@link PluginConfiguration.get} with optional secret redaction at the
 * platform boundary.
 */
export class PluginConfiguration {
  readonly #values: Record<string, unknown>;

  /**
   * @param defaults - initial values (defaults merged from the schema).
   */
  constructor(defaults: ConfigurationDefaults = {}) {
    this.#values = { ...defaults };
  }

  /** Returns the value for a key, or `undefined`. */
  get<T = unknown>(key: string): T | undefined {
    return this.#values[key] as T | undefined;
  }

  /** Returns the value for a key or the fallback when unset. */
  getOrDefault<T>(key: string, fallback: T): T {
    const value = this.#values[key] as T | undefined;
    return value === undefined ? fallback : value;
  }

  /** Sets a runtime override for a key. */
  set(key: string, value: unknown): void {
    this.#values[key] = value;
  }

  /** Returns a snapshot of all configured values. */
  all(): Readonly<Record<string, unknown>> {
    return { ...this.#values };
  }

  /** Whether a key is configured. */
  has(key: string): boolean {
    return key in this.#values;
  }
}
