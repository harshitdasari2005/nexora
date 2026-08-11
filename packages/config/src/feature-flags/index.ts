/**
 * @nexora/config — feature flags.
 *
 * Runtime-evaluable boolean switches. Feature flags are configuration keys
 * with a boolean kind; the manager evaluates them and supports runtime
 * toggling for progressive rollout without restarts (BKD.md §11.3).
 */

import type { ConfigKey, ConfigSource } from '../types/index.js';

/**
 * A feature flag reader. Constructed by the manager; the default is resolved
 * from the schema so flags fall back safely when unset.
 */
export class FeatureFlags {
  /**
   * @param getBoolean - resolves a key to its boolean value or `undefined`
   *   when the key is absent from the active configuration.
   * @param sourceOf  - resolves the winning source for a key (observability).
   * @param logEnabled - optional hook invoked when a flag is read; useful for
   *   audit and rollout analysis.
   */
  constructor(
    private readonly getBoolean: (key: ConfigKey) => boolean | undefined,
    private readonly sourceOf: (key: ConfigKey) => ConfigSource | undefined,
    private readonly logEnabled?: (key: ConfigKey) => void,
  ) {}

  /**
   * Evaluates a flag. Returns the configured value, or `defaultValue` when
   * the flag is not configured.
   */
  isEnabled(key: ConfigKey, defaultValue = false): boolean {
    const value = this.getBoolean(key);
    if (value !== undefined) {
      if (value && this.logEnabled) {
        this.logEnabled(key);
      }
      return value;
    }
    return defaultValue;
  }

  /**
   * The winning source for the flag, for observability.
   */
  source(key: ConfigKey): ConfigSource | undefined {
    return this.sourceOf(key);
  }
}
