import { describe, expect, it } from 'vitest';
import { findForbiddenKeys, findSecrets, safeCode } from '../src/index.js';

describe('safeCode', () => {
  it('passes undefined and identifier-like codes through', () => {
    expect(safeCode(undefined)).toBeUndefined();
    expect(safeCode('POLICY_DENIED')).toBe('POLICY_DENIED');
    expect(safeCode('crm.update:v1/x@2-a')).toBe('crm.update:v1/x@2-a');
  });
  it('redacts free-form strings', () => {
    expect(safeCode('connection refused to host')).toBe('REDACTED');
    expect(safeCode('Error: boom\n at x')).toBe('REDACTED');
    expect(safeCode('https://x.io/a?token=abc')).toBe('REDACTED');
    expect(safeCode('')).toBe('REDACTED');
  });
  it('bounds length', () => {
    expect(safeCode('A'.repeat(80))).toBe('A'.repeat(80));
    expect(safeCode('A'.repeat(81))).toBe('REDACTED');
    expect(safeCode('ABCDE', 4)).toBe('REDACTED');
  });
});

describe('findSecrets', () => {
  it.each([
    ['Bearer', 'Authorization value Bearer abcdefgh12345'],
    ['gsk_', 'key gsk_abcdefgh1234'],
    ['sk-', 'key sk-abcdefgh1234'],
    ['AWS', 'AKIAABCDEFGHIJKLMNOP'],
    ['JWT', 'eyJhbGciOi.eyJzdWIiOiIx.abcd1234'],
    ['private key', '-----BEGIN RSA PRIVATE KEY-----'],
    ['authorization header', 'Authorization: abc'],
    ['cookie header', 'cookie=abc'],
    ['x-api-key', 'x-api-key: abc'],
    ['api_key assignment', 'api_key = abc'],
    ['password assignment', 'password: hunter2'],
    ['session cookie', 'nexora_session=abc'],
  ])('detects %s', (_name, text) => {
    expect(findSecrets(text).length).toBeGreaterThan(0);
  });

  it('detects secrets nested in objects', () => {
    expect(findSecrets({ a: [{ b: 'Bearer abcdefgh12345' }] }).length).toBeGreaterThan(0);
    expect(findSecrets({ api_key: 'x' }).length).toBeGreaterThan(0);
  });

  it('does not flag ids, codes, durations or counts', () => {
    const benign = {
      id: 'run_0123456789abcdef',
      invocationId: 'inv_abc123',
      code: 'POLICY_DENIED',
      durationMs: 12.34,
      promptTokens: 10,
      totalTokens: 30,
      fingerprint: 'sha256:' + 'a'.repeat(64),
      toolId: 'knowledge.search',
      model: 'llama-3.1-8b',
    };
    expect(findSecrets(benign)).toEqual([]);
    expect(findSecrets('')).toEqual([]);
    expect(findSecrets(undefined)).toEqual([]);
  });
});

describe('findForbiddenKeys', () => {
  it.each([
    'prompt',
    'messages',
    'content',
    'input',
    'arguments',
    'args',
    'body',
    'token',
    'reasoning',
    'thinking',
    'authorization',
    'password',
    'secret',
    'apiKey',
    'Prompt',
  ])('flags %s', (key) => {
    expect(findForbiddenKeys({ [key]: 'x' })).toEqual([`$.${key}`]);
  });

  it('flags at any depth with paths', () => {
    const found = findForbiddenKeys({ a: { b: [{ c: 1 }, { prompt: 'p', d: { body: 1 } }] } });
    expect(found).toEqual(['$.a.b[1].prompt', '$.a.b[1].d.body']);
  });

  it('does not flag benign keys', () => {
    expect(
      findForbiddenKeys({
        promptTokens: 1,
        totalTokens: 2,
        completionTokens: 3,
        promptTemplateId: 'x',
        durationMs: 1,
        tokenUsage: { available: true },
      }),
    ).toEqual([]);
    expect(findForbiddenKeys('string')).toEqual([]);
    expect(findForbiddenKeys(null)).toEqual([]);
  });
});
