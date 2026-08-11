/**
 * @nexora/plugin-sdk — builders.
 *
 * Fluent builders that produce canonical manifest and contribution shapes.
 * They reduce authoring boilerplate and keep manifests valid by
 * construction.
 */

import type { PluginManifest, PluginCapability, PluginDependency } from '@nexora/contracts/plugin';
import type { Scope } from '@nexora/contracts/identity';

import type { CommandContribution, CommandHandler, CommandMetadata } from '../commands/index.js';
import type {
  NavigationContribution,
  SidebarItem,
  TopBarItem,
  CommandPaletteItem,
} from '../navigation/index.js';
import type { PageContribution } from '../pages/index.js';
import type { WidgetContribution } from '../widgets/index.js';
import type { PluginId } from '../types/index.js';

/**
 * A fluent builder for the canonical {@link PluginManifest} (SAD.md §7.2).
 *
 * @example
 * ```ts
 * const manifest = new PluginManifestBuilder('com.nexora.projects', 'Projects', '1.0.0')
 *   .withCapability({ id: 'projects.create_project', description: 'Create a project', skillId: 'skills.create_project' })
 *   .requires('projects:read')
 *   .grants('projects:write')
 *   .dependsOn({ id: 'com.nexora.identity', range: '^1.0.0' })
 *   .build();
 * ```
 */
export class PluginManifestBuilder {
  readonly #capabilities: PluginCapability[] = [];
  readonly #requiredScopes: Scope[] = [];
  readonly #grantedScopes: Scope[] = [];
  readonly #emits: string[] = [];
  readonly #subscribes: string[] = [];
  readonly #dependencies: PluginDependency[] = [];
  #navigation: { id: string; label: string; icon?: string }[] = [];

  /**
   * @param id      - reverse-DNS plugin id.
   * @param name    - plugin name.
   * @param version - plugin semantic version.
   */
  constructor(
    private readonly id: string,
    private readonly name: string,
    private readonly version: string,
  ) {}

  /** Adds a capability declaration. */
  withCapability(capability: PluginCapability): this {
    this.#capabilities.push(capability);
    return this;
  }

  /** Adds a required scope (install-time permission review). */
  requires(scope: Scope): this {
    this.#requiredScopes.push(scope);
    return this;
  }

  /** Adds a granted scope. */
  grants(scope: Scope): this {
    this.#grantedScopes.push(scope);
    return this;
  }

  /** Declares an emitted event type. */
  emits(eventType: string): this {
    this.#emits.push(eventType);
    return this;
  }

  /** Declares a subscribed event type. */
  subscribes(eventType: string): this {
    this.#subscribes.push(eventType);
    return this;
  }

  /** Adds a plugin dependency. */
  dependsOn(dependency: PluginDependency): this {
    this.#dependencies.push(dependency);
    return this;
  }

  /** Adds a navigation registration. */
  withNavigation(id: string, label: string, icon?: string): this {
    this.#navigation.push({ id, label, icon });
    return this;
  }

  /** Builds the canonical manifest. */
  build(): PluginManifest {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      capabilities: this.#capabilities,
      permissions: {
        required: this.#requiredScopes,
        granted: this.#grantedScopes,
      },
      events: {
        emits: this.#emits,
        subscribes: this.#subscribes,
      },
      navigation: this.#navigation,
      dependencies: this.#dependencies,
      compatibility: {
        platformApiVersion: '0.1.0',
        sdkVersion: '0.1.0',
      },
    };
  }
}

/** A fluent builder for {@link NavigationContribution}. */
export class NavigationBuilder {
  readonly #sidebar: SidebarItem[] = [];
  readonly #topBar: TopBarItem[] = [];
  readonly #palette: CommandPaletteItem[] = [];
  #pluginId?: PluginId;

  /** Sets the owning plugin id. */
  ownedBy(pluginId: PluginId): this {
    this.#pluginId = pluginId;
    return this;
  }

  /** Adds a sidebar item (with optional children). */
  addSidebarItem(item: SidebarItem): this {
    this.#sidebar.push(item);
    return this;
  }

