/**
 * CreateWorkspaceTool — the FIRST AI WRITE capability, unit tests.
 *
 * Security contract under test:
 * - The tool accepts ONLY the user-controlled `name`; the input schema is
 *   `additionalProperties: false`, so the model can never supply identity,
 *   tenant, roles, permissions, or approval state.
 * - Identity (`userId`) and tenant (`tenantId`) come EXCLUSIVELY from the
 *   trusted execution context; forged input fields are ignored.
 * - Authorization is membership of the trusted tenant (one authorization
 *   path — the same rule as `POST /api/workspaces`).
 * - Delegation goes through the application-layer handler — never
 *   repositories, never Drizzle, never domain objects.
 * - The application layer's result is authoritative (the model never decides
 *   success); the tenant check is defense-in-depth.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type {
  CreateWorkspaceHandler,
  CreateWorkspaceResult,
  ListMyWorkspacesHandler,
} from '@nexora/application-workspaces';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

import { CreateWorkspaceTool } from '../src/ai/tools/create-workspace-tool.js';
import type { CreateWorkspaceInput } from '../src/ai/tools/create-workspace-tool.js';

/** The trusted execution context (server-derived — never model-controlled). */
const trustedContext = {
  userId: 'usr_alice',
  tenantId: 'org_acme',
  executionId: 'run_1',
};

/** The authoritative application-layer result the handler returns. */
function createdWorkspace(overrides: Record<string, unknown> = {}) {
  // The branded id types are opaque in tests; the whole fixture is cast to
  // the result contract (values flow through the tool's `value` accessors).
  return {
    workspace: {
      id: 'wsp_new',
      name: { value: 'Engineering' },
      slug: { value: 'engineering' },
      organizationId: 'org_acme',
      type: { value: 'operations' },
      status: { value: 'active' },
      createdAt: '2026-08-08T00:00:00.000Z',
      ...overrides,
    },
  } as unknown as CreateWorkspaceResult;
}

function createHandlerReturning(result: Result<CreateWorkspaceResult, NexoraError>) {
  // The handler class carries private state; the fake satisfies the public
  // contract (structural) for tests.
  return { handle: vi.fn(async () => result) } as unknown as CreateWorkspaceHandler;
}

function orgsHandlerReturning(orgIds: readonly string[]) {
  return {
    handle: vi.fn(async () => ({
      ok: true,
      value: orgIds.map((id) => ({ id, name: id, slug: id })),
    })),
  } as unknown as ListOrganizationsHandler;
}

/** An honest read-back: the persisted list contains the created workspace (with overrides). */
function listReturning(rows: readonly Record<string, unknown>[]) {
  return {
    handle: vi.fn(async () => ({ ok: true, value: rows })),
  } as unknown as ListMyWorkspacesHandler;
}

const persistedRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'wsp_new',
  organizationId: 'org_acme',
  slug: 'engineering',
  name: 'Engineering',
  type: 'operations',
  status: 'active',
  createdAt: '2026-08-08T00:00:00.000Z',
  ...overrides,
});

function tool(
  dependencies: {
    create?: CreateWorkspaceHandler;
    orgs?: ListOrganizationsHandler;
    list?: ListMyWorkspacesHandler;
  } = {},
) {
  return new CreateWorkspaceTool({
    createWorkspace:
      dependencies.create ?? createHandlerReturning({ ok: true, value: createdWorkspace() }),
    listOrganizations: dependencies.orgs ?? orgsHandlerReturning(['org_acme']),
    listMyWorkspaces: dependencies.list ?? listReturning([persistedRow()]),
  });
}

