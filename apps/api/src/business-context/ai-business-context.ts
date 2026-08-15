/**
 * @nexora/app-api — AI business context builder (S24 Phase 3).
 *
 * Assembles the TRUSTED business context of an AI interaction: trusted
 * membership → business role → Phase 1 domain → capability affinities →
 * executable AI capability ids. The model never provides any of these
 * values — the builder reads only the membership repositories and the Phase
 * 1 Domain → Role → Capability catalog.
 *
 * The affinity bridge maps the Phase 1 BUSINESS vocabulary (e.g.
 * `projects.read`) to the AI Runtime's EXECUTABLE capability ids (e.g.
 * `projects.find_project`). Business capabilities with no executable AI
 * surface (e.g. `documents.upload`) map to nothing and are dropped — the AI
 * is never told it can execute something it cannot (S24: do not pretend).
 *
 * Security contract: business context is CONTEXT, not authorization. It
 * focuses discovery on the role's relevant capabilities but grants nothing;
 * every tool invocation still passes the existing server-side authorization
 * checks, and a forged role/domain/capability claim cannot change it.
 */

import type { AIBusinessContext } from '@nexora/ai-runtime';
import type { DomainCatalog } from '@nexora/module-domains';
import type {
  MembershipBusinessRoleResolver,
  BusinessRoleResolutionContext,
} from './business-role-resolver.js';
/**
 * The affinity bridge: Phase 1 business capability id → executable AI
 * capability id(s). Only capabilities with a real AI tool surface map to
 * something; the rest are absent and resolve to nothing.
 */
const BUSINESS_CAPABILITY_TO_AI_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  'workspaces.list': ['workspaces.list_workspaces'],
  'workspaces.create': ['workspaces.create_workspace'],
  'projects.read': ['projects.find_project'],
  'projects.create': ['projects.create_project'],
  'projects.assign': ['projects.assign_employee'],
  'documents.read': ['knowledge.search'],
  'knowledge.read': ['knowledge.search'],
  'employees.read': ['hr.find_employee'],
  'employees.manage': ['hr.create_employee'],
  'approvals.read': ['notifications.what_needs_attention'],
  'calendar.create': ['calendar.create_event'],
  // S24 Phase 4: `workflows.execute` maps to the workflow-orchestrating
  // capabilities, so a role WITH the affinity (CEO/Manager) can plan
  // workflow intents and a role WITHOUT it (Developer) cannot — workflow
  // proposals are gated by the same trusted affinity (approval is
  // governance, never privilege escalation).
  'workflows.execute': [
    'workflow.create_project_and_assign_employee',
    'workflow.hire_and_assign_employee',
  ],
};

/** Dependencies of the AI business-context builder. */
export interface AIBusinessContextDependencies {
  /** The single trusted role-resolution seam (shared with the Command Center). */
  roleResolver: MembershipBusinessRoleResolver;
  /** The Phase 1 Domain → Role → Capability catalog (definitions only). */
  catalog: DomainCatalog;
}

/**
 * Builds the trusted AI business context for a request, or `undefined` when
 * the caller has no resolvable business role (the caller then runs without
 * a business focus — current unrestricted discovery, the safe default).
 */
export async function buildAIBusinessContext(
  dependencies: AIBusinessContextDependencies,
  context: BusinessRoleResolutionContext,
): Promise<AIBusinessContext | undefined> {
  const roleId = await dependencies.roleResolver.resolve(context);
  if (roleId === undefined) {
    return undefined;
  }
  const role = dependencies.catalog.roles.get(roleId);
  if (role === undefined) {
    return undefined;
  }
  const domain = dependencies.catalog.domains.get(role.domainId);
  const executable = new Set<string>();
  for (const businessId of role.capabilityIds) {
    for (const aiId of BUSINESS_CAPABILITY_TO_AI_CAPABILITIES[businessId] ?? []) {
      executable.add(aiId);
    }
  }
  return {
    domainId: role.domainId,
    ...(domain?.name === undefined ? {} : { domainName: domain.name }),
    roleId,
    roleName: role.name,
    capabilityIds: [...executable],
  };
}

/** The executable AI capability ids a business capability maps to (exposed for tests). */
export function resolveExecutableCapabilities(businessIds: readonly string[]): readonly string[] {
  const executable = new Set<string>();
  for (const businessId of businessIds) {
    for (const aiId of BUSINESS_CAPABILITY_TO_AI_CAPABILITIES[businessId] ?? []) {
      executable.add(aiId);
    }
  }
  return [...executable];
}