  /** Adds a top-bar item. */
  addTopBarItem(item: TopBarItem): this {
    this.#topBar.push(item);
    return this;
  }

  /** Adds a command palette item. */
  addPaletteItem(item: CommandPaletteItem): this {
    this.#palette.push(item);
    return this;
  }

  /** Builds the navigation contribution. */
  build(): NavigationContribution {
    return {
      kind: 'navigation',
      sidebar: this.#sidebar,
      topBar: this.#topBar,
      palette: this.#palette,
      pluginId: this.#pluginId,
    };
  }
}

/** A fluent builder for {@link CommandContribution}. */
export class CommandBuilder {
  #pluginId?: PluginId;
  #exposeToAi = false;

  /**
   * @param command - the command metadata.
   * @param handler - the command handler.
   */
  constructor(
    private readonly command: CommandMetadata,
    private readonly handler: CommandHandler,
  ) {}

  /** Sets the owning plugin id. */
  ownedBy(pluginId: PluginId): this {
    this.#pluginId = pluginId;
    return this;
  }

  /** Marks the command as available to the AI (AIR.md §10). */
  exposeToAi(): this {
    this.#exposeToAi = true;
    return this;
  }

  /** Builds the command contribution. */
  build(): CommandContribution {
    return {
      kind: 'command',
      command: { ...this.command, pluginId: this.command.pluginId ?? this.#pluginId },
      handler: this.handler,
      exposeToAi: this.#exposeToAi,
    };
  }
}

/** A fluent builder for {@link PageContribution}. */
export class PageBuilder {
  #requiredScope?: string;
  #settingsSchemaId?: string;
  #pluginId?: PluginId;

  /**
   * @param id          - stable page id.
   * @param title       - page title.
   * @param componentId - frontend component id.
   * @param route       - mount route.
   */
  constructor(
    private readonly id: string,
    private readonly title: string,
    private readonly componentId: string,
    private readonly route: string,
  ) {}

  /** Sets the required permission scope. */
  requiresScope(scope: string): this {
    this.#requiredScope = scope;
    return this;
  }

  /** Links a settings schema id. */
  withSettingsSchema(schemaId: string): this {
    this.#settingsSchemaId = schemaId;
    return this;
  }

  /** Sets the owning plugin id. */
  ownedBy(pluginId: PluginId): this {
    this.#pluginId = pluginId;
    return this;
  }

  /** Builds the page contribution. */
  build(): PageContribution {
    return {
      kind: 'page',
      id: this.id,
      title: this.title,
      componentId: this.componentId,
      route: this.route,
      requiredScope: this.#requiredScope,
      settingsSchemaId: this.#settingsSchemaId,
      pluginId: this.#pluginId,
    };
  }
}

/** A fluent builder for {@link WidgetContribution}. */
export class WidgetBuilder {
  #refreshMs?: number;
  #requiredScope?: string;
  #pluginId?: PluginId;

  /**
   * @param id     - stable widget id.
   * @param title  - widget title.
   * @param widget - the dashboard widget.
   */
  constructor(
    private readonly id: string,
    private readonly title: string,
    private readonly widget: WidgetContribution['widget'],
  ) {}

  /** Sets the refresh interval hint, in milliseconds. */
  refreshEvery(refreshMs: number): this {
    this.#refreshMs = refreshMs;
    return this;
  }

  /** Sets the required permission scope. */
  requiresScope(scope: string): this {
    this.#requiredScope = scope;
    return this;
  }

  /** Sets the owning plugin id. */
  ownedBy(pluginId: PluginId): this {
    this.#pluginId = pluginId;
    return this;
  }

  /** Builds the widget contribution. */
  build(): WidgetContribution {
    return {
      kind: 'widget',
      id: this.id,
      title: this.title,
      widget: this.widget,
      refreshMs: this.#refreshMs,
      requiredScope: this.#requiredScope,
      pluginId: this.#pluginId,
    };
  }
}
