/**
 * Problems page smoke tests (server render, no DOM or network required).
 * Mirrors the Agent page's smoke-test convention: a preloaded `initialProblems`
 * prop bypasses the network fetch so the page's states render deterministically.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { ProblemsView } from '../src/pages/Problems.js';
import type { BusinessProblemDto } from '../src/lib/types.js';

function problem(overrides: Partial<BusinessProblemDto> = {}): BusinessProblemDto {
  return {
    id: 'prb_1',
    correlationId: 'workflow_failure:org_1:wsp_1:employee-onboarding',
    signalId: 'workflow_failure',
    signalName: 'Workflow failure',
    tenantId: 'org_1',
    workspaceId: 'wsp_1',
    title: 'employee-onboarding requires attention',
    description: 'employee-onboarding failed 6 times in the last 24 hours.',
    severity: 'high',
    status: 'DETECTED',
    detectedAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    affectedEntities: [
      { type: 'workflow', id: 'employee-onboarding', title: 'employee-onboarding' },
    ],
    evidence: [
      {
        id: 'evd_1',
        source: 'measurements',
        entityType: 'workflow',
        entityId: 'employee-onboarding',
        fact: 'employee-onboarding failed 6 times (75% success rate).',
      },
    ],
    rootCauses: [
      {
        explanation: 'The workflow never reaches a recoverable state.',
        supportingEvidenceIds: ['evd_1'],
        confidence: 'MEDIUM',
        kind: 'INFERENCE',
        nextStep: 'Inspect the failed instances.',
      },
    ],
    solutions: [
      {
        id: 'sol_1',
        source: 'knowledge',
        title: 'AUTH-017 Authentication correction',
        description: 'Correct the authentication configuration.',
        reference: { id: 'art_1', title: 'AUTH-017 Authentication correction' },
        applicability: 'APPLICABLE',
        confidence: 'HIGH',
        requiredCapabilities: ['workflow.retry_run'],
      },
    ],
    recommendation: {
      summary:
        'Known solution found: knowledge article art_1 ("AUTH-017 Authentication correction").',
      groundedIn: 'art_1',
    },
    ...overrides,
  };
}

function renderView(
  initialProblems: readonly BusinessProblemDto[] | undefined,
  initialExpandedId?: string | null,
): string {
  return renderToString(
    <MemoryRouter>
      <ProblemsView
        organizationId="org_1"
        workspaceId="wsp_1"
        organizationName="Acme Inc."
        userDisplayName="Alex Morgan"
        initialProblems={initialProblems}
        initialExpandedId={initialExpandedId}
      />
    </MemoryRouter>,
  );
}

describe('ProblemsView (Phase 10 hero flow)', () => {
  it('renders the loading state while resolving problems', () => {
    const html = renderView(undefined);
    expect(html).toContain('Scanning your workspace');
  });

  it('renders an honest empty state when nothing is detected', () => {
    const html = renderView([]);
    expect(html).toContain('No problems detected');
  });

  it('renders a detected problem summary row', () => {
    const html = renderView([problem()]);
    expect(html).toContain('Problems');
    // S36: the display humanization layer normalizes "requires attention"
    // to "needs attention" — same underlying problem, humanized copy.
    expect(html).toContain('employee-onboarding needs attention');
    expect(html).toContain('high');
    expect(html).toContain('DETECTED');
  });

  it('renders the full investigation and the remediation plan entry point when expanded', () => {
    const html = renderView([problem()], 'prb_1');
    // Evidence (What happened), root-cause candidates (FACT vs INFERENCE,
    // Why it matters), known solutions.
    expect(html).toContain('What happened');
    expect(html).toContain('failed 6 times (75% success rate)');
    expect(html).toContain('Why it matters');
    expect(html).toContain('INFERENCE');
    expect(html).toContain('Known solutions');
    expect(html).toContain('APPLICABLE');
    // The remediation plan section is reachable from every expanded problem.
    expect(html).toContain('Remediation plan');
  });

  it('does not expand a problem by default (collapsed until opened)', () => {
    const html = renderView([problem()]);
    expect(html).not.toContain('Remediation plan');
    expect(html).toContain('Investigate');
  });
});
