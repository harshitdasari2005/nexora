# Best Practices

Guidelines for building consistent, safe, high-quality plugins.

## Contribution design

- **One contribution per concern.** Register focused contributions (one
  command, one widget) rather than bundling unrelated surfaces.
- **Use the builders** — `PluginManifestBuilder`, `NavigationBuilder`,
  `CommandBuilder`, `PageBuilder`, `WidgetBuilder` keep shapes valid by
  construction.
- **Declarative over imperative.** Prefer `manifest.capabilities`/
  `manifest.events`/`manifest.navigation` for what is static; use
  `registerXxx` for what needs runtime wiring (handlers, providers, agents).
- **Id everything.** Contribution ids (`page`, `widget`, `command`, `agent`,
  ...) must be stable — they are persisted in workspaces and referenced by
  routes and dashboards. Never reuse an id for a different purpose.

## Lifecycle safety

- **Register, don't leak.** Start background work in `activate`, stop it in
  `deactivate`/`onDisable`. Never leave timers or listeners after `disable`.
- **Clean up on uninstall.** `onUninstall` runs before the registry entry is
  removed — remove external resources and webhooks there.
- **Handle `onUpdate` migrations.** Run data/configuration migrations in
  `onUpdate(context, previousVersion)`, not in `activate`.
- **Assume enable-after-failure.** A failed `activate` moves the plugin to
  `failed`; keep `activate` idempotent so a retry/rollback is safe.

## AI integration

- **Expose skills, not agent internals.** Register skills/tools as
  contributions; let the platform call `applyAgentContributions` to wire
  them. Never mutate another plugin's agent.
- **Capabilities drive discovery.** Every skill should back at least one
  `CapabilityContribution` (or a manifest capability) so the Enterprise AI
  Orchestrator can discover it (AIR.md §5).
- **`exposeToAi` only for safe commands.** Commands exposed to AI become
  tools (AIR.md §10) — keep `destructive` false unless approval is wired.
- **Permissions flow to agents.** A plugin's `granted` scopes bound what its
  agents may do; keep the permission declaration aligned with actual agent
  tool side effects.

## Configuration

- **Defaults everywhere.** Every `ConfigurationSchema` property should carry a
  `default`; the typed store reads via `getOrDefault` so plugins degrade
  gracefully.
- **Secrets stay secret.** Mark secret properties `secret: true` — never log
  or render their values.
- **Validate before use.** Assume config can be missing or stale after an
  upgrade; validate at `activate`, not at read time.

## Events

- **Subscriptions are idempotent.** Event delivery may retry; handlers must
  tolerate duplicates (dedupe by correlation id).
- **Prefer `awaitable: true` for state mutations** so ordering is preserved;
  use fire-and-forget only for notifications/telemetry.
- **Emit, don't call.** Communicate with other plugins/domains through events
  (SAD.md §11), never direct imports.

## Testing

- **Test with `MockPlugin` and `fakePluginContext`** for contribution
  surfaces; test full flows with `DefaultPluginInstaller` + `PluginRegistry`.
- **Test the lifecycle matrix** — install/enable/disable/upgrade/uninstall and
  the failure paths (missing dependency, throwing activate, bad manifest).
- **Pin manifest validity** — one test asserting `ManifestValidator` passes
  catches drift from the canonical contract.
