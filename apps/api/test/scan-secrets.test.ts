/**
 * Regression tests for `scripts/scan-secrets.mjs`, run against throwaway git
 * repositories (the scanner reads `git ls-files` of its working directory).
 *
 * Pins: JSON config files ARE scanned for hardcoded secret literals (the
 * extension check once matched a literal backslash instead of `.json`), and the
 * `scan-secrets:allow-fixture` marker suppresses a finding ONLY on a marked
 * line of a file under a `test/` directory.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCANNER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/scan-secrets.mjs',
);
// A deliberately fake key SHAPE, built at runtime so the literal never appears in
// tracked source (this file is itself scanned).
const FAKE_AWS = `${'AKIA'}ABCDEFGHIJKLMNOP`;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Scans a throwaway repository containing exactly `files`; returns exit code + output. */
function scan(files: Record<string, string>): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'scan-secrets-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const result = spawnSync('node', [SCANNER], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('scan-secrets', () => {
  it('detects a hardcoded secret literal in a .json config file', () => {
    const result = scan({ 'config/app.json': '{ "apiToken": "abcdefghijklmnop1234" }\n' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('config/app.json:1');
  });

  it('still ignores the same literal in a source file (generic pattern is config-only)', () => {
    expect(scan({ 'src/a.ts': "const apiToken = 'abcdefghijklmnop1234';\n" }).status).toBe(0);
  });

  it('allows a marked fake fixture in a test/ file, and only that line', () => {
    const marked = `export const k = '${FAKE_AWS}'; // scan-secrets:allow-fixture\n`;
    expect(scan({ 'pkg/test/redact.test.ts': marked }).status).toBe(0);
    const unmarkedToo = `${marked}export const j = '${FAKE_AWS}';\n`;
    const result = scan({ 'pkg/test/redact.test.ts': unmarkedToo });
    expect(result.status).toBe(1);
    expect(result.output).toContain('pkg/test/redact.test.ts:2');
  });

  it('a fixture marker outside a test/ directory does NOT suppress the finding', () => {
    const result = scan({
      'src/keys.ts': `export const k = '${FAKE_AWS}'; // scan-secrets:allow-fixture\n`,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('src/keys.ts:1');
  });

  it('the marker does not suppress a finding in a .json file under test/ either, unless marked', () => {
    // JSON cannot carry comments; an unmarked secret literal in test JSON is still a finding.
    expect(
      scan({ 'pkg/test/fixture.json': '{ "password": "hunter2hunter2hunter2" }\n' }).status,
    ).toBe(1);
  });
});
