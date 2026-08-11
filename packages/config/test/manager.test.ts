/**
 * Unit tests for the configuration manager, loader, feature flags, and
 * secrets (`src/manager`, `src/loader`, `src/feature-flags`,
 * `src/secrets`).
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@nexora/shared/errors';

import { ConfigManager } from '../src/manager/index.js';
import { loadConfigurationSync } from '../src/loader/index.js';
import { environmentSecrets, redactValue, staticSecrets } from '../src/secrets/index.js';
import { staticProvider } from '../src/providers/index.js';
import { key } from '../src/types/index.js';
import type { ConfigSchemaMap } from '../src/schema/index.js';

const schema: ConfigSchemaMap = {
  [key('app.port')]: { key: key('app.port'), kind: 'number', required: true },
  [key('app.name')]: { key: key('app.name'), kind: 'string', required: true, maxLength: 40 },
  [key('app.debug')]: { key: key('app.debug'), kind: 'boolean', required: false, default: false },
  [key('feature.autoApprove')]: {
    key: key('feature.autoApprove'),
    kind: 'boolean',
    required: false,
    default: false,
  },
};

const baseProviders = [staticProvider('global', { 'app.port': 3000, 'app.name': 'nexora' })];

describe('ConfigManager', () => {
  it('loads, applies defaults, and exposes typed getters', () => {
    const config = ConfigManager.createSync(schema, baseProviders);
    expect(config.getNumber(key('app.port'))).toBe(3000);
    expect(config.getString(key('app.name'))).toBe('nexora');
    expect(config.getBoolean(key('app.debug'))).toBe(false);
    expect(config.getStringArray(key('app.hosts'))).toBeUndefined();
  });

  it('throws ValidationError on missing required keys', () => {
    expect(() =>
      ConfigManager.createSync(schema, [staticProvider('global', { 'app.port': 3000 })]),
    ).toThrowError(/Configuration is missing required keys/);
  });

  it('throws ValidationError on invalid values', () => {
    expect(() =>
      ConfigManager.createSync(schema, [
        staticProvider('global', { 'app.port': 'abc', 'app.name': 'nexora' }),
      ]),
    ).toThrowError(/Configuration validation failed/);
  });

  it('reports the winning source for provider-supplied keys only', () => {
    const config = ConfigManager.createSync(schema, baseProviders);
    expect(config.sourceOf(key('app.port'))).toBe('global');
    // Schema defaults are not a provider layer, so they carry no source.
    expect(config.sourceOf(key('app.debug'))).toBeUndefined();
  });

  it('rejects runtime overrides that violate the schema', () => {
    const config = ConfigManager.createSync(schema, baseProviders);
    expect(() => config.setRuntimeValue(key('app.port'), 'not-a-number')).toThrowError();
  });

  it('applies and clears runtime overrides, restoring the base value', () => {
    const config = ConfigManager.createSync(schema, baseProviders);
    config.setRuntimeValue(key('app.port'), 9000);
    expect(config.getNumber(key('app.port'))).toBe(9000);
    expect(config.sourceOf(key('app.port'))).toBe('runtime');
    config.clearRuntimeValue(key('app.port'));
    expect(config.getNumber(key('app.port'))).toBe(3000);
    expect(config.sourceOf(key('app.port'))).toBe('global');
  });

  it('notifies subscribers on real changes only', () => {
    const config = ConfigManager.createSync(schema, baseProviders);
    const changes: string[] = [];
    const unsubscribe = config.subscribe((change) =>
      changes.push(`${change.key}=${change.nextValue}`),
    );
    config.setRuntimeValue(key('app.port'), 9000);
    config.setRuntimeValue(key('app.port'), 9000); // same value: no notification
    unsubscribe();
    config.setRuntimeValue(key('app.port'), 7000);
    expect(changes).toEqual(['app.port=9000']);
  });

  it('tracks source transitions in change events', () => {
    const config = ConfigManager.createSync(schema, baseProviders);
    const transitions: Array<{ from?: string; to?: string }> = [];
    config.subscribe((change) =>
      transitions.push({ from: change.previousSource, to: change.nextSource }),
    );
    config.setRuntimeValue(key('app.port'), 9000);
    expect(transitions[0]).toEqual({ from: 'global', to: 'runtime' });
    config.clearRuntimeValue(key('app.port'));
    expect(transitions[1]).toEqual({ from: 'runtime', to: 'global' });
  });

  it('does not notify when clearing restores the identical value', () => {
    const config = ConfigManager.createSync(schema, baseProviders);
    const changes: string[] = [];
    config.subscribe((change) => changes.push(`${change.key}=${change.nextValue}`));
    config.setRuntimeValue(key('app.port'), 9000);
    config.setRuntimeValue(key('app.port'), 3000); // back to base
    config.clearRuntimeValue(key('app.port')); // value already equals base: no-op
    expect(changes).toEqual(['app.port=9000', 'app.port=3000']);
  });

  it('resolves feature flags with safe defaults and source introspection', () => {
    const config = ConfigManager.createSync(schema, baseProviders);
    expect(config.flags.isEnabled(key('feature.autoApprove'))).toBe(false);
    expect(config.flags.source(key('feature.autoApprove'))).toBeUndefined();
    config.setRuntimeValue(key('feature.autoApprove'), true);
    expect(config.flags.isEnabled(key('feature.autoApprove'))).toBe(true);
    expect(config.flags.source(key('feature.autoApprove'))).toBe('runtime');
  });

  it('exposes the secrets interface when supplied', () => {
    const config = ConfigManager.createSync(
      schema,
      baseProviders,
      staticSecrets({ DB_PASSWORD: 'pw' }),
    );
    expect(config.secrets?.get('DB_PASSWORD')).toBe('pw');
  });
});

describe('loadConfigurationSync', () => {
  it('merges providers and applies defaults', () => {
    const loaded = loadConfigurationSync(schema, baseProviders);
    expect(loaded.values).toEqual({
      'app.port': 3000,
      'app.name': 'nexora',
      'app.debug': false,
      'feature.autoApprove': false,
    });
    expect(loaded.sources['app.port']).toBe('global');
  });

  it('throws a ValidationError carrying issues on failure', () => {
    try {
      loadConfigurationSync(schema, [staticProvider('global', {})]);
      expect.unreachable();
    } catch (error) {
      if (error instanceof ValidationError) {
        expect(error.issues.length).toBeGreaterThanOrEqual(2);
      } else {
        expect.unreachable();
      }
    }
  });

  it('rejects asynchronous providers in the sync loader', () => {
    const asyncProvider = {
      source: 'environment' as const,
      load: async () => ({ 'app.port': 8080, 'app.name': 'nexora' }),
    };
    expect(() => loadConfigurationSync(schema, [asyncProvider])).toThrowError(
      /asynchronous provider/,
    );
  });
});

describe('secrets', () => {
  it('resolves secrets from the environment with a prefix', () => {
    const secrets = environmentSecrets({ NEXORA_SECRET_DB: 'pw' }, 'NEXORA_SECRET_');
    expect(secrets.get('DB')).toBe('pw');
    expect(secrets.get('MISSING')).toBeUndefined();
  });

  it('treats empty env values as absent', () => {
    const secrets = environmentSecrets({ NEXORA_SECRET_DB: '' }, 'NEXORA_SECRET_');
    expect(secrets.get('DB')).toBeUndefined();
  });

  it('redacts secret-looking keys', () => {
    expect(redactValue(key('db.password'), 'pw')).toBe('***');
    expect(redactValue(key('db.api_key'), 'pw')).toBe('***');
    expect(redactValue(key('app.name'), 'nexora')).toBe('nexora');
  });
});
