/**
 * ListWorkspacesTool security unit tests.
 *
 * The tool's security contract (hardening pass): identity (`userId`) and
 * tenant scope (`tenantId`) come EXCLUSIVELY from the trusted execution
 * context assembled by the runtime from the authenticated session. The model
 * may request the action ("list workspaces") but may never define whose
 * workspaces or where — any forged identity fields in the input are ignored.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Result } from '@nexora/shared/result';
import type { ListMyWorkspacesHandler, WorkspaceDto } from '@nexora/application-workspaces';

import { ListWorkspacesTool } from '../src/ai/tools/list-workspaces-tool.js';
import type { ListWorkspacesInput } from '../src/ai/tools/list-workspaces-tool.js';

const AUTHORIZED: WorkspaceDto = {
  id: 'wsp_engineering',
  organizationId: 'org_acme',
  slug: 'engineering',
  name: 'Engineering',
  type: 'engineering',
  status: 'active',
  createdAt: '2026-08-08T00:00:00.000Z',
};

function handlerReturning(result: Result<readonly WorkspaceDto[], never>): ListMyWorkspacesHandler {
  // The handler class carries private state; the fake satisfies the public
  // contract (structural) for tests.
  return { handle: vi.fn(async () => result) } as unknown as ListMyWorkspacesHandler;
}

const trustedContext = {
  userId: 'usr_alice',
  tenantId: 'org_acme',
  executionId: 'run_1',
};

describe('ListWorkspacesTool (trusted context vs model arguments)', () => {
  it('uses the trusted context identity, never model-supplied arguments', async () => {
    const handler = handlerReturning({ ok: true, value: [AUTHORIZED] });
    const tool = new ListWorkspacesTool(handler);

    // The model supplies forged identity fields; they must be ignored.
    const input = {
      userId: 'usr_hacker',
      tenantId: 'org_hacker',
      workspaceId: 'wsp_alien',
    } as unknown as ListWorkspacesInput;

    const result = await tool.execute(input, trustedContext);
    expect(result.ok).toBe(true);
    expect(handler.handle).toHaveBeenCalledWith({
      userId: 'usr_alice',
      organizationId: 'org_acme',
    });
  });

  it('delegates to the application layer with the empty input contract', async () => {
    const handler = handlerReturning({ ok: true, value: [AUTHORIZED] });
    const tool = new ListWorkspacesTool(handler);

    const result = await tool.execute({}, trustedContext);
    expect(result.ok).toBe(true);
    expect(result.output?.workspaces).toEqual([AUTHORIZED]);
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });

  it('never lets the caller-supplied scope override the trusted tenant', async () => {
    const handler = handlerReturning({ ok: true, value: [AUTHORIZED] });
    const tool = new ListWorkspacesTool(handler);

    // Input requests another tenant explicitly; the trusted tenant wins.
    const input = { organizationId: 'org_evil' } as unknown as ListWorkspacesInput;
    await tool.execute(input, trustedContext);
    expect(handler.handle).toHaveBeenCalledWith({
      userId: 'usr_alice',
      organizationId: 'org_acme',
    });
  });

  it('surfaces a defensive failure when the application layer reports one', async () => {
    const handler = handlerReturning({
      ok: false,
      error: 'boom',
    } as unknown as Result<readonly WorkspaceDto[], never>);
    const tool = new ListWorkspacesTool(handler);

    const result = await tool.execute({}, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Could not list workspaces');
    // A failed authorization query must not fabricate an empty success.
    expect(result.output).toBeUndefined();
  });

  it('exposes a read-only, idempotent manifest with an empty input schema', () => {
    const tool = new ListWorkspacesTool(handlerReturning({ ok: true, value: [] }));
    expect(tool.manifest.id).toBe('workspaces.list_workspaces');
    expect(tool.manifest.sideEffectClass).toBe('read_only');
    expect(tool.manifest.idempotent).toBe(true);
    expect(tool.manifest.inputSchema).toMatchObject({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('cannot be coerced into scoping to a model-supplied workspace', async () => {
    const handler = handlerReturning({ ok: true, value: [AUTHORIZED] });
    const tool = new ListWorkspacesTool(handler);
    const input = { workspaceId: 'wsp_alien' } as unknown as ListWorkspacesInput;

    await tool.execute(input, trustedContext);
    // No workspace argument is forwarded: the application layer resolves the
    // caller's membership set, which can never be narrowed to a foreign scope.
    expect(handler.handle).toHaveBeenCalledWith({
      userId: 'usr_alice',
      organizationId: 'org_acme',
    });
  });

  it('executes with no workspace scope when the trusted context omits it', async () => {
    const handler = handlerReturning({ ok: true, value: [AUTHORIZED] });
    const tool = new ListWorkspacesTool(handler);

    const result = await tool.execute(
      {},
      { userId: 'usr_alice', tenantId: 'org_acme', executionId: 'run_2' },
    );
    expect(result.ok).toBe(true);
    expect(handler.handle).toHaveBeenCalledWith({
      userId: 'usr_alice',
      organizationId: 'org_acme',
    });
  });
});
