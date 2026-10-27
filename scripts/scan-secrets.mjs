#!/usr/bin/env node
/**
 * S21 secrets/scan audit gate (ENGINEERING_PLAYBOOK.md §10.1: "CI scans for
 * secret patterns on every commit; violations block merge").
 *
 * Scans every GIT-TRACKED file (never node_modules/dist/.git) for
 * high-signal secret patterns: cloud credentials, private keys, GitHub
 * tokens, Slack tokens, and hardcoded password/secret values in config
 * files. Exit code 1 blocks on any finding so it can run in CI or via
 * `pnpm scan:secrets`.
 *
 * Deliberately narrow: the goal is a real gate, not a noisy linter. False
 * positives here are preferred over missed secrets.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HIGH_SIGNAL_PATTERNS = [
  // Cloud / provider credentials
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bASIA[0-9A-Z]{16}\b/,
  /[aA][wW][sS]_(access_key_id|secret_access_key)\s*=\s*['"][^'"]+/,
  // Private keys
  /-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/,
  // Common developer-service tokens
  /\bghp_[0-9A-Za-z]{36}\b/,
  /\bgithub_pat_[0-9A-Za-z_]{20,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/, // OpenAI-style keys (incl. sk-proj-)
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API keys
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, // JWTs
  // Hardcoded password/secret literals in tracked config-like files
  // The optional quote after the key lets it match JSON (`"apiToken": "…"`).
  /(password|passwd|secret|api[_-]?key|token)['"]?\s*[:=]\s*['"][^'"]{12,}['"]/i,
];

/** Files whose content legitimately matches the generic literal pattern. */
const IGNORE_PATHS = new Set([
  'pnpm-lock.yaml',
  '.env.example',
  'infrastructure/keycloak/realm-nexora.json', // seeded dev users (dev only)
]);

/**
 * Line-level allowance for DELIBERATELY FAKE credentials used as redaction-test
 * fixtures (e.g. the redactor's own "does this look like an AWS key?" cases).
 * It is honoured ONLY on a line that carries the marker, ONLY in files under a
 * `test/` directory — so a real secret anywhere else, or on an unmarked line of
 * a test file, is still a finding. It never changes which patterns are applied.
 */
const FIXTURE_MARKER = 'scan-secrets:allow-fixture';
const isTestFile = (file) => /(^|\/)test\//.test(file);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: process.cwd() });
  return out.split('\n').filter((line) => line.length > 0);
}

/**
 * The generic literal pattern applies only to CONFIG files (env/json/yaml).
 * Source and test files are exempt: tests carry intentional fixture values
 * (`secret: 'test-secret'`), which are not findings — the high-signal
 * patterns above still cover real credentials in any file.
 */
function isConfigLikeFile(file) {
  return /\.env(\.|$)|\.json$|\.ya?ml$/.test(file);
}

function scan() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (IGNORE_PATHS.has(file)) {
      continue;
    }
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // binary or unreadable — skip
    }
    const lines = content.split('\n');
    for (const pattern of HIGH_SIGNAL_PATTERNS) {
      const generic = pattern === HIGH_SIGNAL_PATTERNS[HIGH_SIGNAL_PATTERNS.length - 1];
      if (generic && !isConfigLikeFile(file)) {
        continue;
      }
      for (let i = 0; i < lines.length; i += 1) {
        if (isTestFile(file) && lines[i].includes(FIXTURE_MARKER)) {
          continue;
        }
        if (pattern.test(lines[i])) {
          findings.push(`${file}:${i + 1}: ${pattern.toString()}`);
        }
      }
    }
  }
  return findings;
}

const findings = scan();
if (findings.length > 0) {
  console.error(`[scan:secrets] ${findings.length} potential secret(s) found:\n`);
  for (const finding of findings) {
    console.error(`  - ${finding}`);
  }
  console.error(
    '\nBlocking: review each finding. Real secrets must move to the environment / ' +
      'Secrets Manager (PLAYBOOK §10.1). False positive? Refine the pattern or add the ' +
      'file to IGNORE_PATHS with a comment.',
  );
  process.exit(1);
}
console.log('[scan:secrets] clean — no high-signal secret patterns in tracked files.');
