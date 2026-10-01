/**
 * Cross-workspace regression — every AppShell nav link carries the caller's
 * (membership-derived) scope, so pages never call APIs with a workspace the
 * caller is not a member of. The scope is the one `/api/dashboard` returned.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AppShell } from '../src/components/AppShell.js';
import type { UserDto } from '../src/lib/types.js';

const user = { id: 'usr_1', email: 'fin@nexora.dev', displayName: 'Fin' } as unknown as UserDto;

describe('AppShell scope propagation', () => {
  it('appends the member workspace id to every nav link and never another id', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/finance']}>
        <AppShell
          user={user}
          organizationName="Acme"
          workspaceName="Finance"
          organizationId="org_1"
          workspaceId="wsp_finance"
        >
          <div />
        </AppShell>
      </MemoryRouter>,
    );
    const hrefs = [...html.matchAll(/href="(\/app[^"]*)"/g)].map((m) => m[1] ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toContain('workspaceId=wsp_finance');
      expect(href).toContain('organizationId=org_1');
    }
    expect(html).not.toContain('wsp_executive');
  });
});
