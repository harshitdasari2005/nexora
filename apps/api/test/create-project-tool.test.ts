/**
 * CreateProjectTool security unit tests.
 *
 * The tool's security contract (mirrors CreateWorkspaceTool): identity
 * (`userId`) and tenant scope (`tenantId`) come EXCLUSIVELY from the trusted
 * execution context assembled by the runtime from the authenticated
 * session. The model may propose the action (\"create a project\") but may
 * never define who owns it or where — any forged identity/tenant fields in
 * the input are ignored; the tool's input schema is name-only with
 * `additionalProperties: false`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Result } from '@nexora/shared/result';
import type { CreateProjectHandler } from '@nexora/application-projects';
import type { CreateProjectResult } from '@nexora/application-projects';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { OrganizationDto } from '@nexora/application-organizations';
import { Project } from '@nexora/domain-projects';
import type { ProjectEventContext } from '@nexora/domain-projects';

import { CreateProjectTool } from '../src/ai/tools/create-project-tool.js';
import type { CreateProjectInput } from '../src/ai/tools/create-project-tool.js';

const TENANT = 'org_acme';

function organizationDto(org: Partial<OrganizationDto> = {}): OrganizationDto {
  return {
    id: org.id ?? TENANT,
    slug: org.slug ?? 'acme',
    name: org.name ?? 'Acme',
    type: 'startup',
    status: 'active',
    createdAt: '2026-08-08T00:00:00.000Z',
  };
}

function projectResult(
  overrides: Partial<Parameters<CreateProjectHandler['handle']>[0]> = {},
): CreateProjectResult {
  // Build a real Project aggregate (validated, status active).
  const project = createActiveProject(overrides.name ?? 'Mobile Banking');
  return {
    project,
    events: [],
  };
}

/** Creates a real active Project aggregate for the given tenant. */
function createActiveProject(name: string, organizationId = TENANT): Project {
  const context: ProjectEventContext = {
    actor: { kind: 'user', id: 'usr_alice' },
    correlationId: 'corr_1',
    organizationId: organizationId as ProjectEventContext['organizationId'],
  };
  const project = Project.create({ organizationId: context.organizationId, name }, context);
  project.pullDomainEvents();
  project.activate(context);
  project.pullDomainEvents();
  return project;
}

function createProjectHandlerReturning(
  result: Result<CreateProjectResult, { code?: string; message?: string }>,
): CreateProjectHandler {
  return { handle: vi.fn(async () => result) } as unknown as CreateProjectHandler;
}

function listOrganizationsHandlerReturning(
  organizations: OrganizationDto[],
): ListOrganizationsHandler {
  return {
    handle: vi.fn(async () => ({ ok: true, value: organizations })),
  } as unknown as ListOrganizationsHandler;
}

function listOrganizationsFailing(): ListOrganizationsHandler {
  return {
    handle: vi.fn(async () => ({ ok: false, error: 'boom' })),
  } as unknown as ListOrganizationsHandler;
}

function buildTool(
  options: {
    createProject?: CreateProjectHandler;
    listOrganizations?: ListOrganizationsHandler;
  } = {},
) {
  const createProject =
    options.createProject ?? createProjectHandlerReturning({ ok: true, value: projectResult() });
  const listOrganizations =
    options.listOrganizations ?? listOrganizationsHandlerReturning([organizationDto()]);
  return {
    tool: new CreateProjectTool({ createProject, listOrganizations }),
    createProject,
    listOrganizations,
  };
}

const trustedContext = {
  userId: 'usr_alice',
  tenantId: TENANT,
  executionId: 'run_1',
};

