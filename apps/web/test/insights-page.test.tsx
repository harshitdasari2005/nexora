/**
 * S23 Insights page smoke tests: the metric sections (workflow health,
 * onboarding, audit completeness, tenant overview), empty states, and
 * pilot-bar badges render without crashing (server render — no DOM or
 * network required).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { InsightsView } from '../src/pages/Insights.js';
import type { TenantMeasurementsDto } from '../src/lib/types.js';

const MEASUREMENTS: TenantMeasurementsDto = {
  tenantId: 'org_1',
  generatedAt: '2026-08-13T00:00:00.000Z',
  workflowHealth: [
    {
      definitionKey: 'employee-onboarding',
      total: 10,
      succeeded: 9,
      failed: 1,
      successRate: 90,
      unrecoverableErrorRate: 10,
      cycleTimeP50Ms: 12_000,
      cycleTimeP95Ms: 40_000,
    },
  ],
  onboarding: [
    {
      userId: 'usr_1',
      email: 'alex@nexora.dev',
      signedUpAt: '2026-08-01T00:00:00.000Z',
      firstWorkflowAt: '2026-08-01T00:15:00.000Z',
      timeToFirstWorkflowMs: 900_000,
    },
  ],
  auditCompleteness: {
    traceableShare: 90,
    totalEvents: 10,
    tracedEvents: 9,
    untracedTypes: ['employee-offboarding'],
  },
  overview: {
    users: 2,
    workspaces: 1,
    projects: 3,
    documents: 5,
    knowledgeSources: 4,
    calendarEvents: 6,
  },
};

function renderView(initialMeasurements: TenantMeasurementsDto | null = MEASUREMENTS): string {
  return renderToString(
    <InsightsView
      organizationId="org_1"
      workspaceId="wsp_1"
      organizationName="Acme Inc."
      initialMeasurements={initialMeasurements}
    />,
  );
}

describe('InsightsView (S23)', () => {
  it('renders the four pilot metric sections', () => {
    const html = renderView();
    expect(html).toContain('Insights');
    expect(html).toContain('Workflow health');
    expect(html).toContain('Onboarding');
    expect(html).toContain('Audit completeness');
    expect(html).toContain('Tenant overview');
  });

  it('renders workflow health with the success and error bars', () => {
    const html = renderView();
    expect(html).toContain('employee-onboarding');
    // React inserts comment separators between adjacent text nodes, so
    // assertions target the parts that never cross a node boundary.
    expect(html).toContain('90.0%');
    expect(html).toContain('10.0%');
    expect(html).toContain('terminal runs');
    expect(html).toContain('cycle time p50');
    expect(html).toContain('1min');
  });

  it('renders onboarding time-to-first-workflow per user', () => {
    const html = renderView();
    expect(html).toContain('alex@nexora.dev');
    expect(html).toContain('15min');
  });

  it('renders audit completeness with untraced types', () => {
    const html = renderView();
    expect(html).toContain('90.0%');
    expect(html).toContain('business executions have an audit-trail entry');
    expect(html).toContain('employee-offboarding');
  });

  it('renders the tenant overview counts', () => {
    const html = renderView();
    expect(html).toContain('Workspaces');
    expect(html).toContain('Knowledge sources');
  });

  it('renders an empty state when there are no measurements yet', () => {
    const html = renderView(null);
    expect(html).toContain('No measurements yet');
  });
});
