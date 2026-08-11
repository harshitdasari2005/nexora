# Publishing Guide

How to prepare a plugin for distribution and installation across tenants.

## 1. Versioning

- Plugins follow **SemVer**. The manifest `version` is the plugin version.
- The manifest declares the **Plugin SDK version** it was built against
  (`compatibility.sdkVersion`) and the minimum **platform API version**
  (`compatibility.platformApiVersion`).
- **Major SDK bumps are breaking** — a plugin built against SDK `0.x` will not
  install on a platform running SDK `1.x` (the `CompatibilityValidator`
  enforces same-major + at-least-minimum).

## 2. Compatibility contract

| Field                              | Meaning                                  | Check                                          |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| `compatibility.sdkVersion`         | SDK version the plugin was built against | running SDK must be same major and ≥ this      |
| `compatibility.platformApiVersion` | minimum platform API required            | running platform must be same major and ≥ this |

Keep `sdkVersion` honest: rebuild and bump it when you depend on new SDK
surface. The installer rejects incompatible plugins at install time
(`PluginCompatibilityError`).

## 3. Dependencies

Declare every plugin you depend on in `manifest.dependencies` (`id@range`):

```ts
.dependsOn({ id: 'com.nexora.identity', range: '^1.0.0' })
```

- Ranges use the standard satisfier: `*`, exact, `^`, `~`, and `>`, `>=`, `<`,
  `<=` comparators, ANDed by commas/spaces, ORed by `||`.
- **No self-dependencies**, and dependencies must already be installed before
  your plugin installs.
- First-party apps may depend on the identity/workspace platform plugins.

## 4. Permissions (install-time review)

Declare exactly what you need — the permission review is a trust boundary:

```ts
.requires('projects:read')     // read access to projects
.grants('projects:write')      // scopes the plugin can grant its own agents
```

- `required` scopes are what your plugin needs to function.
- `granted` scopes are what your plugin (and its agents) may grant to others.
- A plugin declaring capabilities but **no required scopes** fails the
  `PermissionValidator`.

## 5. Marketplace metadata

For marketplace publication, attach the canonical `MarketplaceMetadata`
(publisher, summary, description, categories, icon). The SDK `PluginMetadata`
(author, license, description, homepage, keywords) is the authoring-side
companion.

## 6. Idempotency and upgrade safety

- **Upgrades replace identity, never change it** — an upgrade must keep the
  same plugin `id` (the installer rejects id mismatches).
- Implement `onUpdate(context, previousVersion)` to migrate configuration or
  data between versions.
- Test the full lifecycle before publishing: install → enable → disable →
  enable → upgrade → uninstall (the `test/installer.test.ts` suite is the
  template).

## 7. Pre-publish checklist

- [ ] `pnpm --filter <plugin> typecheck` passes (strict, zero `any`)
- [ ] Manifest passes `ManifestValidator` (run `assertValid` in a test)
- [ ] `compatibility.sdkVersion` matches the SDK you built against
- [ ] Dependencies declared with correct ranges
- [ ] Permissions reviewed: no scope overlap between required/granted
- [ ] Lifecycle hooks implemented and tested
- [ ] `onUninstall` cleans up side effects
