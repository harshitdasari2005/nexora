/**
 * @nexora/app-api — ListProjectsTool.
 *
 * The tenant-scoped project listing capability exposed to the Enterprise AI
 * Runtime (native adapter) and the Nexora MCP server (MCP adapter) — one
 * canonical tool, two adapters (S24 Phase 5).
 *
 * Security contract (same model as every tool):
 * - Input accepts NO arguments — the caller may request the *action* "list
 *   projects" but may not define *whose* (tenant) or *where* (workspace).
 * - Tenant scope comes exclusively from the trusted execution context.
 * - Authorization is delegated to the Projects **application layer**
 *   (`ListProjectsHandler` — tenant-scoped listing is the access rule).
 */

import type { TenantId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { ListProjectsHandler, ProjectDto } from '@nexora/application-projects';

/** Input contract: intentionally empty — the model cannot scope or impersonate. */
export type ListProjectsInput = Record<string, never>;

/** Output contract of {@link ListProjectsTool}. */
export interface ListProjectsOutput {
  /** The projects of the trusted tenant. */
  projects: readonly ProjectDto[];
}

/** The tool manifest (read-only, idempotent). */
export const LIST_PROJECTS_MANIFEST: ToolManifest = {
  id: 'projects.list',
  name: 'List Projects',
  description: 'Lists the projects of the current organization',
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
 * The read tool that lists the caller's tenant-scoped projects through the
 * Projects application layer under the trusted execution context.
 */
export class ListProjectsTool implements Tool<ListProjectsInput, ListProjectsOutput> {
  readonly manifest = LIST_PROJECTS_MANIFEST;

  readonly #listProjects: ListProjectsHandler;

  constructor(listProjects: ListProjectsHandler) {
    this.#listProjects = listProjects;
  }

  async execute(
    _input: ListProjectsInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<ListProjectsOutput>> {
    // Tenant scope comes from the trusted execution context only.
    const result = await this.#listProjects.handle({
      organizationId: context.tenantId as TenantId,
    });
    if (!result.ok) {
      return this.#failure('Could not list projects');
    }
    return {
      ok: true,
      output: { projects: result.value },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<ListProjectsOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}
