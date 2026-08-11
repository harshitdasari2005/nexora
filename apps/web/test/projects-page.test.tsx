/**
 * Server-render smoke tests for the Projects application: the pure
 * `ProjectsView` renders projects, empty, and status states without crashing
 * (no DOM or network required — same convention as pages.test.tsx).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { ProjectRow, ProjectsView, ProjectStatusBadge } from '../src/pages/Projects.js';
import type { ProjectDto } from '../src/lib/types.js';

const ORGANIZATION = 'org_acme';

function project(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: 'prj_1',
    organizationId: ORGANIZATION,
    name: 'Mobile Banking',
    description: 'Core banking app',
    status: 'active',
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProjectsView', () => {
  it('renders the page header, org context, and project rows', () => {
    const html = renderToString(
      <ProjectsView
        organizationId={ORGANIZATION}
        organizationName="Acme Inc."
        initialProjects={[project(), project({ id: 'prj_2', name: 'Payroll', status: 'proposed' })]}
        onCreated={() => undefined}
      />,
    );
    expect(html).toContain('Projects');
    expect(html).toContain('Acme Inc.');
    expect(html).toContain('Mobile Banking');
    expect(html).toContain('Payroll');
    expect(html).toContain('Active');
    expect(html).toContain('Proposed');
  });

  it('renders the empty state when there are no projects', () => {
    const html = renderToString(
      <ProjectsView
        organizationId={ORGANIZATION}
        organizationName="Acme Inc."
        initialProjects={[]}
        onCreated={() => undefined}
      />,
    );
    expect(html).toContain('No projects yet');
    // No project rows render (0 projects badge, not per-row markup).
    expect(html).toContain('0<!-- --> <!-- -->projects');
    expect(html).not.toContain('>Payroll</div>');
  });

  it('renders the create form', () => {
    const html = renderToString(
      <ProjectsView
        organizationId={ORGANIZATION}
        organizationName="Acme Inc."
        initialProjects={[]}
        onCreated={() => undefined}
      />,
    );
    expect(html).toContain('New project');
    expect(html).toContain('Create project');
  });
});

describe('ProjectRow', () => {
  it('renders name, description, status, and created date', () => {
    const html = renderToString(<ProjectRow project={project()} />);
    expect(html).toContain('Mobile Banking');
    expect(html).toContain('Core banking app');
    expect(html).toContain('Active');
  });

  it('renders a no-description hint when absent', () => {
    const html = renderToString(<ProjectRow project={project({ description: undefined })} />);
    expect(html).toContain('No description');
  });
});

describe('ProjectStatusBadge', () => {
  it('renders every lifecycle status label', () => {
    expect(renderToString(<ProjectStatusBadge status="active" />)).toContain('Active');
    expect(renderToString(<ProjectStatusBadge status="proposed" />)).toContain('Proposed');
    expect(renderToString(<ProjectStatusBadge status="on_hold" />)).toContain('On hold');
    expect(renderToString(<ProjectStatusBadge status="completed" />)).toContain('Completed');
    expect(renderToString(<ProjectStatusBadge status="archived" />)).toContain('Archived');
    expect(renderToString(<ProjectStatusBadge status="cancelled" />)).toContain('Cancelled');
  });
});
