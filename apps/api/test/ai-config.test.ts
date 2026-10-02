/**
 * @nexora/app-api — AI narration provider configuration.
 *
 * The narration provider is the only component that can send prompt content
 * out of the process, so its selection has to be explicit, validated at
 * boot, and backward-compatible with deployments that only ever set
 * `GROQ_API_KEY`.
 */

import { describe, expect, it } from 'vitest';

import { loadAiConfig, resolveAiProvider } from '../src/config.js';

/** A minimal env with only the AI keys under test. */
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

describe('resolveAiProvider', () => {
  it('defaults to none when nothing is configured', () => {
    expect(resolveAiProvider(env({}))).toBe('none');
  });

  it('honors an explicit AI_PROVIDER', () => {
    expect(resolveAiProvider(env({ AI_PROVIDER: 'local' }))).toBe('local');
    expect(resolveAiProvider(env({ AI_PROVIDER: 'GROQ' }))).toBe('groq');
    expect(resolveAiProvider(env({ AI_PROVIDER: ' none ' }))).toBe('none');
  });

  it('falls back to groq for a legacy GROQ_API_KEY with no AI_PROVIDER', () => {
    expect(resolveAiProvider(env({ GROQ_API_KEY: 'gsk_legacy' }))).toBe('groq');
  });

  it('lets an explicit AI_PROVIDER override a stray legacy key', () => {
    expect(resolveAiProvider(env({ AI_PROVIDER: 'none', GROQ_API_KEY: 'gsk_legacy' }))).toBe(
      'none',
    );
  });

  it('rejects an unknown provider', () => {
    expect(() => resolveAiProvider(env({ AI_PROVIDER: 'openai' }))).toThrow(/Invalid AI_PROVIDER/);
  });
});

describe('loadAiConfig', () => {
  it('none needs no endpoint or key', () => {
    expect(loadAiConfig(env({}))).toEqual({
      provider: 'none',
      model: 'openai/gpt-oss-120b',
    });
  });

  it('local requires a base URL', () => {
    expect(() => loadAiConfig(env({ AI_PROVIDER: 'local' }))).toThrow(/AI_BASE_URL/);
  });

  it('local carries the endpoint, model, and no key when unauthenticated', () => {
    const config = loadAiConfig(
      env({ AI_PROVIDER: 'local', AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'llama3' }),
    );
    expect(config).toEqual({
      provider: 'local',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(config.apiKey).toBeUndefined();
  });

  it('local forwards a gateway token from AI_API_KEY', () => {
    const config = loadAiConfig(
      env({
        AI_PROVIDER: 'local',
        AI_BASE_URL: 'https://models.internal/v1',
        AI_API_KEY: 'gw-token',
      }),
    );
    expect(config.apiKey).toBe('gw-token');
  });

  it('groq requires a key (GROQ_API_KEY or AI_API_KEY)', () => {
    expect(() => loadAiConfig(env({ AI_PROVIDER: 'groq' }))).toThrow(/GROQ_API_KEY/);
    expect(loadAiConfig(env({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_x' })).apiKey).toBe('gsk_x');
    expect(loadAiConfig(env({ AI_PROVIDER: 'groq', AI_API_KEY: 'gsk_y' })).apiKey).toBe('gsk_y');
  });

  it('preserves the legacy "key only" deployment', () => {
    expect(loadAiConfig(env({ GROQ_API_KEY: 'gsk_legacy' }))).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      apiKey: 'gsk_legacy',
    });
  });
});
