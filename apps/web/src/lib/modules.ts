/**
 * @nexora/app-web — module definitions (S34 RBAC).
 *
 * Maps each sidebar nav item to the RBAC permission that gates it. This is
 * PRESENTATION ONLY — hiding a module the caller lacks permission for is UX,
 * never the access control itself: every route behind it re-checks the SAME
 * permission server-side via `authorizePermission` (apps/api/src/business-
 * context/permissions.ts), so a forged client state can never reveal or
 * reach anything real. A module with no `requiredPermission` (Command
 * Center, Apps, Integrations, AI Assistant, Search, Settings) is universal
 * — every authenticated role can see it.
 *
 * Fail-closed, matching the backend's `hasPermission` semantics exactly: a
 * role with an EMPTY permission set (not yet RBAC-configured) sees only the
 * universal modules, the same as what the backend would actually allow.
 */

/** One nav item's RBAC gate — `navLabel` matches AppShell's nav item label. */
export interface ModuleDefinition {
  /** Matches the nav item label in `AppShell`'s nav catalog. */
  navLabel: string;
  /** The permission required to see this module. Absent = universal. */
  requiredPermission?: string;
  /** Alternative: the module is visible to a role holding ANY of these permissions. */
  anyOfPermissions?: readonly string[];
}

/** The nav → permission mapping (S34). */
export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  { navLabel: 'My desk' },
  { navLabel: 'Command Center' },
  { navLabel: 'Agent', requiredPermission: 'agent.use' },
  { navLabel: 'Agents', requiredPermission: 'agent.use' },
  { navLabel: 'Problems', requiredPermission: 'problems.read' },
  { navLabel: 'Projects', requiredPermission: 'projects.read' },
  { navLabel: 'Employees', requiredPermission: 'employees.read' },
  // Raisers see their own requests; the CEO, Finance and HR see all of them.
  { navLabel: 'Hiring', anyOfPermissions: ['requisitions.create', 'requisitions.read'] },
  // HR runs it; the executive watches; hiring managers see their own openings.
  {
    navLabel: 'Onboarding',
    anyOfPermissions: ['onboarding.hr', 'onboarding.it', 'onboarding.manager', 'onboarding.read'],
  },
  {
    navLabel: 'Recruiting',
    anyOfPermissions: ['recruiting.manage', 'recruiting.read', 'recruiting.interview'],
  },
  { navLabel: 'Documents', requiredPermission: 'documents.read' },
  { navLabel: 'Knowledge', requiredPermission: 'knowledge.read' },
  { navLabel: 'Workflows', requiredPermission: 'workflows.read' },
  { navLabel: 'Calendar', requiredPermission: 'calendar.read' },
  { navLabel: 'Finance', requiredPermission: 'budgets.read' },
  { navLabel: 'Audit', requiredPermission: 'audit.read' },
  { navLabel: 'Runtime', requiredPermission: 'audit.read' },
  { navLabel: 'Policy', requiredPermission: 'policy.read' },
  { navLabel: 'Approval Queue', requiredPermission: 'approvals.decide' },
  { navLabel: 'Apps' },
  { navLabel: 'Integrations' },
  { navLabel: 'Insights', requiredPermission: 'insights.read' },
  { navLabel: 'AI Assistant' },
  { navLabel: 'Search' },
  { navLabel: 'Settings' },
];

/** Whether the given permission set unlocks the named module (fail-closed). */
export function isModuleVisible(navLabel: string, permissions: readonly string[]): boolean {
  const module = MODULE_DEFINITIONS.find((entry) => entry.navLabel === navLabel);
  if (module?.anyOfPermissions !== undefined) {
    return module.anyOfPermissions.some((permission) => permissions.includes(permission));
  }
  if (module?.requiredPermission === undefined) {
    return true;
  }
  return permissions.includes(module.requiredPermission);
}
