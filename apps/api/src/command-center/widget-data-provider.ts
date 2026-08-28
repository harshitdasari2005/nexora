/**
 * @nexora/app-api — command-center widget data provider.
 *
 * The S24 Phase 2 {@link CommandCenterWidgetDataProvider} implementation.
 * Every widget data source is resolved through an EXISTING application
 * handler — there is no second data-access layer for the Command Center.
 * Data sources are deduplicated (each source group is fetched ONCE per
 * request, in parallel) so multiple widgets sharing a source never cause
 * redundant queries (S22 performance principles preserved).
 *
 * Every handler is called with the TRUSTED context resolved by the route
 * (tenant from authenticated membership, workspace verified against
 * membership) — a forged scope can never widen the query. Handlers that
 * fail resolve to an empty widget (fail safe, no internals leaked).
 */

import type { TenantMeasurementsSnapshot } from '@nexora/module-measurements';
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
import type {
  CommandCenterContext,
  CommandCenterWidgetDataProvider,
} from '@nexora/module-command-center';
import type {
  CommandCenterEntryDto,
  CommandCenterWidgetDataDto,
  CommandCenterWidgetDefinition,
} from '@nexora/contracts/command-center';

/** Dependencies of the provider (existing handlers only). */
export interface CommandCenterWidgetDataProviderDependencies {
  /** The tenant measurement snapshot (kpi + workflow health sources). */
  getTenantMeasurements: GetTenantMeasurementsHandler;
  /** Tenant-scoped project listing. */
  listProjects: ListProjectsHandler;
  /** Tenant-scoped employee listing. */
  listEmployees: ListEmployeesHandler;
  /** Workspace-scoped document listing. */
  listDocuments: ListDocumentsHandler;
  /** Workspace-scoped knowledge article listing. */
  listArticles: ListArticlesHandler;
  /** Tenant/workspace-scoped activity feed. */
  listActivity: ListActivityHandler;
  /** Recipient-scoped notification inbox. */
  listNotifications: ListNotificationsHandler;
  /** Workspace-scoped budget-utilization projection (finance section, S35). */
  listBudgetUtilization: ListBudgetUtilizationHandler;
  /** Workspace-scoped expense listing (finance section, S35). */
  listExpenses: ListExpensesHandler;
}

/** The maximum number of items rendered per feed widget. */
const FEED_LIMIT = 10;

/** Implements the module widget-data-provider port over existing handlers. */
export class ApiCommandCenterWidgetDataProvider implements CommandCenterWidgetDataProvider {
  readonly #deps: CommandCenterWidgetDataProviderDependencies;

  constructor(dependencies: CommandCenterWidgetDataProviderDependencies) {
    this.#deps = dependencies;
  }

