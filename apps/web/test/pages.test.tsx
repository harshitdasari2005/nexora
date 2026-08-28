/**
 * Server-render smoke tests: the key pages render without crashing and
 * expose their primary content. Uses `renderToString` — no DOM or network
 * required.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { Landing } from '../src/pages/Landing.js';
import { DashboardView } from '../src/pages/Dashboard.js';
import { OrganizationWizard } from '../src/pages/onboarding/OrganizationWizard.js';
import type { DashboardResponse } from '../src/lib/types.js';

function dashboardData(): DashboardResponse {
  return {
    user: {
      id: 'usr_1',
      email: 'alex@nexora.dev',
      username: 'alex',
      displayName: 'Alex Morgan',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    organization: {
      id: 'org_1',
      slug: 'acme',
      name: 'Acme Inc.',
      type: 'startup',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    workspace: {
      id: 'wsp_1',
      organizationId: 'org_1',
      slug: 'engineering',
      name: 'Engineering',
      type: 'engineering',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    installedApps: [],
    recentActivity: [],
  };
}

describe('Landing', () => {
  it('renders the hero and CTA', () => {
    const html = renderToString(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    expect(html).toContain('Orchestrated');
    expect(html).toContain('Get started');
    expect(html).toContain('Nexora');
  });

  // Regression guard: every entry point into the sign-in flow must go
  // STRAIGHT to the identity provider (`/api/auth/login`) — there is no
  // in-app `/login` screen. This is the "route renamed/removed during a
  // visual pass" class of defect. Landing has a header "Sign in" + header
  // "Get started" + the fallback pane's "Get started"; this suite renders
  // with no `window`, so Landing falls back to its single static pane:
  // 3 entry points total.
  it('every sign-in entry point goes straight to the identity provider', () => {
    const html = renderToString(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    expect(html).not.toContain('href="/login"');
    const hrefCount = (html.match(/href="\/api\/auth\/login"/g) ?? []).length;
    expect(hrefCount).toBe(3);
  });
});

describe('DashboardView', () => {
  it('renders user, organization, workspace, and empty states', () => {
    const html = renderToString(<DashboardView data={dashboardData()} />);
    expect(html).toContain('Alex');
    expect(html).toContain('Acme Inc.');
    expect(html).toContain('Engineering');
    expect(html).toContain('No apps installed yet');
    // The Recent activity section now renders the live ActivityFeed (a
    // read model): on first render it mounts in the loading state while the
    // authenticated fetch is in flight.
    expect(html).toContain('Recent activity');
    expect(html).toContain('Loading');
    expect(html).toContain('Nexora AI');
  });
});

describe('OrganizationWizard', () => {
  it('renders the organization form', () => {
    const html = renderToString(
      <MemoryRouter>
        <OrganizationWizard />
      </MemoryRouter>,
    );
    expect(html).toContain('Create your organization');
    expect(html).toContain('Organization name');
  });
});