describe('CreateWorkspaceTool', () => {
  it('creates a workspace through the application layer under the trusted identity', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const underTest = tool({ create });

    const result = await underTest.execute({ name: 'Engineering' }, trustedContext);

    expect(result.ok).toBe(true);
    expect(result.output?.workspace).toMatchObject({
      id: 'wsp_new',
      name: 'Engineering',
      slug: 'engineering',
      organizationId: 'org_acme',
    });
    // Delegation: org, slug, type, actor, and correlation come from trusted
    // context + server-side derivation — never from the input.
    expect(create.handle).toHaveBeenCalledWith({
      organizationId: 'org_acme',
      slug: 'engineering',
      name: 'Engineering',
      type: 'operations',
      actorId: 'usr_alice',
      correlationId: 'run_1',
    });
  });

  it('ignores forged identity fields in the input (trusted context wins)', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const underTest = tool({ create });

    const forged = {
      name: 'Engineering',
      userId: 'usr_hacker',
      tenantId: 'org_hacker',
      organizationId: 'org_hacker',
      role: 'admin',
    } as unknown as CreateWorkspaceInput;

    const result = await underTest.execute(forged, trustedContext);
    expect(result.ok).toBe(true);
    expect(create.handle).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_acme', actorId: 'usr_alice' }),
    );
  });

  it('rejects a missing name without touching the application layer', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const underTest = tool({ create });

    const result = await underTest.execute({ name: '   ' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('A workspace name is required');
    expect(create.handle).not.toHaveBeenCalled();
  });

  it('rejects an over-long name', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const underTest = tool({ create });

    const result = await underTest.execute({ name: 'x'.repeat(81) }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('80 characters');
    expect(create.handle).not.toHaveBeenCalled();
  });

  it('rejects a name that cannot become a valid slug', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const underTest = tool({ create });

    const result = await underTest.execute({ name: '!!!' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('valid slug');
    expect(create.handle).not.toHaveBeenCalled();
  });

  it('blocks a caller who is not a member of the trusted tenant', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const orgs = orgsHandlerReturning(['org_other']);
    const underTest = tool({ create, orgs });

    const result = await underTest.execute({ name: 'Engineering' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not authorized');
    // No mutation path is reached.
    expect(create.handle).not.toHaveBeenCalled();
  });

  it('blocks a cross-tenant attempt even when the caller has memberships elsewhere', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    // The caller is a member of org_evil but the trusted tenant is org_acme.
    const orgs = orgsHandlerReturning(['org_evil']);
    const underTest = tool({ create, orgs });

    const forged = {
      name: 'Engineering',
      organizationId: 'org_evil',
    } as unknown as CreateWorkspaceInput;
    const result = await underTest.execute(forged, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not authorized');
    expect(create.handle).not.toHaveBeenCalled();
  });

  it('surfaces a safe message when the application layer rejects the input', async () => {
    const create = createHandlerReturning({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'internal detail' } as unknown as NexoraError,
    });
    const underTest = tool({ create });

    const result = await underTest.execute({ name: 'Engineering' }, trustedContext);
    expect(result.ok).toBe(false);
    // Internal details are never leaked to the caller.
    expect(result.error).toBe('The workspace name is invalid');
    expect(result.error).not.toContain('internal detail');
  });

  it('surfaces a conflict when a workspace with the name exists', async () => {
    const create = createHandlerReturning({
      ok: false,
      error: { code: 'CONFLICT', message: 'slug exists' } as unknown as NexoraError,
    });
    const underTest = tool({ create });

    const result = await underTest.execute({ name: 'Engineering' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('maps unexpected application errors to a generic safe message', async () => {
    const create = createHandlerReturning({
      ok: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'connection string leaked',
      } as unknown as NexoraError,
    });
    const underTest = tool({ create });

    const result = await underTest.execute({ name: 'Engineering' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Could not create the workspace');
    expect(result.error).not.toContain('connection string');
  });

  it('fails verification when the application result belongs to another tenant', async () => {
    const create = createHandlerReturning({
      ok: true,
      value: createdWorkspace({ organizationId: 'org_evil' }),
    });
    const underTest = tool({ create });

    const result = await underTest.execute({ name: 'Engineering' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('verification failed');
  });

  it('delegates to the application layer exactly once on success', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const underTest = tool({ create });

    await underTest.execute({ name: 'Engineering' }, trustedContext);
    expect(create.handle).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the handler when authorization fails (no mutation)', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const underTest = tool({ create, orgs: orgsHandlerReturning([]) });

    await underTest.execute({ name: 'Engineering' }, trustedContext);
    expect(create.handle).not.toHaveBeenCalled();
  });

  it('exposes a consequential, non-idempotent manifest with a locked input schema', () => {
    const underTest = tool();
    expect(underTest.manifest.id).toBe('workspaces.create_workspace');
    expect(underTest.manifest.sideEffectClass).toBe('consequential');
    expect(underTest.manifest.idempotent).toBe(false);
    expect(underTest.manifest.inputSchema).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      // Structural guarantee: identity/tenant/scope can never be model input.
      additionalProperties: false,
    });
  });

  it('trims the requested name before delegation', async () => {
    const create = createHandlerReturning({ ok: true, value: createdWorkspace() });
    const underTest = tool({ create });

    await underTest.execute({ name: '  Engineering  ' }, trustedContext);
    expect(create.handle).toHaveBeenCalledWith(expect.objectContaining({ name: 'Engineering' }));
  });

  describe('independent read-back (a lying handler is UNVERIFIED)', () => {
    it('declares state_readback', () => {
      expect(tool().manifest.verification?.source).toBe('state_readback');
    });

    it.each([
      ['missing', []],
      ['a different name', [persistedRow({ name: 'Marketing' })]],
      ['a different slug', [persistedRow({ slug: 'other' })]],
      ['another tenant', [persistedRow({ organizationId: 'org_other' })]],
      ['archived', [persistedRow({ status: 'archived' })]],
    ])('handler reports success but the persisted workspace is %s', async (_label, rows) => {
      const result = await tool({ list: listReturning(rows) }).execute(
        { name: 'Engineering' },
        trustedContext,
      );
      expect(result.ok).toBe(false);
      expect(result.readBackFailed).toBe(true);
    });
  });
});
