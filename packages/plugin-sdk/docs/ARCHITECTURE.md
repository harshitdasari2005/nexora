# Plugin SDK — Architecture Guide

How `@nexora/plugin-sdk` realizes the plugin architecture (SAD.md §7) and how it stays consistent with the rest of Nexora.

## 1. The plugin contract (SAD.md §7.2)

Every plugin — first-party app or third-party — declares the same contract:

| Element       | Surface                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| Identity      | `manifest.id` (reverse-DNS) + `manifest.name`                                 |
| Manifest      | canonical `PluginManifest` from `@nexora/contracts/plugin`                    |
| Version       | `manifest.version` (SemVer)                                                   |
| Lifecycle     | `PluginLifecycleStateMachine`                                                 |
| Registration  | `PluginRegistry`                                                              |
| Configuration | `PluginConfiguration` (typed, defaulted)                                      |
| Health        | `registerHealthCheck` + `health()`                                            |
| Capabilities  | `manifest.capabilities` (declarative) + `CapabilityContribution` (imperative) |
| Contributions | `ContributionSet` (21 kinds)                                                  |

**Why a single contract:** the Marketplace, the installer, the shell, the AI Runtime, and the permission system all consume one shape. A plugin is not a special case — it is the unit of extension (ADR-003).

## 2. Lifecycle and installation

```
                    ┌─────────────┐
   discovered ─────►│  install    │
                    └─────────────┘
                         │
                    ┌────▼─────┐   enable   ┌─────────┐   disable   ┌──────────┐
                    │ installed ├───────────►│ enabled │◄───────────►│ disabled │
                    └──────────┘            └─────────┘             └──────────┘
                         │                       │                      │
                     uninstall               upgrade               uninstall
                         │                  (updating)                  │
                    ┌────▼─────┐            ┌─────────┐            ┌────▼─────┐
                    │uninstalled│            │ updating│            │ failed   │
                    └──────────┘            └─────────┘            └──────────┘
                                                                    │  rollback
                                                                    ▼
                                                                installed
```

The installer pipeline for `install`:

```
validate manifest ─► compatibility ─► dependency resolution ─► permission review
      ─► lifecycle → installed ─► register ─► onInstall hook ─► enable (default)
```

**Failure containment:** any failure (validation, missing dependency, throwing `activate`, throwing hook) rolls the plugin back — the registry entry is removed and the machine moves to `uninstalled`/`failed`. A failed install never leaves a partial entry.

## 3. Contributions

A plugin registers contributions imperatively during `activate` (via `this.registerXxx(...)`) or declaratively in the manifest. The `PluginContribution` union (in `base/`) is the SDK's extension taxonomy:

```
permission | role | policy | approval | navigation | route | page | dashboard
| view | widget | command | event | configuration | workflow | knowledge
| search | notification | agent | tool | skill | capability
```

The platform consumes `plugin.contributions.all()` after activation to wire the plugin into the shell, event bus, AI Runtime, and policy engine.

## 4. AI integration (AIR.md §3, §5)

Plugins contribute agents, skills, tools, and capabilities using **Agent SDK contracts** — never redefined:

- `AgentContribution` — a ready `BaseAgent` or a factory.
- `SkillContribution` / `ToolContribution` — Agent SDK `Skill`/`Tool` instances or factories.
- `CapabilityContribution` — Agent SDK `Capability` (the discovery surface the Enterprise AI Orchestrator reads).

`applyAgentContributions(agent, contributions)` registers a plugin's skills/tools onto an agent's registries so agents execute plugin-provided work.

## 5. Dependency graph (no cycles)

```
types ─► manifest ─► lifecycle ─► feature modules (permissions, navigation, ...)
                              │
                              ▼
        agents/tools/skills ─► base ─► registry ─► installer ─► (platform)
        hooks ────────────────┘        │
                              validators ─► errors
```

`base` is the aggregation point and imports only feature modules; nothing imports `base` except `registry`, `installer`, `testing`, and consumers. No module imports a domain or platform module.

## 6. Dependencies

`@nexora/contracts` (canonical manifest, identity, workflow, notification, events), `@nexora/shared` (logger, errors), `@nexora/config` (config manager seam), `@nexora/agent-sdk` (agents, skills, tools, capabilities, knowledge). Nothing else — no frameworks, no HTTP, no LLM providers.