  async resolveData(
    context: CommandCenterContext,
    widgets: readonly CommandCenterWidgetDefinition[],
  ): Promise<Readonly<Record<string, CommandCenterWidgetDataDto>>> {
    const needed = new Set(widgets.map((widget) => widget.dataSource));
    const needs = (prefixes: readonly string[]): boolean =>
      [...needed].some((source) => prefixes.includes(source));

    // Each source GROUP is fetched once, in parallel (dedup by group).
    const [
      measurements,
      projects,
      employees,
      documents,
      articles,
      activity,
      notifications,
      budgetUtilization,
      expenses,
    ] = await Promise.all([
      needs([
        'measurements.overview.users',
        'measurements.overview.projects',
        'measurements.overview.workspaces',
        'workflows.health',
      ])
        ? this.#safe(() =>
            this.#deps.getTenantMeasurements.handle({ tenantId: context.tenantId as never }),
          )
        : Promise.resolve(undefined),
      needs(['projects.active', 'projects.list'])
        ? this.#safe(async () => {
            const result = await this.#deps.listProjects.handle({
              organizationId: context.tenantId as never,
            });
            return result.ok ? result.value : [];
          })
        : Promise.resolve(undefined),
      needs(['employees.active', 'employees.list'])
        ? this.#safe(async () => {
            const result = await this.#deps.listEmployees.handle({
              organizationId: context.tenantId as never,
            });
            return result.ok ? result.value : [];
          })
        : Promise.resolve(undefined),
      needs(['documents.list']) && context.workspaceId !== undefined
        ? this.#safe(async () => {
            const result = await this.#deps.listDocuments.handle({
              organizationId: context.tenantId as never,
              workspaceId: context.workspaceId as never,
            });
            return result.ok ? result.value : [];
          })
        : Promise.resolve(undefined),
      needs(['knowledge.articles']) && context.workspaceId !== undefined
        ? this.#safe(async () => {
            const result = await this.#deps.listArticles.handle({
              tenantId: context.tenantId as never,
              workspaceId: context.workspaceId as never,
            });
            return result.ok ? result.value : [];
          })
        : Promise.resolve(undefined),
      needs(['activity.recent'])
        ? this.#safe(async () => {
            const result = await this.#deps.listActivity.handle({
              tenantId: context.tenantId as never,
              ...(context.workspaceId === undefined
                ? {}
                : { workspaceId: context.workspaceId as never }),
              limit: FEED_LIMIT,
            });
            return result.ok ? result.value.activity : [];
          })
        : Promise.resolve(undefined),
      needs(['notifications.unread'])
        ? this.#safe(async () => {
            const result = await this.#deps.listNotifications.handle({
              userId: context.userId as never,
              tenantId: context.tenantId as never,
              ...(context.workspaceId === undefined
                ? {}
                : { workspaceId: context.workspaceId as never }),
              limit: FEED_LIMIT,
            });
            return result.ok ? result.value.notifications : [];
          })
        : Promise.resolve(undefined),
      needs(['budgets.active', 'budgets.utilization', 'budgets.health']) &&
      context.workspaceId !== undefined
        ? this.#safe(async () => {
            const result = await this.#deps.listBudgetUtilization.handle({
              organizationId: context.tenantId as never,
              workspaceId: context.workspaceId as never,
            });
            return result.ok ? result.value : [];
          })
        : Promise.resolve(undefined),
      needs(['expenses.pending']) && context.workspaceId !== undefined
        ? this.#safe(async () => {
            const result = await this.#deps.listExpenses.handle({
              organizationId: context.tenantId as never,
              workspaceId: context.workspaceId as never,
            });
            return result.ok ? result.value : [];
          })
        : Promise.resolve(undefined),
    ]);

    const groups = {
      measurements,
      projects,
      employees,
      documents,
      articles,
      activity,
      notifications,
      budgetUtilization,
      expenses,
    };
    const data: Record<string, CommandCenterWidgetDataDto> = {};
    for (const widget of widgets) {
      data[widget.id] = toWidgetData(widget.dataSource, groups);
    }
    return data;
  }

  /** Runs a fetch, resolving failures to `undefined` (fail safe). */
  async #safe<T>(fetch: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fetch();
    } catch {
      return undefined;
    }
  }
}

/** The raw source groups fetched (deduplicated) for one request. */
interface SourceGroups {
  measurements?: TenantMeasurementsSnapshot;
  projects?: readonly { id: string; name: string; status: string; createdAt: string }[];
  employees?: readonly { id: string; name: string; status: string }[];
  documents?: readonly { id: string; title: string; contentType: string; status: string }[];
  articles?: readonly { id: string; title: string; status: string }[];
  activity?: readonly { id: string; title: string; body: string; occurredAt: string }[];
  notifications?: readonly {
    id: string;
    title: string;
    body: string;
    status: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    action?: { href?: string };
  }[];
  budgetUtilization?: readonly {
    budgetId: string;
    name: string;
    currency: string;
    allocatedMinorUnits: number;
    spentMinorUnits: number;
    utilizationPercent: number;
    status: string;
  }[];
  expenses?: readonly {
    id: string;
    description: string;
    amountMinorUnits: number;
    currency: string;
    status: string;
  }[];
}

