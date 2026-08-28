/**
 * Money value object tests: integer minor-units validation, currency code
 * validation, equality — no floating-point drift (PERSISTENCE.md §6).
 */

import { describe, expect, it } from 'vitest';

import { Money } from '../src/index.js';

describe('Money.create', () => {
  it('creates a valid amount', () => {
    const money = Money.create(12_345, 'INR');
    expect(money.minorUnits).toBe(12_345);
    expect(money.currency).toBe('INR');
  });

  it('accepts zero (a zero-allocated budget is valid, just useless)', () => {
    expect(() => Money.create(0, 'INR')).not.toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() => Money.create(-1, 'INR')).toThrow();
  });

  it('rejects a non-integer amount (no floating-point money)', () => {
    expect(() => Money.create(10.5, 'INR')).toThrow();
  });

  it('rejects a lowercase currency code', () => {
    expect(() => Money.create(100, 'inr')).toThrow();
  });

  it('rejects a currency code of the wrong length', () => {
    expect(() => Money.create(100, 'IN')).toThrow();
    expect(() => Money.create(100, 'INRX')).toThrow();
  });

  it('rejects an amount beyond the maximum bound', () => {
    expect(() => Money.create(1_000_000_000_01, 'INR')).toThrow();
  });
});

describe('Money.isAtLeast / equals', () => {
  it('compares amounts of the same currency', () => {
    const higher = Money.create(200, 'INR');
    const lower = Money.create(100, 'INR');
    expect(higher.isAtLeast(lower)).toBe(true);
    expect(lower.isAtLeast(higher)).toBe(false);
  });

  it('never compares across currencies as "at least"', () => {
    const inr = Money.create(200, 'INR');
    const usd = Money.create(1, 'USD');
    expect(inr.isAtLeast(usd)).toBe(false);
  });

  it('equals compares both minor units and currency', () => {
    expect(Money.create(100, 'INR').equals(Money.create(100, 'INR'))).toBe(true);
    expect(Money.create(100, 'INR').equals(Money.create(100, 'USD'))).toBe(false);
    expect(Money.create(100, 'INR').equals(Money.create(101, 'INR'))).toBe(false);
  });
});

describe('Money.add / subtract', () => {
  it('adds two same-currency amounts (integer arithmetic, no drift)', () => {
    const sum = Money.create(10, 'INR').add(Money.create(20, 'INR'));
    expect(sum.equals(Money.create(30, 'INR'))).toBe(true);
  });

  it('subtracts two same-currency amounts', () => {
    const diff = Money.create(50, 'INR').subtract(Money.create(20, 'INR'));
    expect(diff.equals(Money.create(30, 'INR'))).toBe(true);
  });

  it('refuses to add or subtract across currencies', () => {
    expect(() => Money.create(10, 'INR').add(Money.create(1, 'USD'))).toThrow();
    expect(() => Money.create(10, 'INR').subtract(Money.create(1, 'USD'))).toThrow();
  });

  it('refuses a negative result (money is never negative in this model)', () => {
    expect(() => Money.create(10, 'INR').subtract(Money.create(20, 'INR'))).toThrow();
  });

  it('refuses a sum beyond the maximum bound', () => {
    const huge = Money.create(1_000_000_000_00, 'INR');
    expect(() => huge.add(Money.create(1, 'INR'))).toThrow();
  });
});
