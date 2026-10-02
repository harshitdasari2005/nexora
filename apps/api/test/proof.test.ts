/**
 * The safety-checks summary: it only reads the evaluation report, groups it
 * into claims a person can check, and shows no numbers when there is no report.
 */

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { summariseReport } from '../src/routes/proof.js';
import { buildTestApp, login } from './helpers.js';

const report = {
  dataset: { version: '2.0.1', scenarioCount: 6 },
  run: { finishedAt: '2026-10-02T14:48:41.266Z' },
  summary: {
    scenarios: { total: 6, passed: 5, failed: 1, known_gap: 0, error: 0 },
    unsupportedClaimRate: { claims: 66, unsupported: 0 },
    byCategory: {
      prompt_injection: { total: 2, passed: 2 },
      cross_organization_denial: { total: 1, passed: 1 },
      approval_bypass: { total: 2, passed: 1 },
      a_new_category: { total: 1, passed: 1 },
    },
  },
  gates: [{ id: 'safety', description: 'Safety-tagged scenarios with any failure', passed: true }],
  scenarios: [
    { title: 'A document tells the assistant to approve itself', category: 'prompt_injection' },
    {
      title: 'A manager asks for another company’s payroll',
      category: 'cross_organization_denial',
    },
    { title: 'An approval is skipped by asking nicely', category: 'approval_bypass' },
  ],
};

describe('the safety checks summary', () => {
  it('groups the scenarios into claims, with real examples and honest counts', () => {
    const summary = summariseReport(report);
    expect(summary).toMatchObject({
      ranAt: '2026-10-02T14:48:41.266Z',
      datasetVersion: '2.0.1',
      total: 6,
      passed: 5,
      failed: 1,
      claimsChecked: 66,
      unsupportedClaims: 0,
    });
    const claim = (key: string) => summary?.claims.find((entry) => entry.key === key);
    expect(claim('manipulation')).toMatchObject({
      total: 2,
      passed: 2,
      examples: ['A document tells the assistant to approve itself'],
    });
    // A failure is shown as a failure, not rounded away.
    expect(claim('approval')).toMatchObject({ total: 2, passed: 1 });
    // A claim with no scenarios in this run is left out; a new category still counts.
    expect(claim('failure')).toBeUndefined();
    expect(claim('a_new_category')).toMatchObject({ total: 1, title: 'a new category' });
    const counted = summary?.claims.reduce((sum, entry) => sum + entry.total, 0);
    expect(counted).toBe(6);
  });

  it('shows nothing rather than made-up numbers when the report is missing or unreadable', async () => {
    expect(summariseReport({})).toBeUndefined();
    const { registerProofRoutes } = await import('../src/routes/proof.js');
    const app = Fastify();
    app.decorateRequest('auth', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { auth: unknown }).auth = { userId: 'usr_1' };
    });
    registerProofRoutes(app, { readReport: async () => undefined });
    const response = await app.inject({ method: 'GET', url: '/api/proof' });
    expect(response.json()).toEqual({ available: false });
  });

  it('needs a session', async () => {
    const { app } = await buildTestApp();
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/proof' })).statusCode).toBe(401);
    const cookie = await login(app);
    const signedIn = await app.inject({ method: 'GET', url: '/api/proof', headers: { cookie } });
    expect(signedIn.statusCode).toBe(200);
    expect(typeof (signedIn.json() as { available: boolean }).available).toBe('boolean');
  });
});
