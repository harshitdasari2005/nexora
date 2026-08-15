/**
 * @nexora/contracts — command center definition contracts (S24 Phase 2).
 *
 * The generic Command Center vocabulary of the role-aware AI operating
 * system. A CommandCenterDefinition is CONFIGURATION, not code: it says
 * WHAT should be displayed for a business role — widgets (with a widget
 * type and a data-source reference) and actions (read/navigation only in
 * Phase 2) — and is resolved FROM the Phase 1 Domain → Role model.
 *
 * - A `CommandCenterDefinition` binds exactly one business role
 *   (`roleId`, namespaced by `domainId`) to a widget/action layout. The
 *   core engine never references a job title: it renders whatever
 *   definitions are registered, so a future domain (e.g. Legal) registers
 *   a command center the same way.
 * - A `WidgetDefinition` describes WHAT to display (type + title + a
 *   data-source reference). Data resolution is delegated to a provider
 *   behind the module port — the provider calls the EXISTING application
 *   services (projects, employees, documents, knowledge, activity,
 *   notifications, measurements). No second data-access layer.
 * - An `ActionDefinition` is read/navigation-oriented in Phase 2 (kind
 *   `navigate`). Governed business execution stays in later phases and
 *   must continue through the existing application/domain/authorization
 *   layers — nothing here grants execution.
 *
 * Security contract (S24): command centers are DEFINITIONS ONLY. They
 * grant no authorization — the effective business role is resolved by the
 * server from trusted membership (never from URL/query/body/AI/frontend
 * state), and every widget data source keeps enforcing tenant/workspace
 * boundaries through the existing application services.
 */

/** A stable, machine-readable command center id, e.g. `ceo`. */
export type CommandCenterId = string;

/** The widget kinds the generic renderer understands (minimum Phase 2 set). */
export type CommandCenterWidgetType = 'kpi' | 'activity' | 'attention' | 'list';

/** The read/navigation-only action kinds supported in Phase 2. */
export type CommandCenterActionKind = 'navigate';

/** A widget layout hint: the grid-column span (1 = half, 2 = full width). */
export type CommandCenterWidgetSpan = 1 | 2;

/**
 * A widget of a command center (S24 Phase 2). A widget describes WHAT
 * should be displayed — a reusable widget TYPE mapped to a renderer by the
 * frontend, plus a `dataSource` reference resolved by the data provider.
 * The role determines which widgets are composed, never which renderer is
 * used: there is one renderer per widget type, shared by every role.
 */
export interface CommandCenterWidgetDefinition {
  /** Stable widget id, unique within the command center, e.g. `attention`. */
  id: string;
  /** The widget kind (mapped to a renderer by the frontend). */
  type: CommandCenterWidgetType;
  /** Human-readable widget title, e.g. `Needs your attention`. */
  title: string;
  /** Optional widget description. */
  description?: string;
  /**
   * The data-source reference (e.g. `notifications.unread`,
   * `projects.list`, `measurements.overview.projects`). The data provider
   * maps this to an existing application service query; the reference is
   * validated at registration against the supported source vocabulary.
   */
  dataSource: string;
  /** Optional layout hint (1 = half width, 2 = full width). */
  span?: CommandCenterWidgetSpan;
}

/**
 * An action a command-center user can initiate (S24 Phase 2). Phase 2
 * actions are read/navigation-oriented (`navigate`); governed business
 * execution belongs to later phases and must continue through the existing
 * application/domain/authorization layers.
 */
export interface CommandCenterActionDefinition {
  /** Stable action id, unique within the command center, e.g. `view_projects`. */
  id: string;
  /** Human-readable action label, e.g. `View projects`. */
  label: string;
  /** The action kind (`navigate` only in Phase 2). */
  kind: CommandCenterActionKind;
  /** The frontend destination (a route), e.g. `/app/projects`. */
  href: string;
  /** Optional action icon hint. */
  icon?: string;
}

