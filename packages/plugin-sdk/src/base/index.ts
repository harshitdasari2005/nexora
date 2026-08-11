/**
 * @nexora/plugin-sdk — base plugin.
 *
 * The abstract `BasePlugin`: the single contract every Nexora plugin
 * implements (SAD.md §7, ADR-003 — first-party apps are plugins too). It
 * owns identity, manifest, version, lifecycle, configuration, health, and
 * contribution registration — and knows nothing about HR, Projects,
 * Finance, or any business domain.
 *
 * Plugins implement two hooks: {@link BasePlugin.activate} (register
 * contributions, start background work) and optionally
 * {@link BasePlugin.deactivate}. Lifecycle hooks (`onInstall`, `onEnable`,
 * ...) are overridable extension points (see `@nexora/plugin-sdk/hooks`).
 */

import type { PluginManifest } from '@nexora/contracts/plugin';
import type { ConfigManager } from '@nexora/config';
import { createLogger, type Logger } from '@nexora/shared/logger';

import type { AgentContribution, CapabilityContribution } from '../agents/index.js';
import type { CommandContribution } from '../commands/index.js';
import {
  PluginConfiguration,
  type ConfigurationContribution,
  type ConfigurationDefaults,
  type ConfigurationSchema,
} from '../configuration/index.js';
import type { EventContribution } from '../events/index.js';
import type { PluginHookContext, PluginHooks } from '../hooks/index.js';
import type { KnowledgeContribution } from '../knowledge/index.js';
import { PluginLifecycleStateMachine } from '../lifecycle/index.js';
import type { PluginMetadata } from '../manifest/index.js';
import type { NavigationContribution, RouteContribution } from '../navigation/index.js';
import type { NotificationContribution } from '../notifications/index.js';
import type { PageContribution, DashboardContribution, ViewContribution } from '../pages/index.js';
import type {
  ApprovalContribution,
  PermissionContribution,
  PolicyContribution,
  RoleContribution,
} from '../permissions/index.js';
import type { SearchContribution } from '../search/index.js';
import type { SkillContribution } from '../skills/index.js';
import type { ToolContribution } from '../tools/index.js';
import type { ContributionKind, PluginId } from '../types/index.js';
import type { WidgetContribution } from '../widgets/index.js';
import type { WorkflowContribution } from '../workflow/index.js';

/** The discriminated union of every contribution a plugin can register. */
export type PluginContribution =
  | PermissionContribution
  | RoleContribution
  | PolicyContribution
  | ApprovalContribution
  | NavigationContribution
  | RouteContribution
  | PageContribution
  | DashboardContribution
  | ViewContribution
  | WidgetContribution
  | CommandContribution
  | EventContribution
  | ConfigurationContribution
  | WorkflowContribution
  | KnowledgeContribution
  | SearchContribution
  | NotificationContribution
  | AgentContribution
  | ToolContribution
  | SkillContribution
  | CapabilityContribution;

/** A health snapshot produced by {@link BasePlugin.health}. */
export interface PluginHealthSnapshot {
  /** Aggregate status across all checks. */
  status: 'healthy' | 'degraded' | 'unavailable';
  /** Per-check outcomes. */
  checks: readonly { id: string; healthy: boolean; detail?: string }[];
}

/** The runtime context handed to {@link BasePlugin.activate}. */
export interface PluginContext {
  /** The plugin id. */
  pluginId: PluginId;
  /** The plugin semantic version. */
  version: string;
  /** The plugin's typed configuration store. */
  configuration: PluginConfiguration;
  /** The platform version the plugin runs on. */
  platformVersion: string;
  /** The Plugin SDK version the plugin was built against. */
  sdkVersion: string;
  /** A scoped structured logger. */
  logger: Logger;
}

/** Dependencies injected into a plugin at construction (composition). */
export interface PluginDependencies {
  /** The canonical plugin manifest (SAD.md §7.2). */
  manifest: PluginManifest;
  /** Descriptive metadata (author, license, ...). */
  metadata?: PluginMetadata;
  /** Optional logger; defaults to a scoped structured logger. */
  logger?: Logger;
  /** Optional configuration manager from the Configuration Platform. */
  configManager?: ConfigManager;
  /** Default settings merged into the plugin configuration store. */
  settings?: ConfigurationDefaults;
  /** Optional settings schema describing the defaults. */
  settingsSchema?: ConfigurationSchema;
  /** The platform version (for compatibility reporting). */
  platformVersion?: string;
}

/** A collection of a plugin's contributions, keyed by kind. */
export class ContributionSet {
  readonly #contributions = new Map<ContributionKind, PluginContribution[]>();

