/**
 * @nexora/module-detection — solution discovery tests (S27).
 *
 * S27 §20 SOLUTIONS 14–18: knowledge discovery, document discovery,
 * previous-execution discovery, applicability (FOUND ≠ APPLICABLE), and the
 * explicit no-solution case.
 */

import { describe, expect, it } from 'vitest';

import { SolutionDiscovery } from '../src/application/solution-discovery.js';
import { BusinessProblem } from '../src/domain/problem.js';
import { emptySnapshot, entity, fixedSolutionSources } from './helpers.js';

function problem() {
  return BusinessProblem.create({
    id: 'prb_1',
    correlationId: 'workflow_failure:org_tenant_a:ws_dev:wf_auth',
    signalId: 'workflow_failure',
    tenantId: 'org_tenant_a',
    workspaceId: 'ws_dev',
    title: 'wf_auth requires attention',
    description: 'wf_auth failed 6 times.',
    severity: 'high',
    detectedAt: '2026-08-16T12:00:00.000Z',
    affectedEntities: [entity({ id: 'wf_auth', title: 'wf_auth' })],
  });
}

const snapshot = emptySnapshot({ workspaceId: 'ws_dev' });

describe('SolutionDiscovery', () => {
  it('finds an applicable knowledge solution when the entity matches', async () => {
    const discovery = new SolutionDiscovery(
      fixedSolutionSources({
        knowledge: [
          {
            sourceId: 'kno_auth017',
            title: 'AUTH-017 Authentication correction',
            snippet: 'When the wf_auth workflow fails, correct the authentication configuration.',
            kind: 'article',
          },
        ],
      }),
    );
    const outcome = await discovery.discover(problem(), snapshot);
    expect(outcome.foundApplicable).toBe(true);
    expect(outcome.solutions[0]).toMatchObject({
      source: 'knowledge',
      applicability: 'APPLICABLE',
      reference: { id: 'kno_auth017', title: expect.any(String) },
    });
    expect(outcome.evidence[0]).toMatchObject({ source: 'knowledge', entityId: 'kno_auth017' });
  });

  it('FOUND ≠ APPLICABLE: a keyword-only document is found but rejected', async () => {
    const discovery = new SolutionDiscovery(
      fixedSolutionSources({
        knowledge: [
          {
            sourceId: 'doc_generic',
            title: 'Company handbook',
            snippet: 'Mentions authentication as a general topic.',
            kind: 'document',
          },
        ],
      }),
    );
    const outcome = await discovery.discover(problem(), snapshot);
    expect(outcome.solutions).toHaveLength(1);
    expect(outcome.solutions[0]).toMatchObject({
      source: 'documents',
      applicability: 'REJECTED',
    });
    expect(outcome.solutions[0]?.rejectionReason).toContain('does not clearly concern');
    expect(outcome.foundApplicable).toBe(false);
  });

  it('uses previous completed executions as precedents, not failed ones', async () => {
    const discovery = new SolutionDiscovery(
      fixedSolutionSources({
        executions: [
          { id: 'run_ok', proposalAction: 'review wf_auth', status: 'completed' },
          { id: 'run_bad', proposalAction: 'review wf_auth', status: 'failed' },
        ],
      }),
    );
    const outcome = await discovery.discover(problem(), snapshot);
    const bySource = outcome.solutions.filter((solution) => solution.source === 'agent_executions');
    expect(bySource).toHaveLength(2);
    expect(bySource[0]).toMatchObject({ applicability: 'APPLICABLE' });
    expect(bySource[1]).toMatchObject({ applicability: 'FOUND' });
    expect(outcome.foundApplicable).toBe(true);
  });

  it('reports the explicit no-solution case without inventing one', async () => {
    const discovery = new SolutionDiscovery(fixedSolutionSources());
    const outcome = await discovery.discover(problem(), snapshot);
    expect(outcome.solutions).toEqual([]);
    expect(outcome.foundApplicable).toBe(false);
  });

  it('fails safe when a source errors — discovery still returns', async () => {
    const discovery = new SolutionDiscovery({
      async searchKnowledge() {
        throw new Error('knowledge down');
      },
      async listExecutions() {
        throw new Error('journal down');
      },
    });
    const outcome = await discovery.discover(problem(), snapshot);
    expect(outcome.solutions).toEqual([]);
    expect(outcome.foundApplicable).toBe(false);
  });
});
