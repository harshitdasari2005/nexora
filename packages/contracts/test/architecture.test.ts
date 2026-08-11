/**
 * Architecture validation tests.
 *
 * These enforce the package's governing rules:
 * - The barrel re-exports every contract module (single source of truth).
 * - Every exported symbol is documented (JSDoc presence) — the "every
 *   export documented" requirement.
 * - No runtime dependency leaks into the package manifest.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The subpath modules the barrel must re-export. */
const EXPECTED_MODULES = [
  'common',
  'api',
  'events',
  'commands',
  'queries',
  'messages',
  'ai',
  'workflow',
  'plugin',
  'approval',
  'notification',
  'identity',
  'registry',
  'versioning',
  'guards',
] as const;

const PACKAGE_ROOT = new URL('..', import.meta.url);

function readPackageJson(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports: Record<string, unknown>;
} {
  return JSON.parse(readFileSync(new URL('package.json', PACKAGE_ROOT), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports: Record<string, unknown>;
  };
}

/**
 * Extracts the names of every exported symbol from a module source file
 * (types, interfaces, constants, functions).
 */
function exportedNames(source: string): readonly string[] {
  const names = new Set<string>();
  const exportRegex = /export\s+(?:type|interface|const|function|class|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(exportRegex)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  // `export type Foo =` (aliases) and `export { ... }` (re-exports).
  const aliasRegex = /export\s+type\s+([A-Za-z_$][\w$]*)\s*=/g;
  for (const match of source.matchAll(aliasRegex)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names];
}

/**
 * True when `name`'s declaration in `source` has a preceding JSDoc block.
 * Matches the declaration keyword (`export type|interface|const|…`) so
 * mentions of the name inside other JSDoc text are ignored.
 */
function hasJSDoc(source: string, name: string): boolean {
  const whitespace = '[ \\t]';
  const declaration = new RegExp(
    `export${whitespace}+(?:type|interface|const|function|class)${whitespace}+${name}(?=[<{=( ])`,
    'g',
  );
  const matches = [...source.matchAll(declaration)];
  const last = matches.at(-1);
  if (last?.index === undefined) {
    return false;
  }
  const before = source.slice(0, last.index);
  const lastComment = before.lastIndexOf('/**');
  const lastClose = before.lastIndexOf('*/');
  // The nearest comment block is a closed JSDoc comment when its closer
  // appears after its opener, and the closer is close to the declaration
  // (no intervening code — only whitespace, JSDoc tags, and comment lines).
  if (lastComment === -1 || lastClose === -1 || lastClose < lastComment) {
    return false;
  }
  const between = source.slice(lastClose + 2, last.index);
  return !/[^\s*]/.test(between);
}

describe('barrel exports', () => {
  it('re-exports every contract module from the default entry', () => {
    const barrel = readFileSync(new URL('src/index.ts', PACKAGE_ROOT), 'utf8');
    for (const module of EXPECTED_MODULES) {
      expect(barrel).toContain(`export * from './${module}/index.js';`);
    }
  });

  it('exposes every subpath in the package exports map', () => {
    const pkg = readPackageJson();
    for (const module of EXPECTED_MODULES) {
      expect(pkg.exports[`./${module}`], `exports map must expose './${module}'`).toBeDefined();
    }
  });

  it('exposes a default entry', () => {
    const pkg = readPackageJson();
    expect(pkg.exports['.']).toBeDefined();
  });
});

describe('documentation quality', () => {
  it('documents every exported symbol with a JSDoc comment', () => {
    for (const moduleName of EXPECTED_MODULES) {
      const source = readFileSync(new URL(`src/${moduleName}/index.ts`, PACKAGE_ROOT), 'utf8');
      const names = exportedNames(source);
      expect(
        names.length,
        `module '${moduleName}' must export at least one symbol`,
      ).toBeGreaterThan(0);
      for (const name of names) {
        expect(
          hasJSDoc(source, name),
          `export '${name}' in ${moduleName}/index.ts must carry a JSDoc comment`,
        ).toBe(true);
      }
    }
  });
});

describe('dependency discipline', () => {
  it('declares zero runtime dependencies (type-only package)', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies).toBeUndefined();
  });

  it('declares only the test toolchain as dev dependencies', () => {
    const pkg = readPackageJson();
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    expect(devDeps).toContain('vitest');
  });
});
