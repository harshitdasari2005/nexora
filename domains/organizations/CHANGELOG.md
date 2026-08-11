# Changelog

All notable changes to `@nexora/domain-organizations` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`0.1.0` foundation** — the Organizations bounded context domain core (DOMAIN_MODEL.md §1 Tenancy):
  - Aggregates: `Organization` (+ `OrganizationProfile` and `OrganizationSettings` child entities), `OrganizationMembership`, each with behavior-driven invariants and domain-event emission.
  - Value objects: `OrganizationId`, `OrganizationName`, `OrganizationSlug`, `OrganizationStatus`, `OrganizationType`.
  - Domain events on the shared envelope (category `platform`, DOM-01 Generic): `OrganizationCreated`, `OrganizationActivated`, `OrganizationSuspended`, `OrganizationArchived`, `MemberAdded`, `MemberRemoved`, `OrganizationSettingsUpdated`.
  - Repository interfaces: `OrganizationRepository`, `MembershipRepository`.
  - Domain services: `OrganizationDomainService` (create/activate/suspend/archive/settings/profile/queries), `MembershipDomainService` (add/remove/change-role/list with the last-owner rule).
  - Policies: `OrganizationLifecyclePolicy`, `OrganizationArchivalPolicy`, `MembershipPolicy`, `SlugUniquenessPolicy`.
  - Error hierarchy extending `@nexora/shared` with canonical codes.
  - 147 unit tests; strict TypeScript; zero `any`; zero `TODO`; every public export documented.

### Changed (code review hardening)

- **Validate before mutate** — `OrganizationSettings.update` and
  `OrganizationProfile.update` now validate the whole input _before_ assigning
  any field, so a rejected update leaves the aggregate untouched (no partial
  writes). Regression tests lock this in.
- **No-op updates are no-ops** — `Organization.updateSettings`/`updateProfile`
  only bump the version and update `updatedAt` when at least one field
  actually changed (previously an empty update bumped the version).
- **`MembershipRole` moved to value objects** — `MEMBERSHIP_ROLES` and
  `MembershipRole` now live in `value-objects/membership-role.ts`, breaking the
  type-level cycle between the events module and the membership entity
  (entities, events, and policies all reference the neutral home).
- **Simplified retention validation** — dropped the redundant
  `Number.isInteger` clause (`isIntInRange` already validates integers).
