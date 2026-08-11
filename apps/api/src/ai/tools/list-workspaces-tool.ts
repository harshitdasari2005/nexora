/**
 * @nexora/app-api — ListWorkspacesTool.
 *
 * The workspaces listing tool exposed to the Enterprise AI Runtime. It
 * returns ONLY the workspaces the authenticated user is a member of, inside
 * the authenticated tenant.
 *
 * Security contract (AI hardening):
 * - Identity (`userId`) and tenant scope (`tenantId`) come exclusively from
 *   the **trusted execution context** assembled by the orchestrator from the
 *   authenticated session — never from the prompt, tool arguments, or
 *   model-generated JSON.
 * - The tool accepts **no input arguments** (empty schema): the model may
 *   request the *action* "list workspaces", but it may not define *whose*
 *   or *where*.
 * - Authorization is delegated to the workspaces **application layer**
 *   (`ListMyWorkspacesHandler` — membership is the single access rule). The
 *   AI never filters by its own claims and never bypasses the application
 *   layer (AIR.md §2, ADR-001).
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { ListMyWorkspacesHandler, WorkspaceDto } from '@nexora/application-workspaces';

/** Input contract: intentionally empty — the model cannot scope or impersonate. */
export type ListWorkspacesInput = Record<string, never>;

/** Output contract of {@link ListWorkspacesTool}. */
export interface ListWorkspacesOutput {
  /** The workspaces the authenticated user is authorized to access. */
  workspaces: readonly WorkspaceDto[];
}

/** The tool manifest (read-only, idempotent — safe to re-invoke). */
export const LIST_WORKSPACES_MANIFEST: ToolManifest = {
  id: 'workspaces.list_workspaces',
  name: 'List my workspaces',
  description: 'Lists the workspaces the current user is a member of in the current organization',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

/**
 * The tool that resolves the caller's authorized workspaces through the
 * workspaces application layer.
 */
export class ListWorkspacesTool implements Tool<ListWorkspacesInput, ListWorkspacesOutput> {
  readonly manifest = LIST_WORKSPACES_MANIFEST;

  readonly #listMyWorkspaces: ListMyWorkspacesHandler;

  constructor(listMyWorkspaces: ListMyWorkspacesHandler) {
    this.#listMyWorkspaces = listMyWorkspaces;
  }

  async execute(
    _input: ListWorkspacesInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<ListWorkspacesOutput>> {
    // Only trusted context values are used. Any model-supplied arguments are
    // ignored (the input type is empty; defensive ignore here too).
    const result = await this.#listMyWorkspaces.handle({
      userId: context.userId as UserId,
      organizationId: context.tenantId as TenantId,
    });
    if (!result.ok) {
      // The handler's error channel is `never` (listing cannot fail in the
      // application layer); a defensive message keeps the tool contract total.
      return {
        ok: false,
        error: 'Could not list workspaces',
        completedAt: new Date().toISOString(),
      };
    }
    return {
      ok: true,
      output: { workspaces: result.value },
      completedAt: new Date().toISOString(),
    };
  }
}