  /**
   * Registers a contribution.
   *
   * Kinds with a stable identity (pages, widgets, commands, routes, agents,
   * tools, skills, capabilities, workflows) deduplicate by that identity.
   * Kinds without one (permissions, roles, policies, approvals, navigation,
   * events, configuration, knowledge/search/notification providers) allow
   * any number of distinct contributions and deduplicate only the exact
   * same object reference — so a plugin can register several navigation
   * surfaces or event subscriptions.
   */
  add(contribution: PluginContribution): void {
    const kind = contribution.kind;
    const existing = this.#contributions.get(kind) ?? [];
    const identity = contributionIdentity(contribution);
    const duplicate =
      identity === undefined
        ? existing.includes(contribution)
        : existing.some((entry) => contributionIdentity(entry) === identity);
    if (duplicate) {
      return;
    }
    this.#contributions.set(kind, [...existing, contribution]);
  }

  /** All registered contributions, grouped by kind. */
  all(): readonly PluginContribution[] {
    return [...this.#contributions.values()].flat();
  }

  /** Contributions of a given kind. */
  byKind<T extends PluginContribution>(kind: T['kind']): readonly T[] {
    return (this.#contributions.get(kind) ?? []) as unknown as readonly T[];
  }

  /** Whether any contribution of the kind is registered. */
  has(kind: ContributionKind): boolean {
    return (this.#contributions.get(kind)?.length ?? 0) > 0;
  }

  /** The number of registered contributions. */
  get size(): number {
    return [...this.#contributions.values()].reduce((sum, entries) => sum + entries.length, 0);
  }
}

/**
 * Extracts a stable identity from a contribution for dedup, or `undefined`
 * for kinds without one (dedup by reference only — see
 * {@link ContributionSet.add}).
 */
function contributionIdentity(contribution: PluginContribution): string | undefined {
  switch (contribution.kind) {
    case 'route':
      return contribution.path;
    case 'page':
    case 'dashboard':
    case 'view':
    case 'widget':
    case 'agent':
    case 'tool':
    case 'skill':
      return contribution.id;
    case 'workflow':
      return contribution.templates.map((template) => template.id).join(',');
    case 'capability':
      return contribution.capability.manifest.id;
    case 'command':
      return contribution.command.id;
    case 'knowledge':
    case 'search':
    case 'notification':
      return contribution.provider.name;
    // Kinds without a stable identity — allow multiple distinct
    // contributions, dedup by reference only.
    case 'permission':
    case 'role':
    case 'policy':
    case 'approval':
    case 'navigation':
    case 'event':
    case 'configuration':
      return undefined;
  }
}

/** Identity derived from the canonical manifest. */
export interface PluginIdentity {
  /** Plugin id, reverse-DNS style. */
  id: PluginId;
  /** Plugin name. */
  name: string;
}

/**
 * The abstract base plugin. Extend this to build a concrete plugin.
 *
 * @example
 * ```ts
 * class ProjectsPlugin extends BasePlugin {
 *   async activate(context: PluginContext): Promise<void> {
 *     this.registerNavigation({ kind: 'navigation', sidebar: [...], topBar: [], palette: [] });
 *     this.registerCommand({ kind: 'command', command: {...}, handler: ... });
 *   }
 * }
 * ```
 */
export abstract class BasePlugin implements PluginHooks {
  /** The plugin identity (immutable). */
  readonly identity: PluginIdentity;
  /** The canonical plugin manifest. */
  readonly manifest: PluginManifest;
  /** Descriptive metadata, when provided. */
  readonly metadata?: PluginMetadata;
  /** The plugin semantic version. */
  readonly version: string;
  /** The plugin lifecycle state machine. */
  readonly lifecycle: PluginLifecycleStateMachine;
  /** The plugin's contribution collection. */
  readonly contributions: ContributionSet;
  /** The plugin's typed configuration store. */
  readonly configuration: PluginConfiguration;
  /** The platform version the plugin runs on. */
  readonly platformVersion: string;

  readonly #logger: Logger;
  readonly #configManager?: ConfigManager;
  readonly #healthChecks = new Map<string, () => Promise<boolean> | boolean>();
  #activated = false;

  /**
   * @param dependencies - the plugin's manifest and injected dependencies.
   */
  constructor(dependencies: PluginDependencies) {
    this.manifest = dependencies.manifest;
    this.identity = { id: dependencies.manifest.id, name: dependencies.manifest.name };
    this.version = dependencies.manifest.version;
    this.metadata = dependencies.metadata;
    this.platformVersion = dependencies.platformVersion ?? '0.0.0';
    this.lifecycle = new PluginLifecycleStateMachine(this.identity.id);
    this.contributions = new ContributionSet();
    this.configuration = new PluginConfiguration(dependencies.settings);
    this.#logger = dependencies.logger ?? createLogger({ service: `plugin:${this.identity.id}` });
    this.#configManager = dependencies.configManager;
    this.lifecycle.onTransition((transition) => {
      this.#logger.debug(`plugin lifecycle: ${transition.from} → ${transition.to}`, {
        reason: transition.reason,
      });
    });
  }

  /**
   * The activation hook — the only method concrete plugins must implement.
   * Register contributions and start any background work. Runs after the
   * plugin is enabled; a throwing `activate` fails the enable (the installer
   * moves the plugin to `failed`).
   */
  abstract activate(context: PluginContext): Promise<void> | void;

  /** Deactivation hook — stop background work; default no-op. */
  async deactivate(): Promise<void> {
    // Default no-op; override to release resources.
  }

  /** Registers a health check probe. */
  registerHealthCheck(id: string, probe: () => Promise<boolean> | boolean): void {
    this.#healthChecks.set(id, probe);
  }

  /** Runs all registered health checks. */
  async health(): Promise<PluginHealthSnapshot> {
    const checks = await Promise.all(
      [...this.#healthChecks.entries()].map(async ([id, probe]) => {
        try {
          const healthy = await probe();
          return { id, healthy };
        } catch (error) {
          return {
            id,
            healthy: false,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const failed = checks.filter((check) => !check.healthy).length;
    const status = failed === 0 ? 'healthy' : failed === checks.length ? 'unavailable' : 'degraded';
    return { status, checks };
  }

  // -- Contribution registration -------------------------------------------------

  registerContribution(contribution: PluginContribution): void {
    this.contributions.add(contribution);
  }

  registerPermission(contribution: PermissionContribution): void {
    this.registerContribution(contribution);
  }

  registerRole(contribution: RoleContribution): void {
    this.registerContribution(contribution);
  }

  registerPolicy(contribution: PolicyContribution): void {
    this.registerContribution(contribution);
  }

  registerApproval(contribution: ApprovalContribution): void {
    this.registerContribution(contribution);
  }

  registerNavigation(contribution: NavigationContribution): void {
    this.registerContribution(contribution);
  }

  registerRoute(contribution: RouteContribution): void {
    this.registerContribution(contribution);
  }

  registerPage(contribution: PageContribution): void {
    this.registerContribution(contribution);
  }

  registerDashboard(contribution: DashboardContribution): void {
    this.registerContribution(contribution);
  }

  registerView(contribution: ViewContribution): void {
    this.registerContribution(contribution);
  }

  registerWidget(contribution: WidgetContribution): void {
    this.registerContribution(contribution);
  }

  registerCommand(contribution: CommandContribution): void {
    this.registerContribution(contribution);
  }

  registerEvent(contribution: EventContribution): void {
    this.registerContribution(contribution);
  }

  registerConfiguration(contribution: ConfigurationContribution): void {
    this.registerContribution(contribution);
  }

  registerWorkflow(contribution: WorkflowContribution): void {
    this.registerContribution(contribution);
  }

  registerKnowledge(contribution: KnowledgeContribution): void {
    this.registerContribution(contribution);
  }

  registerSearch(contribution: SearchContribution): void {
    this.registerContribution(contribution);
  }

  registerNotifications(contribution: NotificationContribution): void {
    this.registerContribution(contribution);
  }

  registerAgent(contribution: AgentContribution): void {
    this.registerContribution(contribution);
  }

  registerTool(contribution: ToolContribution): void {
    this.registerContribution(contribution);
  }

  registerSkill(contribution: SkillContribution): void {
    this.registerContribution(contribution);
  }

  registerCapability(contribution: CapabilityContribution): void {
    this.registerContribution(contribution);
  }

  // -- Lifecycle hooks (PluginHooks) ---------------------------------------------

  /** @inheritdoc */
  onInstall(_context: PluginHookContext): Promise<void> | void {
    // Default no-op; override for install-time setup.
  }

  /** @inheritdoc */
  onEnable(_context: PluginHookContext): Promise<void> | void {
    // Default no-op; override to start work eagerly.
  }

  /** @inheritdoc */
  onDisable(_context: PluginHookContext): Promise<void> | void {
    // Default no-op; override to stop work.
  }

  /** @inheritdoc */
  onUpdate(_context: PluginHookContext, _previousVersion: string): Promise<void> | void {
    // Default no-op; override to migrate data or configuration.
  }

  /** @inheritdoc */
  onUninstall(_context: PluginHookContext): Promise<void> | void {
    // Default no-op; override for teardown.
  }

  /** Marks the plugin as activated (called by the installer). */
  setActivated(): void {
    this.#activated = true;
  }

  /** Marks the plugin as deactivated. */
  setDeactivated(): void {
    this.#activated = false;
  }

  /** Whether the plugin has been activated. */
  get isActivated(): boolean {
    return this.#activated;
  }

  /** The scoped logger (for reporting by plugins). */
  protected get logger(): Logger {
    return this.#logger;
  }

  /** The configuration manager (Configuration Platform seam), when injected. */
  protected get configManager(): ConfigManager | undefined {
    return this.#configManager;
  }
}
