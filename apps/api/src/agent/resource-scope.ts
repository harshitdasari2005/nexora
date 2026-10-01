/**
 * @nexora/app-api — agent resource scoping (Prompt 4).
 *
 * Determines, from TRUSTED server-side reads, which resources a tool
 * invocation touches, so a resource-scoped delegation (e.g. "projects in
 * P123 only") can be enforced at execution time. Arguments are only used as
 * lookup keys; the resources themselves come from tenant-scoped application
 * reads, never from the arguments' say-so.
 *
 * A capability not listed here touches no scoped resource kind — the
 * delegation layer refuses to create resource-scoped grants for it, so a
 * scoped grant can never be silently unenforced.
 */

import type { AgentResourceScope } from '@nexora/contracts/agent';
import type { TenantId } from '@nexora/contracts/common';
import type { InvocationResources } from '@nexora/module-agents';
import type { FindProjectByNameHandler } from '@nexora/application-projects';
import type { RepositorySet } from '../container.js';

/** Dependencies of the resource resolver / verifier. */
export interface AgentResourceScopeDependencies {
  findProjectByName: FindProjectByNameHandler;
  repositories: Pick<RepositorySet, 'projects' | 'budgets'>;
}

/** Which input field names the project, per capability. */
const PROJECT_NAME_FIELD: Readonly<Record<string, string>> = {
  'projects.find_project': 'name',
  'projects.assign_employee': 'projectName',
  'workflow.hire_and_assign_employee': 'projectName',
};

/** Resolves the resources an invocation touches (fails closed as `unresolvable`). */
export function createInvocationResourceResolver(
  dependencies: AgentResourceScopeDependencies,
): (request: {
  capabilityId: string;
  input: Record<string, unknown>;
  tenantId: string;
  workspaceId?: string;
}) => Promise<InvocationResources> {
  return async (request) => {
    const projectField = PROJECT_NAME_FIELD[request.capabilityId];
    if (projectField !== undefined) {
      const name = request.input[projectField];
      if (typeof name !== 'string' || name.trim().length === 0) {
        return { kind: 'unresolvable', reason: 'no project named in the request' };
      }
      const found = await dependencies.findProjectByName.handle({
        organizationId: request.tenantId as TenantId,
        name: name.trim(),
      });
      if (!found.ok) {
        return { kind: 'unresolvable', reason: 'project lookup failed' };
      }
      // Every project the name could reach — an ambiguous name that also
      // matches an out-of-scope project fails the scope check.
      return {
        kind: 'resolved',
        resources: found.value.map((project) => ({ kind: 'project' as const, id: project.id })),
      };
    }
    if (request.capabilityId === 'finance.submit_expense') {
      const budgetId = request.input['budgetId'];
      if (typeof budgetId !== 'string' || budgetId.trim().length === 0) {
        return { kind: 'unresolvable', reason: 'no budget named in the request' };
      }
      return { kind: 'resolved', resources: [{ kind: 'budget', id: budgetId.trim() }] };
    }
    return { kind: 'resolved', resources: [] };
  };
}

/** Verifies a delegation's resource scope exists inside the org (+ workspace for budgets). */
export function createAgentResourceVerifier(
  dependencies: AgentResourceScopeDependencies,
): (scope: AgentResourceScope, organizationId: string, workspaceId: string) => Promise<boolean> {
  return async (scope, organizationId, workspaceId) => {
    try {
      if (scope.kind === 'project') {
        const project = await dependencies.repositories.projects.findById(scope.id as never);
        return project !== undefined && project.organizationId === organizationId;
      }
      const budget = await dependencies.repositories.budgets.findById(scope.id as never);
      return (
        budget !== undefined &&
        budget.organizationId === organizationId &&
        budget.workspaceId === workspaceId
      );
    } catch {
      // A malformed id resolves to "not found", never to an error path.
      return false;
    }
  };
}
