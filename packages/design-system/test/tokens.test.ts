/**
 * Design-token sanity tests: every theme defines the full color role set,
 * the spacing scale is strictly increasing, and CSS variable generation is
 * well-formed.
 */

import { describe, expect, it } from 'vitest';

import {
  cssVariables,
  darkColors,
  darkThemeCss,
  lightColors,
  lightThemeCss,
  spacing,
  typography,
} from '../src/tokens.js';
import { initialsOf } from '../src/components/Avatar.js';

describe('design tokens', () => {
  it('defines the same color roles in both themes', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
    expect(Object.keys(lightColors)).toContain('bg');
    expect(Object.keys(lightColors)).toContain('primary');
    expect(Object.keys(lightColors)).toContain('ai');
    expect(Object.keys(lightColors)).toContain('danger');
  });

  it('keeps the spacing scale strictly increasing', () => {
    // Explicit key order: integer-like object keys sort first in JS, so
    // `Object.values` cannot be relied on here.
    const orderedKeys = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24] as const;
    const values = orderedKeys.map((key) => parseFloat(spacing[key]));
    for (let index = 1; index < values.length; index += 1) {
      const current = values[index];
      const previous = values[index - 1];
      if (current === undefined || previous === undefined) {
        throw new Error('unreachable');
      }
      expect(current).toBeGreaterThan(previous);
    }
  });

  it('exposes a full type scale', () => {
    expect(typography.sizes['4xl']).toBeDefined();
    expect(typography.weights.bold).toBe(700);
  });

  it('generates well-formed CSS custom properties for a theme', () => {
    const css = cssVariables(lightColors);
    // One `--nexora-<role>: <value>;` line per color role, no leftovers.
    const lines = css.trim().split('\n');
    expect(lines).toHaveLength(Object.keys(lightColors).length);
    for (const line of lines) {
      expect(line).toMatch(/^--nexora-[a-zA-Z]+: .+;$/);
    }
    expect(css).toContain(`--nexora-bg: ${lightColors.bg};`);
    expect(css).toContain(`--nexora-primary: ${lightColors.primary};`);
    expect(lightThemeCss).toContain('--nexora-bg');
    expect(darkThemeCss).toContain('--nexora-bg');
    expect(darkThemeCss).not.toContain(`--nexora-bg: ${lightColors.bg};`);
  });
});

describe('Avatar initials', () => {
  it('derives up to two initials from a name', () => {
    expect(initialsOf('Alex Morgan')).toBe('AM');
    expect(initialsOf('alex')).toBe('A');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('Ada Lovelace Clarke')).toBe('AC');
  });
});
