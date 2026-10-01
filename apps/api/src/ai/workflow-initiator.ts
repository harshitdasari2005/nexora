/**
 * @nexora/app-api — the initiator's authority over a composite workflow.
 *
 * A composite (workflow) capability is authorized as ONE unit, but its inner
 * steps invoke other capabilities (hire an employee, assign a project, …).
 * `workflows.execute` alone must never grant those. Before a workflow starts,
 * the server derives — from trusted membership → role → RBAC catalog, never
 * from a request value — the executable capability ceiling of the initiator,
 * checks that it covers EVERY capability the workflow will use, and binds the
 * ceiling to the workflow instance, where it bounds every inner step and
 * compensation (see `WorkflowToolStepExecutor`).
 *
 * Defense in depth: the chat/agent run's own ceiling (when present and
 * non-empty) narrows the RBAC ceiling further — an agent can never start a
 * workflow reaching beyond its own delegated capabilities.
 */

import {
  resolveEffectivePermissions,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { resolveExecutableCapabilities } from '../business-context/ai-business-context.js';

/** Resolves the executable capability ids the trusted RBAC role grants (fail closed: `[]`). */
export type InitiatorCapabilityResolver = (scope: {
  userId: string;
  tenantId: string;
  workspaceId?: string;
}) => Promise<readonly string[]>;

/** Builds the resolver over the SAME trusted role resolver + catalog every surface uses. */
export function createInitiatorCapabilityResolver(
  rbac: PermissionResolverDependencies,
): InitiatorCapabilityResolver {
  return async (scope) => {
    const effective = await resolveEffectivePermissions(rbac, {
      userId: scope.userId,
      tenantId: scope.tenantId,
      ...(scope.workspaceId === undefined ? {} : { workspaceId: scope.workspaceId }),
    });
    return effective === undefined ? [] : resolveExecutableCapabilities(effective.permissions);
  };
}

/** The outcome of {@link authorizeWorkflowInitiator}. */
export type WorkflowInitiatorDecision =
  { ok: true; ceiling: readonly string[] } | { ok: false; missing: readonly string[] };

/**
 * Verifies that the initiator holds EVERY inner capability the workflow uses
 * and returns the ceiling to bind to the instance. Fails closed: no resolver
 * and no run ceiling, an unresolvable role, or any missing capability all
 * refuse.
 */
export async function authorizeWorkflowInitiator(input: {
  resolver: InitiatorCapabilityResolver | undefined;
  scope: { userId: string; tenantId: string; workspaceId?: string };
  /** The invoking run's own ceiling (`ToolExecutionContext.allowedCapabilityIds`). */
  runCeiling?: readonly string[];
  required: readonly string[];
}): Promise<WorkflowInitiatorDecision> {
  const rbac = input.resolver === undefined ? undefined : await input.resolver(input.scope);
  // An ABSENT run ceiling defers to RBAC; an EMPTY one is "no authority" (it
  // must never widen to the initiator's full role).
  const run = input.runCeiling;
  let ceiling: readonly string[];
  if (rbac !== undefined) {
    ceiling = run === undefined ? rbac : rbac.filter((id) => run.includes(id));
  } else {
    ceiling = run ?? [];
  }
  const missing = input.required.filter((id) => !ceiling.includes(id));
  return missing.length > 0 ? { ok: false, missing } : { ok: true, ceiling: [...ceiling] };
}
