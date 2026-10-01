/**
 * @nexora/app-api — CreateWorkspaceTool.
 *
 * The FIRST AI WRITE capability (AI vertical slice 2). The user proposes the
 * *action* ("Create a workspace called Engineering"); the tool executes it
 * ONLY through the existing workspaces application layer, and ONLY after a
 * granted server-side approval (the orchestrator's approval gate — see
 * platform/ai-runtime/docs/APPROVAL.md).
 *
 * Security contract (AI hardening):
 * - Input schema accepts ONLY the user-controlled business value `name`
 *   (`additionalProperties: false`). The model can never supply `userId`,
 *   `tenantId`, `organizationId`, `workspaceId`, roles, permissions, or
 *   approval state — identity and tenant come exclusively from the trusted
 *   execution context assembled from the authenticated session.
 * - Authorization mirrors the REST surface (`POST /api/workspaces`):
 *   membership of the trusted tenant is the rule (no second authorization
 *   system). The LLM cannot elevate itself — "act as an administrator" in
 *   the prompt changes nothing.
 * - The slug is derived server-side from the name; `type` defaults to the
 *   platform default (`operations`, WS-R1). No model-supplied scope.
 * - Delegation: the tool calls the CreateWorkspaceHandler (application
 *   layer) — never Drizzle, never repositories, never domain objects.
 * - Verification: the created workspace must belong to the trusted tenant;
 *   the model never decides whether execution succeeded — the application
 *   layer's result is authoritative.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { CreateWorkspaceHandler } from '@nexora/application-workspaces';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

/** Input contract: ONLY the user-controlled name (identity is never input). */
export interface CreateWorkspaceInput {
  /** The requested workspace name (user-controlled business value). */
  name: string;
}

/** Output contract of {@link CreateWorkspaceTool}. */
export interface CreateWorkspaceOutput {
  /** The created workspace (authoritative application-layer result). */
  workspace: {
    /** The created workspace id. */
    id: string;
    /** The workspace name. */
    name: string;
    /** The server-derived slug. */
    slug: string;
    /** The owning organization (tenant) id — must equal the trusted tenant. */
    organizationId: string;
    /** The template type (defaulted server-side). */
    type: string;
    /** The lifecycle status (`active` after provisioning). */
    status: string;
    /** ISO-8601 UTC creation time. */
    createdAt: string;
  };
}

/** The tool manifest: consequential (persistent state change, always gated). */
export const CREATE_WORKSPACE_MANIFEST: ToolManifest = {
  id: 'workspaces.create_workspace',
  name: 'Create workspace',
  description: 'Creates a new workspace in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  verification: {
    source: 'state_readback',
    limitation:
      "the workspace is re-read through the creator's membership-scoped workspace list (tenant, name, slug, status); not a raw repository read",
  },
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The platform-default workspace template type (WS-R1 company default). */
const DEFAULT_WORKSPACE_TYPE = 'operations';

/** The maximum name length (mirrors the application validator). */
const NAME_MAX_LENGTH = 80;

/**
 * The write tool that creates a workspace through the workspaces
 * application layer under the trusted execution context.
 */
export class CreateWorkspaceTool implements Tool<CreateWorkspaceInput, CreateWorkspaceOutput> {
  readonly manifest = CREATE_WORKSPACE_MANIFEST;

  readonly #createWorkspace: CreateWorkspaceHandler;
  readonly #listOrganizations: ListOrganizationsHandler;
  readonly #listMyWorkspaces: ListMyWorkspacesHandler;

  constructor(dependencies: {
    /** The application-layer create-workspace command handler. */
    createWorkspace: CreateWorkspaceHandler;
    /** Resolves the caller's organization memberships (authorization rule). */
    listOrganizations: ListOrganizationsHandler;
    /** Membership-scoped workspace listing (independent read-back of the created workspace). */
    listMyWorkspaces: ListMyWorkspacesHandler;
  }) {
    this.#listMyWorkspaces = dependencies.listMyWorkspaces;
    this.#createWorkspace = dependencies.createWorkspace;
    this.#listOrganizations = dependencies.listOrganizations;
  }

  async execute(
    input: CreateWorkspaceInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<CreateWorkspaceOutput>> {
    // 1. Validate the user-controlled input (untrusted model/user values).
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name.length === 0) {
      return this.#failure('A workspace name is required');
    }
    if (name.length > NAME_MAX_LENGTH) {
      return this.#failure(`Workspace name must be at most ${NAME_MAX_LENGTH} characters`);
    }
    const slug = toWorkspaceSlug(name);
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      return this.#failure('Workspace name cannot be converted to a valid slug');
    }

    // 2. Authorization: the caller must be a member of the trusted tenant.
    //    Identity (`userId`) and tenant (`tenantId`) come from the trusted
    //    execution context — never from the prompt or tool arguments.
    const membership = await this.#listOrganizations.handle({
      userId: context.userId as UserId,
    });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure('You are not authorized to create a workspace in this organization');
    }

    // 3. Delegate to the application layer (the authoritative path).
    const result = await this.#createWorkspace.handle({
      organizationId: context.tenantId as TenantId,
      slug,
      name,
      type: DEFAULT_WORKSPACE_TYPE,
      actorId: context.userId as UserId,
      correlationId: context.executionId,
    });
    if (!result.ok) {
      return this.#failure(createWorkspaceErrorMessage(result.error));
    }

    // 4. Verify the authoritative result against the trusted tenant. The
    //    model never decides success — the application layer's result is the
    //    source of truth, and this check is defense-in-depth.
    const workspace = result.value.workspace;
    if (workspace.organizationId !== context.tenantId) {
      return {
        ...this.#failure('Workspace verification failed: unexpected organization'),
        readBackFailed: true,
      };
    }

    // 5. Independent read-back: re-read the workspace from persisted state (the
    //    creator's membership-scoped list) and require tenant, name, slug and a
    //    non-archived status to match. A handler that reported a workspace that
    //    was not persisted is surfaced as UNVERIFIED, never success.
    const readBack = await this.#listMyWorkspaces.handle({
      userId: context.userId as UserId,
      organizationId: context.tenantId as TenantId,
    });
    const persisted =
      readBack.ok &&
      readBack.value.some(
        (row) =>
          row.id === workspace.id &&
          row.organizationId === context.tenantId &&
          row.name === workspace.name.value &&
          row.slug === workspace.slug.value &&
          row.status !== 'archived',
      );
    if (!persisted) {
      return {
        ...this.#failure('Workspace verification failed: created workspace not found on read-back'),
        readBackFailed: true,
      };
    }

    return {
      ok: true,
      output: {
        workspace: {
          id: workspace.id,
          name: workspace.name.value,
          slug: workspace.slug.value,
          organizationId: workspace.organizationId,
          type: workspace.type.value,
          status: workspace.status.value,
          createdAt: workspace.createdAt,
        },
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<CreateWorkspaceOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/**
 * Maps an application-layer error to a safe user-facing message (never
 * internal details, provider credentials, or stack traces).
 */
function createWorkspaceErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'The workspace name is invalid';
    case 'CONFLICT':
      return 'A workspace with this name already exists in the organization';
    default:
      return 'Could not create the workspace';
  }
}

/**
 * Derives a workspace slug from the requested name, server-side. The model
 * proposes the name only; slug shape and uniqueness are platform rules.
 */
function toWorkspaceSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