describe('CreateProjectTool manifest', () => {
  it('exposes a consequential, non-idempotent manifest', () => {
    const { tool } = buildTool();
    expect(tool.manifest.id).toBe('projects.create_project');
    expect(tool.manifest.sideEffectClass).toBe('consequential');
    expect(tool.manifest.idempotent).toBe(false);
  });

  it('accepts ONLY name (and optional description) in the input schema', () => {
    const { tool } = buildTool();
    const schema = tool.manifest.inputSchema as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(['name', 'description']);
    expect(schema.required).toEqual(['name']);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('CreateProjectTool trusted context vs model arguments', () => {
  it('creates through the application layer with the trusted identity and tenant', async () => {
    const { tool, createProject } = buildTool();
    const result = await tool.execute({ name: 'Mobile Banking' }, trustedContext);

    expect(result.ok).toBe(true);
    expect(createProject.handle).toHaveBeenCalledWith({
      organizationId: TENANT,
      name: 'Mobile Banking',
      description: undefined,
      actorId: 'usr_alice',
      correlationId: 'run_1',
    });
  });

  it('forwards an optional description', async () => {
    const { tool, createProject } = buildTool();
    const result = await tool.execute(
      { name: 'Mobile Banking', description: 'Core app' },
      trustedContext,
    );
    expect(result.ok).toBe(true);
    expect(createProject.handle).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Mobile Banking', description: 'Core app' }),
    );
  });

  it('ignores forged identity and tenant fields in the input', async () => {
    const { tool, createProject } = buildTool();
    const input = {
      name: 'Mobile Banking',
      userId: 'usr_hacker',
      tenantId: 'org_hacker',
      organizationId: 'org_hacker',
      workspaceId: 'wsp_alien',
      role: 'admin',
      permissions: ['*'],
      approval: 'granted',
      autonomyTier: 'autonomous',
    } as unknown as CreateProjectInput;

    const result = await tool.execute(input, trustedContext);
    expect(result.ok).toBe(true);
    // The application layer is called with ONLY the trusted scope.
    expect(createProject.handle).toHaveBeenCalledWith({
      organizationId: TENANT,
      name: 'Mobile Banking',
      description: undefined,
      actorId: 'usr_alice',
      correlationId: 'run_1',
    });
  });

  it('rejects a caller who is not a member of the trusted tenant', async () => {
    const { tool, createProject } = buildTool({
      listOrganizations: listOrganizationsHandlerReturning([organizationDto({ id: 'org_other' })]),
    });
    const result = await tool.execute({ name: 'Mobile Banking' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('You are not authorized to create a project in this organization');
    expect(createProject.handle).not.toHaveBeenCalled();
  });

  it('fails closed when the authorization query errors', async () => {
    const { tool, createProject } = buildTool({ listOrganizations: listOrganizationsFailing() });
    const result = await tool.execute({ name: 'Mobile Banking' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(createProject.handle).not.toHaveBeenCalled();
  });

  it('validates the name before executing', async () => {
    const { tool, createProject } = buildTool();
    const empty = await tool.execute({ name: '   ' }, trustedContext);
    expect(empty.ok).toBe(false);
    expect(empty.error).toBe('A project name is required');

    const tooLong = await tool.execute({ name: 'x'.repeat(81) }, trustedContext);
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error).toContain('at most 80 characters');
    expect(createProject.handle).not.toHaveBeenCalled();
  });

  it('maps application-layer failures to safe messages', async () => {
    const { tool } = buildTool({
      createProject: createProjectHandlerReturning({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'inner detail' },
      }),
    });
    const result = await tool.execute({ name: 'Mobile Banking' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('The project name is invalid');
  });

  it('verifies the created project belongs to the trusted tenant (defense-in-depth)', async () => {
    const alien = createActiveProject('Mobile Banking', 'org_alien');
    const alienResult: CreateProjectResult = { project: alien, events: [] };
    const { tool } = buildTool({
      createProject: createProjectHandlerReturning({ ok: true, value: alienResult }),
    });
    const result = await tool.execute({ name: 'Mobile Banking' }, trustedContext);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Project verification failed: unexpected organization');
  });

  it('never lets the model decide success — the application result is authoritative', async () => {
    const { tool, createProject } = buildTool();
    const result = await tool.execute({ name: 'Mobile Banking' }, trustedContext);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output?.project.organizationId).toBe(TENANT);
    expect(result.output?.project.status).toBe('active');
    expect(createProject.handle).toHaveBeenCalledTimes(1);
  });
});
