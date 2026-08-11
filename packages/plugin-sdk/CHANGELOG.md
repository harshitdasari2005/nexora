# Changelog

All notable changes to `@nexora/plugin-sdk` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`0.1.0` foundation** — canonical, generic Plugin SDK (SAD.md §7):
  - Abstract `BasePlugin` with identity, manifest, lifecycle, configuration, health, activation, and typed contribution registration; `ContributionSet` with dedup.
  - Canonical manifest reuse (`@nexora/contracts/plugin`) plus SDK `PluginMetadata` and `SdkPluginManifest`.
  - Lifecycle state machine (discovered → installed → enabled → disabled → updating → failed → uninstalled) with audit history and canonical-state projection.
  - `PluginRegistry` with descriptors, state bookkeeping, and `PluginResolver`; `PluginFactory` and `PluginLoader` contracts.
  - `DefaultPluginInstaller`: install, enable, disable, upgrade, uninstall, rollback — with manifest/compatibility/permission validation, dependency resolution, lifecycle hooks, and automatic failure containment (no partial installs).
  - Contribution modules for permissions, roles, policies, approvals, navigation, routes, pages, dashboards, views, widgets, commands, events, configuration (typed store), workflows, knowledge, search, and notifications.
  - Agent SDK integration: `AgentContribution`, `SkillContribution`, `ToolContribution`, `CapabilityContribution`, `resolveContribution`, and `applyAgentContributions`.
  - Fluent builders (`PluginManifestBuilder`, `NavigationBuilder`, `CommandBuilder`, `PageBuilder`, `WidgetBuilder`).
  - Validators (`ManifestValidator`, `DependencyValidator`, `CompatibilityValidator`, `PermissionValidator`) with a dependency-free semver range satisfier (`^`, `~`, comparators, `*`, AND/OR).
  - Plugin error hierarchy (`PluginValidationError`, `PluginDependencyError`, `PluginCompatibilityError`, `PluginLifecycleError`).
  - Testing support (`MockPlugin`, `FakePluginContext`, `FakeRegistry`, `FakeInstaller`, `testPluginManifest`).
  - 140 unit tests; strict TypeScript; zero `any`; zero `TODO`; every public export documented.

### Changed

- **Contribution identity hardening** — kind-keyed contributions (permission, role, policy, approval, navigation, event, configuration) are no longer collapsed by kind; distinct contributions of the same kind are preserved (dedup by reference only), while identity-keyed contributions (pages, widgets, commands, agents, tools, skills, capabilities, routes, dashboards, views, knowledge/search/notification providers) still dedup by stable identity.
- **Installer** — `upgrade` now registers the new instance before activation so failure bookkeeping stays consistent with the registry entry; a **failed upgrade restores the previous version** (re-activating it when it was enabled) instead of stranding the platform on the broken new instance; a deactivation failure during upgrade marks the previous version `failed` so it is recoverable via `rollback`; `rollback` recovers a `failed` entry to `installed`; platform version defaults to the SDK's version when not injected.
- **Lifecycle** — added `updating` transition table entry used by `upgrade`.
- **Semver satisfier** — comparator parsing now handles multi-char operators (`>=`, `<=`) correctly, and pre-release versions only satisfy ranges that mention a pre-release on the same tuple (npm rule: `1.0.0-alpha` ∉ `^1.0.0`).
- **`MockPlugin`** — `setActivated`/`setDeactivated` now keep the `activated` flag in sync with the lifecycle; health snapshots are named (`HealthSnapshot`).
- **Docs** — README, architecture guide, plugin developer guide, publishing guide, and best practices.
