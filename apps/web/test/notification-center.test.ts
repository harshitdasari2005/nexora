import { describe, expect, it } from 'vitest';

import { markAllReadRequest, markReadRequest } from '../src/components/NotificationCenter.js';

// S37: mark-read and mark-all-read used to call `api()` with no explicit
// method, which defaults `fetch` to GET — silently 404ing against the
// POST-only `apps/api/src/routes/notifications.ts` handlers while the UI
// optimistically showed "read" anyway. These pure request builders make
// the fix directly verifiable without rendering the component.
describe('markReadRequest', () => {
  it('targets the per-notification read endpoint with POST', () => {
    const [path, init] = markReadRequest('ntf_1');
    expect(path).toBe('/notifications/ntf_1/read');
    expect(init.method).toBe('POST');
  });
});

describe('markAllReadRequest', () => {
  it('targets the read-all endpoint with POST, preserving the scope suffix', () => {
    const [path, init] = markAllReadRequest('?organizationId=org_1&workspaceId=wsp_1');
    expect(path).toBe('/notifications/read-all?organizationId=org_1&workspaceId=wsp_1');
    expect(init.method).toBe('POST');
  });

  it('works with an empty scope suffix', () => {
    const [path, init] = markAllReadRequest('');
    expect(path).toBe('/notifications/read-all');
    expect(init.method).toBe('POST');
  });
});
