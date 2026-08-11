# Business rules — Workspaces

Every rule cites its source (PSD.md §4 WS-\*; DOMAIN_MODEL.md §9; BR =
PSD business rules). Rules marked **(service)** are enforced across
aggregates by a domain service; the rest are aggregate invariants.

## Lifecycle

| #     | Rule                                                                                                                                            | Enforcement                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| WS-R5 | `provisioning → active`, `active → suspended/archived`, `suspended → active/archived`; `archived` is terminal                                   | `WorkspaceLifecyclePolicy` / `WORKSPACE_TRANSITIONS` (single authoritative table) |
| BR-3  | An archived workspace is immutable — every mutation (settings, branding, preferences, features, bindings, membership, installation) is rejected | `WorkspaceArchivalPolicy.assertCanMutate` + service gating                        |
| —     | A **suspended** workspace cannot execute workflows                                                                                              | `WorkspaceLifecyclePolicy.assertCanExecuteWorkflows` (core invariant)             |
| —     | Activation from `provisioning` or `suspended` is allowed; activation of an active/archived workspace is rejected                                | transition table                                                                  |

## Membership

| #     | Rule                                                                                                          | Enforcement                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| WS-R2 | A user may belong to multiple workspaces; each membership carries its own role                                | membership keyed by `workspaceId + userId`; separate aggregate |
| WS-R6 | Roles are `owner`, `admin`, `member`                                                                          | `MEMBERSHIP_ROLES`                                             |
| —     | Members can only be added to **active** workspaces (provisioning/suspended are frozen, archived is immutable) | `WorkspaceMembershipPolicy.assertCanAddMember`                 |
| —     | Removal is allowed while the workspace is not archived                                                        | `assertCanRemoveMember`                                        |
| —     | A workspace must always retain at least one `owner`: the last owner cannot be removed **or demoted**          | `assertCanRemoveOwner` (service, via `countOwners`)            |
| —     | A user cannot be added twice to the same workspace                                                            | `MemberAlreadyExistsError` (service)                           |
| —     | Role changes emit no domain event in v1 (catalog has `member_added`/`member_removed` only)                    | documented no-op in `changeRole`                               |

## Installation (Apps)

| #   | Rule                                                      | Enforcement                                    |
| --- | --------------------------------------------------------- | ---------------------------------------------- |
| —   | A plugin may only be installed in an **active** workspace | `WorkspaceInstallationPolicy.assertCanInstall` |
| —   | A plugin can be installed at most once per workspace      | `PluginAlreadyInstalledError` (service)        |
| —   | Removal is allowed while the workspace is not archived    | `assertCanRemoveInstallation`                  |
| —   | Every installed plugin belongs to exactly one workspace   | installation keyed by `workspaceId + pluginId` |

## Bindings

| #   | Rule                                                                               | Enforcement                                                                                 |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| —   | Agent, knowledge, workflow bindings are unique per workspace (no duplicate attach) | collection invariants in the `Workspace` aggregate                                          |
| —   | Detach of a non-bound id is rejected                                               | `*NotBoundError` / `*NotAttachedError`                                                      |
| —   | Search and notification providers are single slots (attach replaces)               | `attachSearchProvider` / `attachNotificationProvider` return `false` on same-provider no-op |
| —   | Binding changes are allowed while the workspace is not archived                    | `WorkspaceBindingPolicy.assertCanChangeBindings`                                            |

## Slug uniqueness

| #   | Rule                                                  | Enforcement                                                                                                      |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| —   | Workspace slugs are unique **within an organization** | domain contract: `SlugUniquenessPolicy` + repository port `existsBySlug` (scoped unique index at infrastructure) |
| —   | Slug format: 3–64 chars, lowercase, `-`/`_` separated | `WorkspaceSlug.create`                                                                                           |
| —   | The same slug may exist in different organizations    | uniqueness is scoped by `organizationId`                                                                         |

## Value constraints

- `WorkspaceName`: non-empty, ≤ 120 chars.
- `WorkspaceColor`: hex color, normalized to lowercase.
- `WorkspaceIcon`: non-empty, ≤ 32 chars (emoji or short token).
- `WorkspaceTimeZone`: non-empty, ≤ 64 chars (full IANA validation delegated to
  infrastructure).
- `WorkspaceLocale`: non-empty, ≤ 16 chars (e.g. `en`, `de-DE`).
- Feature names: lowercase dotted segments with underscores (e.g.
  `ai_autonomy`, `guest_access`).
- `WorkspaceType`: one of `WORKSPACE_TYPES` (engineering, hr, finance, sales,
  marketing, executive, operations, general).
- `WorkspaceVisibility`: `private` | `company`.

## Cross-domain notes

- **Archival vs active workflows:** BR-3's requirement that a workspace cannot
  be archived while workflows are running / approvals pending is a
  cross-domain concern enforced by the workflow/approval contexts at the
  application layer — the domain allows archival from `active`/`suspended`
  and documents the application-layer check.
- **Settings updates emit `workspace.settings_updated`; branding updates emit
  `workspace.branding_updated`; preferences and feature toggles are silent in
  v1** (no events in the catalog).
