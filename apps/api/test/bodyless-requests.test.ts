/**
 * A POST with NO body used to reach `body.organizationId` on `undefined` in two
 * handlers, a TypeError that surfaced as HTTP 500. A malformed client request is a
 * 400 (missing required fields), never a server error.
 */

import { describe, expect, it } from 'vitest';

import { chatClient } from './helpers.js';

describe('body-less POST requests are rejected as 400, not 500', () => {
  it.each(['/api/documents/doc_x/archive', '/api/calendar/events/evt_x/cancel'])(
    'POST %s with no body',
    async (url) => {
      const client = await chatClient();
      const response = await client.app.inject({
        method: 'POST',
        url,
        headers: { cookie: client.session },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      await client.app.close();
    },
  );
});
