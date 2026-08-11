/**
 * @nexora/app-api — FindProjectTool.
 *
 * The Projects read capability exposed to the Enterprise AI Runtime:
 * resolves a project by name inside the trusted tenant (Projects bounded
 * context). Returns EVERY candidate so the caller distinguishes resolved
 * (exactly one) from ambiguous (multiple) — the system never guesses a
 * project.
 *
 * Security contract (same model as the other tools):
 * - Input accepts ONLY the user-controlled `name` — `additionalProperties:
 *   false`. Identity and tenant come exclusively from the trusted execution
 *   context; the model cannot scope the search to another tenant.
 * - Authorization is delegated to the Projects **application layer**
 *   (`FindProjectByNameHandler` — tenant-scoped resolution is the single
 *   access rule).
 */

import type { TenantId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { FindProjectByNameHandler, ProjectDto } from '@nexora/application-projects';

/** Input contract: ONLY the user-controlled name. */
export interface FindProjectInput {
  /** The name term to resolve (case-insensitive substring). */
  name: string;
}

/** Output contract of {@link FindProjectTool}. */
export interface FindProjectOutput {
  /** Every matching project (tenant-scoped). */
  projects: readonly ProjectDto[];
  /** True when exactly one candidate was found (resolved). */
  resolved: boolean;
  /** True when more than one candidate matched (ambiguous — ask the user). */
  ambiguous: boolean;
}

/** The tool manifest (read-only, idempotent). */
export const FIND_PROJECT_MANIFEST: ToolManifest = {
  id: 'projects.find_project',
  name: 'Find project',
  description: 'Finds a project by name in the current organization',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The maximum name length (mirrors the application validator). */
const NAME_MAX_LENGTH = 80;

/**
 * The read tool that resolves projects through the Projects application
 * layer under the trusted execution context.
 */
export class FindProjectTool implements Tool<FindProjectInput, FindProjectOutput> {
  readonly manifest = FIND_PROJECT_MANIFEST;

  readonly #findProjectByName: FindProjectByNameHandler;

  constructor(findProjectByName: FindProjectByNameHandler) {
    this.#findProjectByName = findProjectByName;
  }

  async execute(
    input: FindProjectInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<FindProjectOutput>> {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name.length === 0) {
      return this.#failure('A project name is required');
    }
    if (name.length > NAME_MAX_LENGTH) {
      return this.#failure(`Project name must be at most ${NAME_MAX_LENGTH} characters`);
    }

    // Tenant scope comes from the trusted execution context only.
    const result = await this.#findProjectByName.handle({
      organizationId: context.tenantId as TenantId,
      name,
    });
    if (!result.ok) {
      return this.#failure('Could not find projects');
    }

    const projects = result.value;
    return {
      ok: true,
      output: {
        projects,
        resolved: projects.length === 1,
        ambiguous: projects.length > 1,
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<FindProjectOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}
