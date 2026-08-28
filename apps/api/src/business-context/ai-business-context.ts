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
  // S24 Phase 5: `projects.read` also maps to the list-projects surface so
  // the MCP `nexora.projects.list` tool follows the same role affinity as
  // the AI's find-project capability (ONE capability bridge for both).
  'projects.read': ['projects.find_project', 'projects.list'],
  'projects.create': ['projects.create_project'],
  'projects.assign': ['projects.assign_employee'],
  'documents.read': ['knowledge.search'],
  'knowledge.read': ['knowledge.search'],
  'employees.read': ['hr.find_employee'],
  'employees.manage': ['hr.create_employee'],
  // S24 Phase 5: `approvals.read` also maps to the notifications inbox so
  // the MCP `nexora.notifications.list` tool follows the same affinity.
  // Phase 10: the same affinity covers clearing the attention backlog — a
  // role that can see what needs attention can also act on it (governed by
  // the SAME approval gate every consequential write goes through).
  'approvals.read': [
    'notifications.what_needs_attention',
    'notifications.list',
    'notifications.mark_all_read',
  ],
  'calendar.create': ['calendar.create_event'],
  // S35 Finance vertical: a role with the budget-management affinity can
  // also run the deterministic over-threshold remediation action (the same
  // "sees it, can act on it" affinity already used for approvals.read →
  // notifications.mark_all_read above); expense submission maps 1:1.
  'budgets.manage': ['finance.flag_over_budget_items'],
  'expenses.create': ['finance.submit_expense'],
  // S24 Phase 4: `workflows.execute` maps to the workflow-orchestrating
  // capabilities, so a role WITH the affinity (CEO/Manager) can plan
  // workflow intents and a role WITHOUT it (Developer) cannot — workflow
  // proposals are gated by the same trusted affinity (approval is
  // governance, never privilege escalation).
  'workflows.execute': [
    'workflow.create_project_and_assign_employee',
    'workflow.hire_and_assign_employee',
  ],
  // S25 Phase 7: external connector capabilities map to their executable
  // AI/MCP surfaces (the connector tool ids). A connector is configured per
  // tenant (env credentials) — the capability is only EXECUTABLE when a
  // connection exists for the trusted tenant; discovery of the capability
  // never grants provider access (the connector tool fails closed when no
  // connection is configured).
  'github.repositories.read': ['github.repositories.list', 'github.repositories.get'],
  'github.issues.read': ['github.issues.list'],
  'github.issues.create': ['github.issues.create'],
  'slack.channels.read': ['slack.channels.list'],
  'slack.messages.read': ['slack.messages.recent'],
  'slack.messages.send': ['slack.messages.send'],
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
