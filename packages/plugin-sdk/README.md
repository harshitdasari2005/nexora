# @nexora/plugin-sdk

The Nexora **Plugin SDK** (SAD.md §7) — the canonical SDK for building every first-party and third-party Nexora plugin. First-party apps are plugins too (ADR-003), so this package is the single installability contract for the platform.

Plugins contribute: **applications, commands, pages, navigation, dashboards, widgets, agents, skills, tools, workflows, event handlers, configuration, permissions, search providers, knowledge providers, and notification providers.**

**This package contains NO business logic.** It is completely generic and domain-agnostic.

## Design rules

| Rule                             | Why                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canonical manifest**           | The plugin manifest is `PluginManifest` from `@nexora/contracts/plugin` — never redefined. The SDK adds only descriptive `PluginMetadata` and authoring helpers. |
| **Reuse the Agent SDK**          | Agents, skills, tools, capabilities, and knowledge providers are the Agent SDK's contracts; the SDK wires plugin contributions onto `BaseAgent` instances.       |
| **Declarative frontend**         | Pages, navigation, widgets are component **ids**, never framework code. No React/Next.js coupling.                                                               |
| **Composition over inheritance** | Plugins are wired from injected dependencies and a `ContributionSet`; `BasePlugin` is the single extension point.                                                |
| **Failure containment**          | A failed install never leaves a partial registry entry — the installer rolls back automatically.                                                                 |
| **Lifecycle-driven**             | Every operation (install/enable/disable/upgrade/uninstall/rollback) is driven by a state machine with audit history.                                             |

## Package structure

| Module           | Contents                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base/`          | Abstract `BasePlugin`, `PluginContext`, `PluginDependencies`, `PluginContribution` union, `ContributionSet`                                           |
| `manifest/`      | Canonical manifest re-exports, `PluginMetadata`, `SdkPluginManifest`, `toCanonicalManifest`                                                           |
| `lifecycle/`     | `PluginLifecycleStateMachine` (discovered → installed → enabled → disabled → updating → failed → uninstalled) + canonical mapper                      |
| `registry/`      | `PluginRegistry`, `PluginRegistryEntry`, `PluginFactory`, `PluginResolver`, `PluginRegistrationMetadata`                                              |
| `installer/`     | `PluginInstaller` contract + `DefaultPluginInstaller` (install/enable/disable/upgrade/uninstall/rollback, dependency resolution, failure containment) |
| `loader/`        | `PluginLoader`, `PluginModule`, `LoadOptions`, `LoadedPlugin`                                                                                         |
| `permissions/`   | `PermissionContribution`, `RoleContribution`, `PolicyContribution`, `ApprovalContribution`                                                            |
| `navigation/`    | `NavigationContribution`, `MenuItem`, `SidebarItem`, `TopBarItem`, `CommandPaletteItem`, `RouteContribution`                                          |
| `pages/`         | `PageContribution`, `DashboardContribution`, `ViewContribution`                                                                                       |
| `widgets/`       | `WidgetContribution`, `DashboardWidget`, `CardWidget`, `MetricWidget`                                                                                 |
| `commands/`      | `CommandContribution`, `CommandHandler`, `CommandMetadata`                                                                                            |
| `events/`        | `EventContribution`, `EventSubscription`, `EventHandler`                                                                                              |
| `configuration/` | `ConfigurationContribution`, `ConfigurationSchema`, `ConfigurationDefaults`, `PluginConfiguration` (typed store)                                      |
| `workflow/`      | `WorkflowContribution`, `WorkflowTemplate`, `WorkflowTrigger` (canonical `WorkflowDefinition` reuse)                                                  |
| `knowledge/`     | `KnowledgeContribution` (Agent SDK `KnowledgeProvider`/`KnowledgeSource` reuse)                                                                       |
| `search/`        | `SearchContribution`, `SearchProvider`, `SearchIndex`, `SearchResult`                                                                                 |
| `notifications/` | `NotificationContribution`, `NotificationProvider` (canonical `Notification` reuse)                                                                   |
| `agents/`        | `AgentContribution`, `CapabilityContribution`, `resolveContribution`, `applyAgentContributions`                                                       |
| `tools/`         | `ToolContribution` (Agent SDK `Tool` reuse)                                                                                                           |
| `skills/`        | `SkillContribution` (Agent SDK `Skill` reuse)                                                                                                         |
| `hooks/`         | `PluginHooks`, `PluginHookContext` (onInstall/onEnable/onDisable/onUpdate/onUninstall)                                                                |
| `builders/`      | Fluent `PluginManifestBuilder`, `NavigationBuilder`, `CommandBuilder`, `PageBuilder`, `WidgetBuilder`                                                 |
| `validators/`    | `ManifestValidator`, `DependencyValidator`, `CompatibilityValidator`, `PermissionValidator`, semver range satisfier                                   |
| `testing/`       | `MockPlugin`, `FakePluginContext`, `FakeRegistry`, `FakeInstaller`, `testPluginManifest`                                                              |
| `errors/`        | `PluginValidationError`, `PluginDependencyError`, `PluginInstallationError`-family, `PluginCompatibilityError`, `PluginLifecycleError`                |
| `types/`         | `PluginId`, `ContributionKind`, `PLUGIN_SDK_VERSION`                                                                                                  |

## Quick start

```ts
import { BasePlugin } from '@nexora/plugin-sdk/base';
import { PluginManifestBuilder, NavigationBuilder } from '@nexora/plugin-sdk/builders';

const manifest = new PluginManifestBuilder('com.nexora.projects', 'Projects', '1.0.0')
  .withCapability({
    id: 'projects.create_project',
    description: 'Create a project',
    skillId: 'skills.create_project',
  })
  .requires('projects:read')
  .grants('projects:write')
  .build();

class ProjectsPlugin extends BasePlugin {
  constructor() {
    super({ manifest });
  }

  async activate(context: PluginContext): Promise<void> {
    this.registerNavigation(
      new NavigationBuilder()
        .addSidebarItem({ id: 'projects', label: 'Projects', route: '/projects' })
        .build(),
    );
    this.registerCommand({
      kind: 'command',
      command: {
        id: 'projects.new',
        name: 'New Project',
        description: 'Create a project',
        keywords: ['new'],
      },
      handler: async ({ args }) => ({ created: args[0] }),
    });
  }
}

// Installed and enabled through the installer:
const installer = new DefaultPluginInstaller({
  registry,
  platformVersion: '0.1.0',
  sdkVersion: '0.1.0',
});
await installer.install({ plugin: new ProjectsPlugin() });
```

## Documentation

- [Architecture guide](docs/ARCHITECTURE.md) — how the SDK realizes SAD.md §7.
- [Plugin developer guide](docs/PLUGIN_DEVELOPER.md) — building a plugin end-to-end.
- [Publishing guide](docs/PUBLISHING.md) — manifests, compatibility, marketplace metadata.
- [Best practices](docs/BEST_PRACTICES.md) — contributions, lifecycle, AI integration.

## Quality

- TypeScript strict mode; zero `any`; zero `TODO`; every public export JSDoc-documented.
- 136 unit tests across lifecycle, registry, installation, dependency resolution, builders, validators, permissions, navigation, configuration, AI contributions, and errors (`pnpm test`).
- No circular dependencies; no duplicated contracts.
