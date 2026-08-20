/**
 * @nexora/app-web — module definitions (S34 RBAC).
 *
 * Maps each sidebar nav item to the RBAC permission that gates it. This is
 * PRESENTATION ONLY — hiding a module the caller lacks permission for is UX,
 * never the access control itself: every route behind it re-checks the SAME
 * permission server-side via `authorizePermission` (apps/api/src/business-
 * context/permissions.ts), so a forged client state can never reveal or
 * reach anything real. A module with no `requiredPermission` (Overview,
 * Command Center, Apps, Integrations, AI Assistant, Search, Settings) is
 * universal — every authenticated role can see it.
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
}

/** The nav → permission mapping (S34). */
export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  { navLabel: 'Overview' },
  { navLabel: 'Command Center' },
  { navLabel: 'Agent', requiredPermission: 'agent.use' },
  { navLabel: 'Problems', requiredPermission: 'problems.read' },
  { navLabel: 'Projects', requiredPermission: 'projects.read' },
  { navLabel: 'Employees', requiredPermission: 'employees.read' },
  { navLabel: 'Documents', requiredPermission: 'documents.read' },
  { navLabel: 'Knowledge', requiredPermission: 'knowledge.read' },
  { navLabel: 'Workflows', requiredPermission: 'workflows.read' },
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
  if (module?.requiredPermission === undefined) {
    return true;
  }
  return permissions.includes(module.requiredPermission);
}
