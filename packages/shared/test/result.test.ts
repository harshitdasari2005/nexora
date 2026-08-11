import { describe, expect, it } from 'vitest';

import {
  err,
  isErr,
  isOk,
  map,
  mapErr,
  match,
  ok,
  promiseResult,
  unwrap,
  unwrapOr,
  unwrapOrElse,
  type Result,
} from '../src/result/index.js';

describe('result', () => {
  it('constructs ok and err variants', () => {
    const success: Result<number, Error> = ok(42);
    const failure: Result<number, Error> = err(new Error('nope'));

    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.value).toBe(42);
    }
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.message).toBe('nope');
    }
  });

  it('narrows with isOk and isErr', () => {
    const success: Result<number, Error> = ok(1);
    const failure: Result<number, Error> = err(new Error('x'));

    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(isOk(failure)).toBe(false);
    expect(isErr(failure)).toBe(true);

    if (isOk(success)) {
      expect(success.value).toBe(1);
    }
    if (isErr(failure)) {
      expect(failure.error.message).toBe('x');
    }
  });

  it('maps success values with isOk narrowing', () => {
    const success: Result<number, Error> = ok(2);

    if (isOk(success)) {
      const doubled = map(success, (value) => value * 3);
      expect(unwrap(doubled)).toBe(6);
    }

    // `map` accepts only Ok; failures are preserved untouched by design.
    const failure: Result<number, Error> = err(new Error('x'));
    if (isErr(failure)) {
      expect(failure.error.message).toBe('x');
    }
  });

  it('maps errors with isErr narrowing', () => {
    const failure: Result<number, string> = err('old');

    if (isErr(failure)) {
      const mapped = mapErr(failure, (message) => new Error(message));
      expect(isErr(mapped)).toBe(true);
      if (isErr(mapped)) {
        expect(mapped.error.message).toBe('old');
      }
    }

    // `mapErr` accepts only Err; successes are preserved untouched by design.
    const success: Result<number, string> = ok(7);
    if (isOk(success)) {
      expect(success.value).toBe(7);
    }
  });

  it('pattern-matches both variants', () => {
    const describe = (result: Result<number, Error>): string =>
      match(result, {
        ok: (value) => `value:${value}`,
        err: (error) => `error:${error.message}`,
      });

    expect(describe(ok(5))).toBe('value:5');
    expect(describe(err(new Error('bad')))).toBe('error:bad');
  });

  it('unwraps with fallbacks instead of throwing', () => {
    const failure: Result<string, Error> = err(new Error('x'));

    expect(unwrapOr(failure, 'fallback')).toBe('fallback');
    expect(unwrapOrElse(failure, (error) => `recovered from ${error.message}`)).toBe(
      'recovered from x',
    );
  });

  it('unwraps success values and throws on failures', () => {
    expect(unwrap(ok('fine'))).toBe('fine');
    expect(() => unwrap(err(new Error('bad')))).toThrow('bad');
  });

  it('captures promise rejections as failures', async () => {
    const success: Result<number, Error> = await promiseResult(async () => 10);
    const failure: Result<number, Error> = await promiseResult(async () => {
      throw new Error('async boom');
    });

    expect(unwrap(success)).toBe(10);
    expect(isErr(failure)).toBe(true);
    if (isErr(failure)) {
      expect(failure.error.message).toBe('async boom');
    }
  });
});
