/**
 * Server-render smoke tests for the Audit Center: the pure `AuditView`
 * renders the summary, table, filters, and detail panel without crashing
 * (no DOM or network required — same convention as the other
 * `*-page.test.tsx` files).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { AuditView, EventDetail } from '../src/pages/Audit.js';
import type { AuditEventDto } from '../src/lib/types.js';

function auditEvent(overrides: Partial<AuditEventDto> = {}): AuditEventDto {
  return {
    id: 'agx:agx_1',
    source: 'agent_execution',
    occurredAt: '2026-08-20T10:00:00.000Z',
    actorId: 'usr_1',
    actorName: 'Arjun Mehta',
    roleId: 'executive.ceo',
    roleName: 'CEO',
    module: 'Executive',
    action: 'Review quarterly project health',
    status: 'completed',
    statusLabel: 'Completed',
    approvalRequired: false,
    ...overrides,
  };
}

describe('AuditView', () => {
  it('renders the header, summary counts, and table rows', () => {
    const html = renderToString(
      <AuditView
        organizationName="Acme Inc."
        workspaceName="Engineering"
        events={[
          auditEvent(),
          auditEvent({
            id: 'apr:apr_1',
            source: 'approval',
            action: 'Create a calendar event',
            status: 'approved',
            statusLabel: 'Approved',
            approvalRequired: true,
            roleId: undefined,
            roleName: undefined,
          }),
        ]}
        loading={false}
        onRefresh={() => undefined}
      />,
    );
    expect(html).toContain('Audit Center');
    expect(html).toContain('Acme Inc.');
    expect(html).toContain('Engineering');
    expect(html).toContain('Review quarterly project health');
    expect(html).toContain('Create a calendar event');
    expect(html).toContain('Arjun Mehta');
    expect(html).toContain('CEO');
    expect(html).toContain('Completed');
    expect(html).toContain('Approved');
    // Summary counts.
    expect(html).toContain('Total events');
    expect(html).toContain('Agent runs');
    expect(html).toContain('Approvals');
  });

  it('renders an honest empty state when there are no events', () => {
    const html = renderToString(
      <AuditView
        organizationName="Acme Inc."
        workspaceName="Engineering"
        events={[]}
        loading={false}
        onRefresh={() => undefined}
      />,
    );
    expect(html).toContain('No audit events');
  });

  it('renders the "select an event" prompt when nothing is selected', () => {
    const html = renderToString(
      <AuditView
        organizationName="Acme Inc."
        workspaceName="Engineering"
        events={[auditEvent()]}
        loading={false}
        onRefresh={() => undefined}
      />,
    );
    expect(html).toContain('Select an event');
  });
});

describe('EventDetail', () => {
  it('renders actor, role, module, timestamp, and approval requirement', () => {
    const html = renderToString(<EventDetail event={auditEvent()} />);
    expect(html).toContain('Arjun Mehta');
    expect(html).toContain('CEO');
    expect(html).toContain('Executive');
    expect(html).toContain('Approval required');
    expect(html).toContain('No');
  });

  it('renders the approval outcome section when present', () => {
    const html = renderToString(
      <EventDetail
        event={auditEvent({
          approvalRequired: true,
          approvalOutcome: {
            status: 'approved',
            statusLabel: 'Approved',
            decidedByName: 'Priya Sharma',
            decisionReason: 'Looks good',
          },
        })}
      />,
    );
    expect(html).toContain('Approval outcome');
    expect(html).toContain('Priya Sharma');
    expect(html).toContain('Looks good');
  });

  it('renders an error message when the event recorded one', () => {
    const html = renderToString(
      <EventDetail
        event={auditEvent({ status: 'failed', statusLabel: 'Failed', error: 'Timed out' })}
      />,
    );
    expect(html).toContain('Timed out');
  });

  it('renders reference ids only in the detail panel, labeled', () => {
    const html = renderToString(
      <EventDetail
        event={auditEvent({ references: { runId: 'run_123', agentId: 'agent_ceo' } })}
      />,
    );
    expect(html).toContain('References');
    expect(html).toContain('run_123');
  });

  it('never renders a role row when the source has no role', () => {
    const html = renderToString(
      <EventDetail
        event={auditEvent({
          source: 'activity',
          roleId: undefined,
          roleName: undefined,
          action: 'Project created',
          module: 'Project',
        })}
      />,
    );
    expect(html).not.toContain('>Role<');
  });
});
