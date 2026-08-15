/**
 * @nexora/module-command-center — CommandCenterApplicationService.
 *
 * The generic command-center engine surface (S24 Phase 2): it resolves the
 * caller's EFFECTIVE business role through the {@link CommandCenterRoleResolver}
 * port (implemented by the API layer from trusted membership — never from
 * URL/query/body/AI/frontend state), resolves the bound command-center
 * definition, resolves every widget's data through the
 * {@link CommandCenterWidgetDataProvider} port (implemented by the API layer
 * over the EXISTING application services), and composes the typed
 * {@link CommandCenterDto}.
 *
 * The engine is domain-agnostic: it understands definitions, not job
 * titles. A new role registers a command center in the registry and the
 * same engine renders it. No authorization lives here — the resolver and
 * every widget data source keep enforcing the existing
 * tenant/workspace/authorization model (S24 security contract: business
 * role ≠ authorization role ≠ permission; the server remains authoritative).
 */

import type { CommandCenterDefinition } from '@nexora/contracts/command-center';
import type {
  CommandCenterActionDto,
  CommandCenterDto,
  CommandCenterWidgetDataDto,
  CommandCenterWidgetDefinition,
  CommandCenterWidgetDto,
} from '@nexora/contracts/command-center';
import type { CommandCenterRegistry } from '../registry/command-center-registry.js';

/** The trusted context every resolution derives from. */
export interface CommandCenterContext {
  /** The authenticated user (trusted). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The verified workspace scope, when present (trusted). */
  workspaceId?: string;
}

/**
 * Resolves the caller's EFFECTIVE business role id from trusted context.
 * Implemented by the API layer from trusted membership (e.g. the workspace
 * membership role) — a role supplied by the client is never consulted.
 */
export interface CommandCenterRoleResolver {
  /** Returns the business role id (e.g. `technology.developer`), or `undefined`. */
  resolve(context: CommandCenterContext): Promise<string | undefined>;
}

/**
 * Resolves widget data for a command center. Implemented by the API layer
 * over the EXISTING application services (measurements, activity,
 * notifications, projects, employees, documents, knowledge) — no second
 * data-access layer. The provider receives the trusted context and the
 * widget definitions, and returns widget id → data.
 */
export interface CommandCenterWidgetDataProvider {
  resolveData(
    context: CommandCenterContext,
    widgets: readonly CommandCenterWidgetDefinition[],
  ): Promise<Readonly<Record<string, CommandCenterWidgetDataDto>>>;
}

/** The Phase 1 catalog surface the service needs for display names. */
export interface CommandCenterDomainCatalogPort {
  domains: { get(id: string): { name: string } | undefined };
  roles: { get(id: string): { name: string } | undefined };
}

/** Dependencies of the {@link CommandCenterApplicationService}. */
export interface CommandCenterApplicationServiceDependencies {
  /** The registered command-center definitions. */
  registry: CommandCenterRegistry;
  /** The Phase 1 domain catalog (display names only). */
  catalog: CommandCenterDomainCatalogPort;
  /** The trusted role resolver (membership → business role). */
  roleResolver: CommandCenterRoleResolver;
  /** The widget data provider (over existing application services). */
  dataProvider: CommandCenterWidgetDataProvider;
}

/** The outcome of resolving a command center. */
export type ResolveCommandCenterResult =
  { ok: true; center: CommandCenterDto } | { ok: false; reason: 'no-role' | 'no-command-center' };

/** The generic command-center application service. */
export class CommandCenterApplicationService {
  readonly #registry: CommandCenterRegistry;
  readonly #catalog: CommandCenterDomainCatalogPort;
  readonly #roleResolver: CommandCenterRoleResolver;
  readonly #dataProvider: CommandCenterWidgetDataProvider;

  constructor(dependencies: CommandCenterApplicationServiceDependencies) {
    this.#registry = dependencies.registry;
    this.#catalog = dependencies.catalog;
    this.#roleResolver = dependencies.roleResolver;
    this.#dataProvider = dependencies.dataProvider;
  }

  /**
   * Resolves the caller's command center: trusted role → definition →
   * widget data → typed DTO. Fails safely (`no-role` / `no-command-center`)
   * when the caller has no business role or the role has no command center
   * registered — never an error leaking internals.
   */
  async resolve(context: CommandCenterContext): Promise<ResolveCommandCenterResult> {
    const roleId = await this.#roleResolver.resolve(context);
    if (roleId === undefined) {
      return { ok: false, reason: 'no-role' };
    }
    const definition = this.#registry.resolveByRole(roleId);
    if (definition === undefined) {
      return { ok: false, reason: 'no-command-center' };
    }
    const data = await this.#dataProvider.resolveData(context, definition.widgets);
    return { ok: true, center: toCommandCenterDto(definition, data, roleId, this.#catalog) };
  }
}

/** Handles the command-center query. */
export class GetCommandCenterHandler {
  readonly #service: CommandCenterApplicationService;

  constructor(service: CommandCenterApplicationService) {
    this.#service = service;
  }

  handle(context: CommandCenterContext): Promise<ResolveCommandCenterResult> {
    return this.#service.resolve(context);
  }
}

/** Composes the typed command-center DTO (definition + resolved data + context names). */
function toCommandCenterDto(
  def: CommandCenterDefinition,
  data: Readonly<Record<string, CommandCenterWidgetDataDto>>,
  roleId: string,
  catalog: CommandCenterDomainCatalogPort,
): CommandCenterDto {
  const domain = catalog.domains.get(def.domainId);
  const role = catalog.roles.get(roleId);
  return {
    id: def.id,
    name: def.name,
    domainId: def.domainId,
    domainName: domain?.name ?? def.domainId,
    roleId,
    roleName: role?.name ?? roleId,
    ...(def.description === undefined ? {} : { description: def.description }),
    widgets: def.widgets.map(toWidgetDto),
    actions: def.actions.map(toActionDto),
    data,
  };
}

/** Maps a widget definition to its DTO (omitting absent fields). */
function toWidgetDto(widget: CommandCenterDefinition['widgets'][number]): CommandCenterWidgetDto {
  return {
    id: widget.id,
    type: widget.type,
    title: widget.title,
    ...(widget.description === undefined ? {} : { description: widget.description }),
    ...(widget.span === undefined ? {} : { span: widget.span }),
  };
}

/** Maps an action definition to its DTO (omitting absent fields). */
function toActionDto(action: CommandCenterDefinition['actions'][number]): CommandCenterActionDto {
  return {
    id: action.id,
    label: action.label,
    kind: action.kind,
    href: action.href,
    ...(action.icon === undefined ? {} : { icon: action.icon }),
  };
}
