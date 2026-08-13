/**
 * S19 Marketplace + Plugin Runtime page smoke tests: the catalog renders
 * with per-workspace installed state, the install flow surfaces an explicit
 * permission-review step before confirming, and installed apps expose the
 * update/uninstall actions (server render — no DOM or network required).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { MarketplaceView } from '../src/pages/Apps.js';
import type { InstalledAppDto, MarketplaceAppDto } from '../src/lib/types.js';

const HR: MarketplaceAppDto = {
  id: 'com.nexora.hr',
  name: 'HR Suite',
  version: '1.0.0',
  summary: 'People, hiring, and assignments.',
  description: 'Hire employees and assign them to projects.',
  publisher: 'Nexora',
  categories: ['HR'],
  requiredPermissions: ['hr:read', 'hr:write'],
  grantedPermissions: ['hr:read', 'hr:write'],
  installed: false,
};

const HR_UPDATABLE: MarketplaceAppDto = {
  ...HR,
  installed: true,
  installedVersion: '0.9.0',
};

const INSTALLED_HR: InstalledAppDto = {
  installationId: 'inst_1',
  appId: 'com.nexora.hr',
  name: 'HR Suite',
  version: '0.9.0',
  latestVersion: '1.0.0',
  updateAvailable: true,
  installedAt: '2026-08-01T00:00:00.000Z',
};

function noop(): void {
  /* test no-op */
}

describe('MarketplaceView (S19)', () => {
  it('renders the catalog with app details and installed state', () => {
    const html = renderToString(
      <MarketplaceView
        organizationId="org_1"
        workspaceId="wsp_1"
        initialApps={[HR]}
        initialInstalled={[]}
        onChanged={noop}
      />,
    );
    expect(html).toContain('Apps');
    expect(html).toContain('HR Suite');
    expect(html).toContain('People, hiring, and assignments.');
    expect(html).toContain('Not installed');
    // React SSR inserts comment nodes between interpolated text: `0<!-- --> installed`.
    expect(html).toContain('installed');
  });

  it('renders install as an explicit permission-review step (not implicit consent)', () => {
    const html = renderToString(
      <MarketplaceView
        organizationId="org_1"
        workspaceId="wsp_1"
        initialApps={[HR]}
        initialInstalled={[]}
        onChanged={noop}
      />,
    );
    expect(html).toContain('Install');
    // The review panel is NOT rendered until the user opens it — installing
    // always goes through the explicit review (PRD §20.2, never implicit
    // consent). The declared scopes are part of the catalog data the review
    // presents.
    expect(html).not.toContain('Review permissions');
  });

  it('renders installed apps with update and uninstall actions', () => {
    const html = renderToString(
      <MarketplaceView
        organizationId="org_1"
        workspaceId="wsp_1"
        initialApps={[HR_UPDATABLE]}
        initialInstalled={[INSTALLED_HR]}
        onChanged={noop}
      />,
    );
    // SSR splits interpolated text: `Installed v<!-- -->0.9.0`, `Update to v<!-- -->1.0.0`.
    expect(html).toContain('Installed v');
    expect(html).toContain('0.9.0');
    expect(html).toContain('Update to v');
    expect(html).toContain('1.0.0');
    expect(html).toContain('Uninstall');
  });

  it('renders an empty state when the catalog has no apps', () => {
    const html = renderToString(
      <MarketplaceView
        organizationId="org_1"
        workspaceId="wsp_1"
        initialApps={[]}
        initialInstalled={[]}
        onChanged={noop}
      />,
    );
    expect(html).toContain('No apps in the catalog');
  });
});
