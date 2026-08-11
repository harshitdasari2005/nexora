/**
 * Chat client tests for the approval decision surface: `decideApproval`
 * posts the decision to `POST /api/ai/approvals/:id/decision`, streams the
 * resumed execution for `approve` (SSE), resolves the rejection outcome for
 * `reject`, and surfaces HTTP/network failures through `onError`. Uses a
 * stubbed global fetch — no DOM or real network required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiError } from '../src/lib/api.js';
import { decideApproval, streamChat } from '../src/lib/chat.js';
import type { ChatApproval, ChatDone } from '../src/lib/chat.js';

/** Builds an SSE response body like the API route streams. */
function sseResponse(status = 'completed', approvals: unknown[] = []): Response {
  const body = [
    'event: meta',
    'data: {"runId":"run_1","conversationId":"conv_1","intent":"create a workspace called Payroll"}',
    '',
    'event: delta',
    'data: {"text":"Created "}',
    '',
    'event: done',
    `data: ${JSON.stringify({
      status,
      conversationId: 'conv_1',
      response: 'Created workspace Payroll.',
      steps: [
        {
          stepId: 'step_1',
          capabilityId: 'workspaces.create_workspace',
          toolId: 'workspaces.create_workspace',
          status,
        },
      ],
      approvals,
    })}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('decideApproval', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the decision to the approval endpoint with credentials', async () => {
    const fetchMock = vi.fn(async () => sseResponse());
    vi.stubGlobal('fetch', fetchMock);

    await decideApproval('apr_1', 'approve', {});
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/approvals/apr_1/decision',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
  });

  it('approve streams the resumed execution (deltas + done with approvals)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse('completed', [
          {
            id: 'apr_1',
            stepId: 'step_1',
            capabilityId: 'workspaces.create_workspace',
            toolId: 'workspaces.create_workspace',
            status: 'granted',
            sideEffectClass: 'consequential',
            input: { name: 'Payroll' },
          },
        ]),
      ),
    );

    const deltas: string[] = [];
    let done: ChatDone | undefined;
    await decideApproval('apr_1', 'approve', {
      onDelta: (text) => deltas.push(text),
      onDone: (payload) => {
        done = payload;
      },
    });

    expect(deltas.join('')).toBe('Created ');
    expect(done?.status).toBe('completed');
    expect(done?.approvals[0]).toMatchObject({ status: 'granted', input: { name: 'Payroll' } });
  });

  it('reject resolves the JSON outcome without streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ status: 'rejected', conversationId: 'conv_1', approvalId: 'apr_1' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    let streamed = false;
    const outcome = await decideApproval('apr_1', 'reject', {
      onDelta: () => {
        streamed = true;
      },
    });

    expect(outcome).toMatchObject({ status: 'rejected', approvalId: 'apr_1' });
    expect(streamed).toBe(false);
  });

  it('surfaces an authorization failure through onError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'AUTHORIZATION_ERROR', message: 'You are not the requester' },
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const errors: { status: number; code: string }[] = [];
    const outcome = await decideApproval('apr_1', 'approve', {
      onError: (error) => {
        // The client always normalizes to ApiError (status + canonical code).
        const apiError = error as ApiError;
        errors.push({ status: apiError.status, code: apiError.code });
      },
    });

    expect(outcome).toBeUndefined();
    expect(errors).toEqual([{ status: 403, code: 'AUTHORIZATION_ERROR' }]);
  });

  it('surfaces a not-found decision target through onError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Approval request not found' } }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const errors: { code: string }[] = [];
    await decideApproval('apr_unknown', 'approve', {
      onError: (error) => {
        errors.push({ code: (error as ApiError).code });
      },
    });
    expect(errors).toEqual([{ code: 'NOT_FOUND' }]);
  });

  it('surfaces network failures through onError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const errors: { code: string }[] = [];
    await decideApproval('apr_1', 'approve', {
      onError: (error) => {
        errors.push({ code: (error as ApiError).code });
      },
    });
    expect(errors).toEqual([{ code: 'NETWORK_ERROR' }]);
  });

  it('streamChat still parses approval payloads from the done event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse('blocked', [
          {
            id: 'apr_1',
            stepId: 'step_1',
            capabilityId: 'workspaces.create_workspace',
            toolId: 'workspaces.create_workspace',
            status: 'pending',
            sideEffectClass: 'consequential',
            input: { name: 'Payroll' },
          },
        ]),
      ),
    );

    let approvals: readonly ChatApproval[] | undefined;
    await streamChat(
      { message: 'Create a workspace called Payroll' },
      {
        onDone: (done) => {
          approvals = done.approvals;
        },
      },
    );

    expect(approvals).toHaveLength(1);
    expect(approvals?.[0]).toMatchObject({
      id: 'apr_1',
      status: 'pending',
      input: { name: 'Payroll' },
    });
  });
});
