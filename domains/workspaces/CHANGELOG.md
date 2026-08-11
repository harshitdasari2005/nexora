# Changelog

All notable changes to `@nexora/domain-workspaces` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/).

## [0.1.0] — 2026-08-09

### Added

- All aggregates validate **before** mutating: a rejected settings/branding
  update leaves the aggregate unchanged (no partial writes, no version bump),
  and empty updates are true no-ops.
- **Workspace aggregate** with child entities: `WorkspaceSettings`,
  `WorkspaceBranding`, `WorkspacePreferences`, `WorkspaceFeature`, and the
  five bindings (`WorkspaceAgentBinding`, `WorkspaceKnowledgeBinding`,
  `WorkspaceWorkflowBinding`, `WorkspaceSearchBinding`,
  `WorkspaceNotificationBinding`).
- **Separate aggregate roots**: `WorkspaceMembership` (own identity, role,
  join time; last-owner rule spans memberships) and `WorkspaceInstallation`
  (per-workspace plugin installs).
- **11 value objects**: `WorkspaceId`, `WorkspaceName`, `WorkspaceSlug`,
  `WorkspaceStatus`, `WorkspaceVisibility`, `WorkspaceType`, `WorkspaceColor`,
  `WorkspaceIcon`, `WorkspaceTimeZone`, `WorkspaceLocale`, `MembershipRole`.
- **18 domain events** (`workspace.*`) on the shared envelope, category
  `platform` (Tenancy = DOM-01 Generic).
- **6 policies**: `WorkspaceLifecyclePolicy` (single authoritative
  `WORKSPACE_TRANSITIONS` table), `WorkspaceArchivalPolicy`,
  `WorkspaceMembershipPolicy`, `WorkspaceInstallationPolicy`,
  `WorkspaceBindingPolicy`, `SlugUniquenessPolicy`.
- **3 repository interfaces** and **4 domain services**:
  `WorkspaceDomainService`, `WorkspaceMembershipService`,
  `WorkspaceInstallationService`, `WorkspacePolicyService`.
- **191 unit tests** covering creation, lifecycle, settings/branding/
  preferences, features, all bindings, membership (incl. last-owner
  protection), installation, policies, and services.

### Fixed

- `FEATURE_NAME_PATTERN` now accepts underscores in the first segment so
  documented feature names like `ai_autonomy` and `guest_access` are valid.

[0.1.0]: https://github.com/nexora/nexora/releases/tag/domain-workspaces-v0.1.0