/**
 * A registered command center (S24 Phase 2): the widget/action composition
 * bound to one business role (`domainId.roleId`). The engine is generic —
 * it renders whatever definitions are registered. Definitions are
 * code/config registered at startup (deterministic, no per-request scans)
 * and grant nothing.
 */
export interface CommandCenterDefinition {
  /** Stable command center id, e.g. `ceo`. */
  id: CommandCenterId;
  /** Human-readable command center name, e.g. `Command Center`. */
  name: string;
  /** The owning business domain id (must resolve to a registered domain). */
  domainId: string;
  /** The bound business role id (must resolve to a role of that domain). */
  roleId: string;
  /** Optional description of the command center's purpose. */
  description?: string;
  /** The composed widgets, in display order. */
  widgets: readonly CommandCenterWidgetDefinition[];
  /** The composed actions (read/navigation only in Phase 2). */
  actions: readonly CommandCenterActionDefinition[];
}

/** An entry of a list/activity/attention widget (generic entry shape). */
export interface CommandCenterEntryDto {
  /** The underlying record id. */
  id: string;
  /** The entry title (e.g. project name, activity title). */
  title: string;
  /** Optional supporting body (e.g. the activity item body). */
  body?: string;
  /** Optional supporting text (e.g. document type, workflow definition). */
  subtitle?: string;
  /** Optional lifecycle status (e.g. `active`, `published`). */
  status?: string;
  /** Optional frontend destination. */
  href?: string;
  /** ISO-8601 UTC time, when the entry is time-based. */
  occurredAt?: string;
  /** Optional notification priority. */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

/** The data of one rendered widget (kind-tagged). */
export type CommandCenterWidgetDataDto =
  | {
      /** The widget kind. */
      kind: 'kpi';
      /** The formatted metric value (e.g. `12`). */
      value: string;
      /** Optional supporting hint (e.g. `Active across the tenant`). */
      hint?: string;
      /** Optional semantic tone for the metric. */
      tone?: 'neutral' | 'success' | 'warning' | 'danger';
    }
  | {
      /** The widget kind. */
      kind: 'activity' | 'attention' | 'list';
      /** The widget entries. */
      items: readonly CommandCenterEntryDto[];
    };

/** A widget as exposed to clients (definition, minus internal data-source wiring). */
export interface CommandCenterWidgetDto {
  /** Stable widget id. */
  id: string;
  /** The widget kind. */
  type: CommandCenterWidgetType;
  /** Human-readable widget title. */
  title: string;
  /** Optional widget description. */
  description?: string;
  /** Optional layout hint (1 = half width, 2 = full width). */
  span?: CommandCenterWidgetSpan;
}

/** An action as exposed to clients. */
export interface CommandCenterActionDto {
  /** Stable action id. */
  id: string;
  /** Human-readable action label. */
  label: string;
  /** The action kind (`navigate` only in Phase 2). */
  kind: CommandCenterActionKind;
  /** The frontend destination. */
  href: string;
  /** Optional action icon hint. */
  icon?: string;
}

/**
 * The full command center view returned by `GET /api/command-center`: the
 * resolved definition (with the business domain/role context resolved from
 * the Phase 1 catalog) plus the data of every widget, keyed by widget id.
 * Widget data is resolved server-side through the EXISTING application
 * services — the client never composes business data.
 */
export interface CommandCenterDto {
  /** The command center id. */
  id: string;
  /** Human-readable command center name. */
  name: string;
  /** The owning business domain id (trusted server-side resolution). */
  domainId: string;
  /** The owning business domain name. */
  domainName: string;
  /** The bound business role id (trusted server-side resolution). */
  roleId: string;
  /** The bound business role name. */
  roleName: string;
  /** Optional command center description. */
  description?: string;
  /** The composed widgets, in display order. */
  widgets: readonly CommandCenterWidgetDto[];
  /** The composed actions (read/navigation only in Phase 2). */
  actions: readonly CommandCenterActionDto[];
  /** Widget id → widget data. */
  data: Readonly<Record<string, CommandCenterWidgetDataDto>>;
}
