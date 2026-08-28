/**
 * @nexora/app-api — command-center composition.
 *
 * Wires the generic Command Center engine (S24 Phase 2) with the API-layer
 * implementations: the Phase 1 domain catalog + initial command-center
 * definitions feed the registry, the membership resolver derives the
 * effective business role from trusted membership, and the widget data
 * provider resolves every widget through the EXISTING application handlers.
 *
 * This is pure composition — the engine itself is unchanged; a future
 * command center is one more registration in the seed.
 */

import type { MembershipRepository } from '@nexora/domain-organizations';
import type { WorkspaceMembershipRepository, WorkspaceRepository } from '@nexora/domain-workspaces';
import type { GetTenantMeasurementsHandler } from '@nexora/module-measurements';
import type { ListProjectsHandler } from '@nexora/application-projects';
import type { ListEmployeesHandler } from '@nexora/application-hr';
import type { ListDocumentsHandler } from '@nexora/application-documents';
import type { ListArticlesHandler } from '@nexora/application-knowledge';
import type { ListActivityHandler, ListNotificationsHandler } from '@nexora/module-notifications';
import type {
  ListBudgetUtilizationHandler,
  ListExpensesHandler,
} from '@nexora/application-finance';
import { createInitialCatalog } from '@nexora/module-domains';
import {
  CommandCenterApplicationService,
  CommandCenterRegistry,
  GetCommandCenterHandler,
  INITIAL_COMMAND_CENTERS,
} from '@nexora/module-command-center';

import { MembershipBusinessRoleResolver } from '../business-context/business-role-resolver.js';
import { ApiCommandCenterWidgetDataProvider } from './widget-data-provider.js';

/** Everything the API layer needs to compose the command center surface. */
export interface BuildCommandCenterOptions {
  /** Organization memberships (role resolution fallback scope). */
  memberships: MembershipRepository;
  /** Workspace memberships (role resolution preferred scope). */
  workspaceMemberships: WorkspaceMembershipRepository;
  /** Workspaces (role resolution workspace-type override, S27 Phase 6). */
  workspaces: WorkspaceRepository;
  /** Tenant measurement snapshot handler (kpi + workflow health sources). */
  getTenantMeasurements: GetTenantMeasurementsHandler;
  /** Tenant-scoped project listing handler. */
  listProjects: ListProjectsHandler;
  /** Tenant-scoped employee listing handler. */
  listEmployees: ListEmployeesHandler;
  /** Workspace-scoped document listing handler. */
  listDocuments: ListDocumentsHandler;
  /** Workspace-scoped knowledge article listing handler. */
  listArticles: ListArticlesHandler;
  /** Tenant/workspace-scoped activity feed handler. */
  listActivity: ListActivityHandler;
  /** Recipient-scoped notification inbox handler. */
  listNotifications: ListNotificationsHandler;
  /** Workspace-scoped budget-utilization handler (finance section, S35). */
  listBudgetUtilization: ListBudgetUtilizationHandler;
  /** Workspace-scoped expense listing handler (finance section, S35). */
  listExpenses: ListExpensesHandler;
}

/** Builds the command-center handler (generic engine + API implementations). */
export function buildCommandCenter(options: BuildCommandCenterOptions): GetCommandCenterHandler {
  const catalog = createInitialCatalog();
  const registry = new CommandCenterRegistry(catalog);
  for (const definition of INITIAL_COMMAND_CENTERS) {
    registry.register(definition);
  }
  const service = new CommandCenterApplicationService({
    registry,
    catalog,
    // The SAME trusted role-resolution seam the AI Runtime uses (Phase 3):
    // Command Center and AI can never disagree about who the user is.
    roleResolver: new MembershipBusinessRoleResolver({
      memberships: options.memberships,
      workspaceMemberships: options.workspaceMemberships,
      workspaces: options.workspaces,
    }),
    dataProvider: new ApiCommandCenterWidgetDataProvider({
      getTenantMeasurements: options.getTenantMeasurements,
      listProjects: options.listProjects,
      listEmployees: options.listEmployees,
      listDocuments: options.listDocuments,
      listArticles: options.listArticles,
      listActivity: options.listActivity,
      listNotifications: options.listNotifications,
      listBudgetUtilization: options.listBudgetUtilization,
      listExpenses: options.listExpenses,
    }),
  });
  return new GetCommandCenterHandler(service);
}
