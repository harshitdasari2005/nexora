/**
 * @nexora/config — secrets interface.
 *
 * A minimal abstraction over secret material. Secrets are configuration
 * values that must never be logged or serialized (SAD.md §13.6). The
 * interface keeps the platform agnostic to the secret backend (env vars,
 * vault, KMS) — the concrete secret store plugs in per deployment.
 */

import type { ConfigKey } from '../types/index.js';

/** A secret lookup result: value, or `undefined` when the secret is absent. */
export type SecretLookup = string | undefined;

/**
 * The secrets interface consumed by the configuration manager. Implementations
 * must never log secret material and should prefer lazy resolution.
 */
export interface Secrets {
  /** Resolves the value of the named secret. */
  get(name: string): SecretLookup | Promise<SecretLookup>;
}

/**
 * A secrets implementation backed by the process environment.
 *
 * @example
 * ```ts
 * const secrets = environmentSecrets(process.env, 'NEXORA_SECRET_');
 * await secrets.get('DB_PASSWORD'); // reads NEXORA_SECRET_DB_PASSWORD
 * ```
 */
export function environmentSecrets(env: NodeJS.ProcessEnv, prefix: string): Secrets {
  return {
    get(name: string): SecretLookup {
      const raw = env[`${prefix}${name}`];
      return raw === undefined || raw === '' ? undefined : raw;
    },
  };
}

/**
 * A static secrets implementation for tests and local development. Values
 * are held in memory; never use for production secrets.
 */
export function staticSecrets(values: Readonly<Record<string, string>>): Secrets {
  return {
    get(name: string): SecretLookup {
      return values[name];
    },
  };
}

/**
 * Redacts a configuration value for logging: secrets become `***`.
 *
 * @param key   - the configuration key.
 * @param value - the value to redact.
 * @param isSecretKey - predicate returning true for secret keys; defaults to
 *   key names containing `secret`, `password`, `token`, or `key`.
 */
export function redactValue(
  key: ConfigKey,
  value: string,
  isSecretKey: (key: ConfigKey) => boolean = (k) => /secret|password|token|api[_-]?key/i.test(k),
): string {
  return isSecretKey(key) ? '***' : value;
}
