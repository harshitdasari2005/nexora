/**
 * Prompt 8 — REST mutation classification tripwire.
 *
 * Every mutating route (`POST`/`PUT`/`PATCH`/`DELETE`) must appear in
 * `REST_MUTATION_CLASSES` with a class and a justification. Adding a mutating
 * route without classifying it fails here; a route classified `rbac+policy`
 * must actually call `enforceRestPolicy`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REST_MUTATION_CLASSES,
  legacyClassOf,
  type RestMutationClass,
} from '../src/policy/rest-mutation-classes.js';

const ROUTES_DIR = fileURLToPath(new URL('../src/routes/', import.meta.url));
const CLASSES: readonly RestMutationClass[] = [
  'rbac',
  'policy_enforced',
  'approval_enforced',
  'domain_governed',
  'exempt',
];
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface MutatingRoute {
  file: string;
  key: string;
  segment: string;
}

function collect(): MutatingRoute[] {
  const found: MutatingRoute[] = [];
  for (const file of readdirSync(ROUTES_DIR).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(`${ROUTES_DIR}${file}`, 'utf8');
    const anyStart = [
      ...source.matchAll(/\b(?:app|[A-Za-z]+App)\.(get|post|put|patch|delete)\s*\(/gi),
    ].map((m) => m.index ?? 0);
    const mutating = source.matchAll(/\b(?:app|[A-Za-z]+App)\.(post|put|patch|delete)\s*\(/gi);
    for (const match of mutating) {
      const index = match.index ?? 0;
      const path = source.slice(index, index + 300).match(/['"`]([^'"`\n]+)['"`]/);
      if (path === null) {
        continue;
      }
      const next = anyStart.find((i) => i > index) ?? source.length;
      found.push({
        file,
        key: `${match[1]!.toUpperCase()} ${path[1]!}`,
        segment: source.slice(index, next),
      });
    }
  }
  return found;
}

describe('REST mutation classification (Direct human vs AI execution)', () => {
  const routes = collect();

  it('finds the mutating routes (guards against a broken extractor)', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('every mutating route is classified', () => {
    const missing = routes
      .filter((route) => REST_MUTATION_CLASSES[route.key] === undefined)
      .map((route) => `${route.key}  (${route.file})`);
    expect(missing).toEqual([]);
  });

  it('the table has no stale entries', () => {
    const live = new Set(routes.map((route) => route.key));
    expect(Object.keys(REST_MUTATION_CLASSES).filter((key) => !live.has(key))).toEqual([]);
  });

  it('every entry has a valid class and a real justification', () => {
    for (const [key, entry] of Object.entries(REST_MUTATION_CLASSES)) {
      expect(CLASSES, key).toContain(entry.class);
      expect(entry.justification.trim().length, key).toBeGreaterThan(20);
    }
  });

  it('every `policy_enforced` route calls enforceRestPolicy (and no other route claims to)', () => {
    const policyRoutes = routes.filter(
      (route) => REST_MUTATION_CLASSES[route.key]?.class === 'policy_enforced',
    );
    expect(policyRoutes.map((route) => route.key).sort()).toEqual(
      [
        'POST /api/finance/expenses',
        'POST /api/finance/expenses/:id/decide',
        'POST /api/workflows',
      ].sort(),
    );
    for (const route of policyRoutes) {
      expect(route.segment, route.key).toContain('enforceRestPolicy(');
    }
    // A route that calls enforceRestPolicy must be classified as a policy route.
    for (const route of routes) {
      if (route.segment.includes('enforceRestPolicy(')) {
        expect(REST_MUTATION_CLASSES[route.key]?.class, route.key).toBe('policy_enforced');
      }
    }
  });

  it('every classification is CODE-PROVEN: each proof is still true of the source', () => {
    const byKey = new Map(routes.map((route) => [route.key, route]));
    const failures: string[] = [];
    for (const [key, entry] of Object.entries(REST_MUTATION_CLASSES)) {
      expect(entry.proof.length, `${key} needs at least one proof`).toBeGreaterThan(0);
      for (const proof of entry.proof) {
        const source =
          proof.in === 'route'
            ? (byKey.get(key)?.segment ?? '')
            : readFileSync(`${REPO_ROOT}${proof.in}`, 'utf8');
        if (!source.includes(proof.contains)) {
          failures.push(`${key}: '${proof.contains}' not found in ${proof.in}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the stronger classes carry the evidence that makes them stronger', () => {
    for (const [key, entry] of Object.entries(REST_MUTATION_CLASSES)) {
      if (entry.class === 'domain_governed') {
        // A domain-governed route must point at the DOMAIN invariant, not just RBAC.
        expect(
          entry.proof.some((proof) => proof.in !== 'route'),
          `${key} names no domain proof`,
        ).toBe(true);
      }
      if (entry.class === 'exempt') {
        expect(entry.justification, key).toMatch(/signature/i);
      }
    }
  });

  it('single-actor loosening and coarse capabilities are documented, not hidden', () => {
    expect(REST_MUTATION_CLASSES['PATCH /api/finance/budgets/:id']?.residual).toMatch(
      /single-actor/i,
    );
    expect(
      REST_MUTATION_CLASSES['POST /api/finance/budgets/:id/clear-review']?.residual,
    ).toBeTruthy();
    expect(REST_MUTATION_CLASSES['POST /api/problems/scan']?.justification).toMatch(/MUTATION/);
    expect(REST_MUTATION_CLASSES['POST /api/knowledge/articles']?.residual).toMatch(/coarse/i);
    expect(REST_MUTATION_CLASSES['POST /api/documents']?.residual).toMatch(/coarse/i);
    expect(REST_MUTATION_CLASSES['POST /api/integrations/email/inbound']?.class).toBe('exempt');
  });

  it('the Prompt 8 vocabulary stays derivable from the extended classes', () => {
    expect(legacyClassOf(REST_MUTATION_CLASSES['POST /api/finance/expenses']!)).toBe('rbac+policy');
    expect(legacyClassOf(REST_MUTATION_CLASSES['POST /api/ai/chat']!)).toBe('rbac+policy+approval');
    // Approve-time policy: the decide route now also consults the central policy.
    expect(legacyClassOf(REST_MUTATION_CLASSES['POST /api/finance/expenses/:id/decide']!)).toBe(
      'rbac+policy',
    );
    expect(legacyClassOf(REST_MUTATION_CLASSES['POST /api/calendar/events']!)).toBe('rbac');
  });
});