/** Maps one widget's data source to its typed widget data. */
function toWidgetData(source: string, groups: SourceGroups): CommandCenterWidgetDataDto {
  switch (source) {
    case 'measurements.overview.users':
      return kpi(groups.measurements?.overview.users, 'Registered users across the tenant');
    case 'measurements.overview.projects':
      return kpi(groups.measurements?.overview.projects, 'Projects across the tenant');
    case 'measurements.overview.workspaces':
      return kpi(groups.measurements?.overview.workspaces, 'Workspaces across the tenant');
    case 'projects.active':
      return kpi(
        (groups.projects ?? []).filter((project) => project.status === 'active').length,
        'Projects currently in active status',
      );
    case 'employees.active':
      return kpi(
        (groups.employees ?? []).filter((employee) => employee.status === 'active').length,
        'Employees currently in active status',
      );
    case 'workflows.health':
      return {
        kind: 'list',
        items: (groups.measurements?.workflowHealth ?? []).map((metric) => ({
          id: metric.definitionKey,
          title: metric.definitionKey,
          subtitle: `${metric.succeeded}/${metric.total} terminal runs`,
          status: `${metric.successRate.toFixed(0)}% success`,
          href: '/app/workflows',
        })),
      };
    case 'projects.list':
      return {
        kind: 'list',
        items: (groups.projects ?? []).map((project): CommandCenterEntryDto => ({
          id: project.id,
          title: project.name,
          subtitle: `Created ${new Date(project.createdAt).toLocaleDateString()}`,
          status: project.status,
          href: '/app/projects',
        })),
      };
    case 'employees.list':
      return {
        kind: 'list',
        items: (groups.employees ?? []).map((employee): CommandCenterEntryDto => ({
          id: employee.id,
          title: employee.name,
          status: employee.status,
          href: '/app/employees',
        })),
      };
    case 'documents.list':
      return {
        kind: 'list',
        items: (groups.documents ?? []).map((document): CommandCenterEntryDto => ({
          id: document.id,
          title: document.title,
          subtitle: document.contentType,
          status: document.status,
          href: '/app/documents',
        })),
      };
    case 'knowledge.articles':
      return {
        kind: 'list',
        items: (groups.articles ?? []).map((article): CommandCenterEntryDto => ({
          id: article.id,
          title: article.title,
          status: article.status,
          href: '/app/knowledge',
        })),
      };
    case 'activity.recent':
      return {
        kind: 'activity',
        items: (groups.activity ?? []).map((item): CommandCenterEntryDto => ({
          id: item.id,
          title: item.title,
          body: item.body,
          occurredAt: item.occurredAt,
        })),
      };
    case 'notifications.unread':
      return {
        kind: 'attention',
        items: (groups.notifications ?? [])
          .filter((notification) => notification.status === 'unread')
          .map((notification): CommandCenterEntryDto => ({
            id: notification.id,
            title: notification.title,
            body: notification.body,
            priority: notification.priority,
            href: notification.action?.href,
          })),
      };
    case 'budgets.active':
      return kpi(
        (groups.budgetUtilization ?? []).filter((budget) => budget.status !== 'closed').length,
        'Budgets currently open in the workspace',
      );
    case 'budgets.utilization': {
      // This vertical slice does not aggregate across currencies (Money's
      // doc comment) — non-closed budgets are summed as-is, which is exact
      // for the single-currency workspaces this demo data models.
      const open = (groups.budgetUtilization ?? []).filter((budget) => budget.status !== 'closed');
      const allocated = open.reduce((sum, budget) => sum + budget.allocatedMinorUnits, 0);
      const spent = open.reduce((sum, budget) => sum + budget.spentMinorUnits, 0);
      const percent = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
      return { kind: 'kpi', value: `${percent}%`, hint: 'Approved spend across open budgets' };
    }
    case 'budgets.health':
      return {
        kind: 'list',
        items: (groups.budgetUtilization ?? []).map((budget): CommandCenterEntryDto => ({
          id: budget.budgetId,
          title: budget.name,
          subtitle: `${formatMoney(budget.spentMinorUnits, budget.currency)} of ${formatMoney(budget.allocatedMinorUnits, budget.currency)}`,
          status:
            budget.status === 'under_review'
              ? 'Under review'
              : budget.status === 'closed'
                ? 'Closed'
                : `${budget.utilizationPercent}% used`,
          href: '/app/finance',
        })),
      };
    case 'expenses.pending':
      return {
        kind: 'attention',
        items: (groups.expenses ?? [])
          .filter((expense) => expense.status === 'pending')
          .map((expense): CommandCenterEntryDto => ({
            id: expense.id,
            title: expense.description,
            body: formatMoney(expense.amountMinorUnits, expense.currency),
            priority: 'normal',
            href: '/app/finance',
          })),
      };
    default:
      // Unreachable: registration validates the data-source vocabulary.
      return { kind: 'list', items: [] };
  }
}

/** Formats a minor-units amount for display (e.g. `INR 1250.00`). */
function formatMoney(minorUnits: number, currency: string): string {
  return `${currency} ${(minorUnits / 100).toFixed(2)}`;
}

/** Builds a kpi datum (fail-safe default when the source is unavailable). */
function kpi(value: number | undefined, hint: string): CommandCenterWidgetDataDto {
  return { kind: 'kpi', value: String(value ?? 0), hint };
}
