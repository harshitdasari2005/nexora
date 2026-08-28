/**
 * Integrations page — capability-aware management controls (P2-3).
 *
 * The Integrations nav module is visible to every workspace member (reads
 * are scope-only), but the webhook CREATE / enable / disable / delete
 * routes require `integrations.manage`. Before this pass, the management
 * controls rendered for everyone and only failed with a 403 after a click.
 * These smoke tests pin the fix: a caller without the capability sees a
 * clear read-only explanation instead of active controls; a caller with it
 * keeps the full surface. Backend authorization is unchanged and remains
 * the real boundary (see apps/api/test/rbac-*.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { IntegrationsView } from '../src/pages/Integrations.js';
import type { WebhookRegistryResponse } from '../src/lib/types.js';

const REGISTRY: WebhookRegistryResponse = {
  subscribableEvents: ['project.created', 'employee.hired'],
  endpoints: [
    {
      id: 'whk_1',
      url: 'https://example.com/hooks/nexora',
      eventTypes: ['project.created'],
      enabled: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      secretMasked: 'whk_abcd…',
    },
  ],
};

function render(canManage: boolean): string {
  return renderToString(
    <IntegrationsView
      organizationId="org_1"
      workspaceId="wsp_1"
      organizationName="Acme Inc."
      canManage={canManage}
      initialRegistry={REGISTRY}
      initialEmails={[]}
    />,
  );
}

describe('IntegrationsView — management gating (P2-3)', () => {
  it('shows the webhook creator and per-row controls to a caller WITH integrations.manage', () => {
    const html = render(true);
    expect(html).toContain('Create a webhook endpoint');
    expect(html).toContain('Disable'); // the enabled endpoint's toggle
    expect(html).toContain('Delete');
    expect(html).not.toContain('Webhook management requires an administrator');
  });

  it('replaces active controls with a read-only explanation for a caller WITHOUT the capability', () => {
    const html = render(false);
    // No misleading active management controls.
    expect(html).not.toContain('Create a webhook endpoint');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('Disable');
    // A clear administrator-required explanation instead.
    expect(html).toContain('Webhook management requires an administrator');
    expect(html).toContain('Read-only · managed by an administrator');
    // Read surfaces still render.
    expect(html).toContain('https://example.com/hooks/nexora');
    expect(html).toContain('Show delivery receipts');
  });
});
