/**
 * S24 Phase 2 — Command Center page smoke tests (server render, no DOM or
 * network required). One generic page renders every role's center: the CEO,
 * Manager, and Developer configurations all flow through the SAME
 * CommandCenterView + widget renderer registry — there is no role-specific
 * page anywhere. Loading, empty, and success states are covered; the error
 * state renders through the shared ErrorState component (same convention as
 * the other application views).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { CommandCenterView, composeBrief } from '../src/pages/CommandCenter.js';
import type { BusinessProblemDto, CommandCenterDto } from '../src/lib/types.js';

function center(overrides: Partial<CommandCenterDto> = {}): CommandCenterDto {
  return {
    id: 'ceo',
    name: 'Command Center',
    domainId: 'executive',
    domainName: 'Executive',
    roleId: 'executive.ceo',
    roleName: 'CEO',
    description: 'Organization-level visibility: what requires executive attention.',
    widgets: [
      {
        id: 'projects_kpi',
        type: 'kpi',
        title: 'Projects',
        span: 1,
      },
      {
        id: 'workflow_health',
        type: 'list',
        title: 'Workflow health',
        span: 2,
      },
      {
        id: 'attention',
        type: 'attention',
        title: 'Needs your attention',
        span: 2,
      },
      {
        id: 'activity',
        type: 'activity',
        title: 'Recent activity',
        span: 2,
      },
    ],
    actions: [
      { id: 'view_projects', label: 'View projects', kind: 'navigate', href: '/app/projects' },
      { id: 'view_insights', label: 'View insights', kind: 'navigate', href: '/app/insights' },
    ],
    data: {
      projects_kpi: { kind: 'kpi', value: '7', hint: 'Projects across the tenant' },
      workflow_health: {
        kind: 'list',
        items: [
          {
            id: 'employee-onboarding',
            title: 'employee-onboarding',
            subtitle: '3/4 terminal runs',
            status: '75% success',
          },
        ],
      },
      attention: {
        kind: 'attention',
        items: [
          {
            id: 'ntf_1',
            title: 'Approval needed',
            body: 'A workflow step is waiting for your decision.',
            priority: 'high',
            href: '/app/workflows',
          },
        ],
      },
      activity: {
        kind: 'activity',
        items: [
          {
            id: 'act_1',
            title: 'Project created',
            body: 'Alpha Platform',
            occurredAt: '2026-08-15T08:00:00.000Z',
          },
        ],
      },
    },
    ...overrides,
  };
}

function renderView(initialCenter: CommandCenterDto | null | undefined): string {
  return renderToString(
    <MemoryRouter>
      <CommandCenterView
        organizationId="org_1"
        workspaceId="wsp_1"
        organizationName="Acme Inc."
        initialCenter={initialCenter}
      />
    </MemoryRouter>,
  );
}

describe('CommandCenterView (S24 Phase 2)', () => {
  it('renders the loading state while composing the center', () => {
    // No initialCenter → the view mounts in the loading state (no fetch in
    // server render, matching the ActivityFeed loading-state convention).
    const html = renderView(undefined);
    expect(html).toContain('Composing your command center');
  });

  it('renders the CEO configuration through the generic page', () => {
    const html = renderView(center());
    // The eyebrow reflects the resolved role's theme identity (S33); this
    // test renders CommandCenterView outside a RoleThemeProvider, so it
    // resolves the safe default theme, not a fabricated CEO-specific string.
    expect(html).toContain('Business Intelligence');
    expect(html).toContain('CEO');
    // S36: the role badge shows the curated persona label (from the
    // center's own `roleId`, resolved independent of the role-context
    // fetch) — "CEO · Business & Strategy" — not the raw domain name.
    // (renderToString HTML-encodes "&" as "&amp;".)
    expect(html).toContain('Business &amp; Strategy');
    // Real measurement KPI value flows into the shared KPI renderer.
    expect(html).toContain('7');
    // Workflow health list renders real data with status badges.
    expect(html).toContain('employee-onboarding');
    expect(html).toContain('75% success');
    // Actions render as navigation buttons.
    expect(html).toContain('View projects');
    expect(html).toContain('View insights');
  });

  it('renders the Manager configuration through the same page', () => {
    const manager = center({
      id: 'manager',
      domainId: 'delivery',
      domainName: 'Delivery',
      roleId: 'delivery.manager',
      roleName: 'Manager',
      description: 'Team and execution focus.',
      widgets: [
        { id: 'team_kpi', type: 'kpi', title: 'Team members', span: 1 },
        { id: 'projects', type: 'list', title: 'Projects', span: 2 },
      ],
      actions: [
        { id: 'view_team', label: 'View employees', kind: 'navigate', href: '/app/employees' },
      ],
      data: {
        team_kpi: { kind: 'kpi', value: '4', hint: 'Active employees' },
        projects: {
          kind: 'list',
          items: [
            { id: 'prj_1', title: 'Alpha Platform', status: 'active', href: '/app/projects' },
            { id: 'prj_2', title: 'Beta Service', status: 'on_hold', href: '/app/projects' },
          ],
        },
      },
    });
    const html = renderView(manager);
    expect(html).toContain('Manager');
    expect(html).toContain('Delivery');
    expect(html).toContain('Team members');
    expect(html).toContain('Alpha Platform');
    expect(html).toContain('View employees');
  });

  it('renders the Developer configuration through the same page', () => {
    const developer = center({
      id: 'developer',
      domainId: 'technology',
      domainName: 'Technology',
      roleId: 'technology.developer',
      roleName: 'Developer',
      description: 'Individual execution.',
      widgets: [
        { id: 'documents', type: 'list', title: 'Documents', span: 2 },
        { id: 'knowledge', type: 'list', title: 'Knowledge', span: 2 },
      ],
      actions: [
        { id: 'view_documents', label: 'View documents', kind: 'navigate', href: '/app/documents' },
      ],
      data: {
        documents: {
          kind: 'list',
          items: [{ id: 'doc_1', title: 'Sprint Notes', status: 'available' }],
        },
        knowledge: {
          kind: 'list',
          items: [{ id: 'art_1', title: 'Onboarding Guide', status: 'published' }],
        },
      },
    });
    const html = renderView(developer);
    expect(html).toContain('Developer');
    expect(html).toContain('Technology');
    expect(html).toContain('Sprint Notes');
    expect(html).toContain('Onboarding Guide');
  });

  it('renders all four widget types through the shared renderer registry', () => {
    const html = renderView(center());
    // KPI renderer.
    expect(html).toContain('Projects across the tenant');
    // List renderer.
    expect(html).toContain('employee-onboarding');
    // Attention renderer (unread notification with a destination).
    expect(html).toContain('Approval needed');
    // Activity renderer.
    expect(html).toContain('Project created');
    expect(html).toContain('Alpha Platform');
  });

  it('renders honest empty widget states when data is absent', () => {
    const emptyData = center({
      data: {
        projects_kpi: { kind: 'kpi', value: '0', hint: 'Projects across the tenant' },
        workflow_health: { kind: 'list', items: [] },
        attention: { kind: 'attention', items: [] },
        activity: { kind: 'activity', items: [] },
      },
    });
    const html = renderView(emptyData);
    // Empty list/attention/activity widgets show honest empty states — no
    // fabricated numbers.
    expect(html).toContain('Nothing here yet');
    expect(html).toContain('You');
    expect(html).toContain('No activity yet');
  });

  it('renders the empty state when no command center is configured', () => {
    const html = renderView(null);
    expect(html).toContain('No command center yet');
  });

  it('does not render role-specific page structure (one generic page)', () => {
    const html = renderView(center());
    // No CEOPage/ManagerPage/DeveloperPage markers exist in the markup.
    expect(html).not.toContain('CEOPage');
    expect(html).not.toContain('ManagerPage');
    expect(html).not.toContain('DeveloperPage');
  });
});

describe('composeBrief — attention-request failure (P2-1)', () => {
  function highProblem(): BusinessProblemDto {
    return {
      id: 'prb_1',
      severity: 'high',
      status: 'DETECTED',
      title: 'Workflow failing',
    } as unknown as BusinessProblemDto;
  }

  it('claims "operating normally" only when the problems list really loaded empty', () => {
    const brief = composeBrief('Acme Inc.', center(), [], false);
    expect(brief).toContain('operating normally');
    expect(brief).toContain('nothing needs your attention');
  });

  it('reports real open-issue counts when the problems list loaded with data', () => {
    const brief = composeBrief('Acme Inc.', center(), [highProblem()], false);
    expect(brief).toContain('1 open issue');
    expect(brief).toContain('require immediate attention');
  });

  it('does NOT claim "nothing needs your attention" when the problems request failed', () => {
    const brief = composeBrief('Acme Inc.', center(), null, true);
    expect(brief).not.toContain('operating normally');
    expect(brief).not.toContain('nothing needs your attention');
  });

  it('states the attention items could not be loaded when the request failed', () => {
    const brief = composeBrief('Acme Inc.', center(), null, true);
    expect(brief.toLowerCase()).toContain('could not be loaded');
    expect(brief.toLowerCase()).toContain('retry');
  });
});
