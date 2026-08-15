/**
 * @nexora/app-api — CreateProjectTool.
 *
 * The first BUSINESS-APPLICATION AI write capability (Projects vertical
 * slice). The user proposes the *action* (\"Create a project called Mobile
 * Banking\"); the tool executes it ONLY through the existing projects
 * application layer, and ONLY after a granted server-side approval (the
 * orchestrator's approval gate — platform/ai-runtime/docs/APPROVAL.md).
 *
 * Security contract (same model as CreateWorkspaceTool):
 * - Input schema accepts ONLY the user-controlled business values `name`
 *   (and optional `description`) — `additionalProperties: false`. The model
 *   can never supply `userId`, `tenantId`, `organizationId`, `workspaceId`,
 *   permissions, or approval state — identity and tenant come exclusively
 *   from the trusted execution context assembled from the authenticated
 *   session.
 * - Authorization mirrors the REST surface (`POST /api/projects`):
 *   membership of the trusted tenant is the rule (no second authorization
 *   system). \"Act as an administrator\" in the prompt changes nothing.
 * - Delegation: the tool calls the CreateProjectHandler (application
 *   layer) — never Drizzle, never repositories, never domain objects.
 * - Verification: the created project must belong to the trusted tenant;
 *   the model never decides whether execution succeeded — the application
 *   layer's result is authoritative.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { CreateProjectHandler, FindProjectByNameHandler } from '@nexora/application-projects';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

/** Input contract: ONLY user-controlled business fields (identity is never input). */
export interface CreateProjectInput {
  /** The requested project name (user-controlled business value). */
  name: string;
  /** Optional requested description (user-controlled business value). */
  description?: string;
}

/** Output contract of {@link CreateProjectTool}. */
export interface CreateProjectOutput {
  /** The created project (authoritative application-layer result). */
  project: {
    /** The created project id. */
    id: string;
    /** The project name. */
    name: string;
    /** The optional description. */
    description?: string;
    /** The owning organization (tenant) id — must equal the trusted tenant. */
    organizationId: string;
    /** The lifecycle status (`active` after charter approval in v1). */
    status: string;
    /** ISO-8601 UTC creation time. */
    createdAt: string;
  };
}

/** The tool manifest: consequential (persistent state change, always gated). */
export const CREATE_PROJECT_MANIFEST: ToolManifest = {
  id: 'projects.create_project',
  name: 'Create project',
  description: 'Creates a new project in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      description: { type: 'string', maxLength: 2000 },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The maximum name length (mirrors the application validator). */
const NAME_MAX_LENGTH = 80;

/**
 * The write tool that creates a project through the projects application
 * layer under the trusted execution context.
 */
export class CreateProjectTool implements Tool<CreateProjectInput, CreateProjectOutput> {
  readonly manifest = CREATE_PROJECT_MANIFEST;

  readonly #createProject: CreateProjectHandler;
  readonly #listOrganizations: ListOrganizationsHandler;
  readonly #findProjectByName: FindProjectByNameHandler;

  constructor(dependencies: {
    /** The application-layer create-project command handler. */
    createProject: CreateProjectHandler;
    /** Resolves the caller's organization memberships (authorization rule). */
    listOrganizations: ListOrganizationsHandler;
    /**
     * The tenant-scoped read-back handler (S24 Phase 4 verification):
     * after creation the tool reads the persisted state back and confirms
     * the created project exists in the trusted tenant — a failed read-back
     * is reported as a failure, never as success.
     */
    findProjectByName: FindProjectByNameHandler;
  }) {
    this.#createProject = dependencies.createProject;
    this.#listOrganizations = dependencies.listOrganizations;
    this.#findProjectByName = dependencies.findProjectByName;
  }

  async execute(
    input: CreateProjectInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<CreateProjectOutput>> {
    // 1. Validate the user-controlled input (untrusted model/user values).
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name.length === 0) {
      return this.#failure('A project name is required');
    }
    if (name.length > NAME_MAX_LENGTH) {
      return this.#failure(`Project name must be at most ${NAME_MAX_LENGTH} characters`);
    }
    const description =
      typeof input?.description === 'string' && input.description.trim().length > 0
        ? input.description.trim()
        : undefined;

    // 2. Authorization: the caller must be a member of the trusted tenant.
    //    Identity (`userId`) and tenant (`tenantId`) come from the trusted
    //    execution context — never from the prompt or tool arguments.
    const membership = await this.#listOrganizations.handle({
      userId: context.userId as UserId,
    });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure('You are not authorized to create a project in this organization');
    }

    // 3. Delegate to the application layer (the authoritative path).
    const result = await this.#createProject.handle({
      organizationId: context.tenantId as TenantId,
      name,
      description,
      actorId: context.userId as UserId,
      correlationId: context.executionId,
    });
    if (!result.ok) {
      return this.#failure(createProjectErrorMessage(result.error));
    }

    // 4. Verify the authoritative result against the trusted tenant. The
    //    model never decides success — the application layer's result is the
    //    source of truth, and this check is defense-in-depth.
    const project = result.value.project;
    if (project.organizationId !== context.tenantId) {
      return this.#failure('Project verification failed: unexpected organization');
    }

    // 5. Read-back verification (S24 Phase 4): read the persisted state
    //    back through the query surface and confirm the created project is
    //    actually present in the trusted tenant. A failed read-back is
    //    surfaced as a failure — never reported as success.
    const readBack = await this.#findProjectByName.handle({
      organizationId: context.tenantId as TenantId,
      name: project.name.value,
    });
    const persisted =
      readBack.ok &&
      readBack.value.some(
        (candidate) => candidate.id === project.id && candidate.organizationId === context.tenantId,
      );
    if (!persisted) {
      return this.#failure('Project verification failed: created project not found');
    }

    return {
      ok: true,
      output: {
        project: {
          id: project.id,
          name: project.name.value,
          description: project.description.value,
          organizationId: project.organizationId,
          status: project.status.value,
          createdAt: project.createdAt,
        },
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<CreateProjectOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/**
 * Maps an application-layer error to a safe user-facing message (never
 * internal details, provider credentials, or stack traces).
 */
function createProjectErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'The project name is invalid';
    // Note: the Projects domain does not enforce name uniqueness in v1
    // (no existsByName rule), so there is no CONFLICT branch — a duplicate
    // name is a valid project. Uniqueness arrives with a later sprint.
    default:
      return 'Could not create the project';
  }
}
