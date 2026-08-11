/**
 * Unit tests for configuration merging and providers (`src/merging`,
 * `src/providers`).
 */

import { describe, expect, it } from 'vitest';

import { mergeLayers, resolveSources, type ConfigLayer } from '../src/merging/index.js';
import { environmentProvider, functionProvider, staticProvider } from '../src/providers/index.js';

const layer = (source: ConfigLayer['source'], values: Record<string, unknown>): ConfigLayer => ({
  source,
  values: values as ConfigLayer['values'],
});

describe('mergeLayers', () => {
  it('applies higher-precedence layers over lower ones', () => {
    const layers = [
      layer('global', { 'app.port': 3000, 'app.name': 'global' }),
      layer('company', { 'app.port': 8080 }),
    ];
    expect(mergeLayers(layers, {})).toEqual({ 'app.port': 8080, 'app.name': 'global' });
  });

  it('fills missing keys from defaults', () => {
    const merged = mergeLayers([layer('environment', { 'app.port': 8080 })], {
      'app.debug': false,
    });
    expect(merged).toEqual({ 'app.port': 8080, 'app.debug': false });
  });

  it('does not depend on provider order in the array', () => {
    const a = [layer('environment', { x: 1 }), layer('workspace', { x: 2 })];
    const b = [layer('workspace', { x: 2 }), layer('environment', { x: 1 })];
    expect(mergeLayers(a, {})).toEqual(mergeLayers(b, {}));
  });
});

describe('resolveSources', () => {
  it('reports the winning source per key', () => {
    const layers = [
      layer('global', { 'app.port': 3000, 'app.name': 'global' }),
      layer('environment', { 'app.port': 8080 }),
    ];
    expect(resolveSources(layers)).toEqual({
      'app.port': 'environment',
      'app.name': 'global',
    });
  });
});

describe('staticProvider', () => {
  it('returns its values', () => {
    const provider = staticProvider('company', { 'hr.approval.required': true });
    expect(provider.source).toBe('company');
    expect(provider.load()).toEqual({ 'hr.approval.required': true });
  });
});

describe('environmentProvider', () => {
  const provider = environmentProvider(
    { NEXORA_APP_PORT: '8080', NEXORA_APP_DEBUG: 'yes', NEXORA_APP_HOSTS: 'a, b' },
    'NEXORA_',
    { 'app.port': 'number', 'app.debug': 'boolean', 'app.hosts': 'string_array' },
  );

  it('parses typed values from env vars using the key convention', () => {
    const values = provider.load() as Record<string, unknown>;
    expect(values).toEqual({
      'app.port': 8080,
      'app.hosts': ['a', 'b'],
    });
  });

  it('skips values that are present but unparseable', () => {
    const values = provider.load() as Record<string, unknown>;
    expect(values['app.debug']).toBeUndefined();
  });
});

describe('functionProvider', () => {
  it('delegates to the load function', () => {
    const provider = functionProvider('ai', () => ({ 'ai.temperature': 0.2 }));
    expect(provider.source).toBe('ai');
    expect(provider.load()).toEqual({ 'ai.temperature': 0.2 });
  });
});
