# Aggregate Design

## Overview

The Organizations bounded context defines two aggregate roots:

| Aggregate                | Owns                                                                                        | Identity                                         | Transaction boundary                                                | Invariants live in                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Organization`           | `OrganizationProfile` (child), `OrganizationSettings` (child), lifecycle status, slug, type | `OrganizationId` (`org_...`; also the tenant id) | The whole organization (profile + settings) is persisted atomically | `Organization` methods + `OrganizationLifecyclePolicy` / `OrganizationArchivalPolicy` |
| `OrganizationMembership` | role, joinedAt                                                                              | membership id (`mbr_...`)                        | One membership record                                               | `OrganizationMembership` methods + `MembershipPolicy`                                 |

## Why two aggregates?

Membership is **not** a child of Organization because:

1. **Own lifecycle & repository.** Members are added and removed continuously
   and have their own identity; the task and the spec (PSD.md §4 WS-R2) treat
   membership as a first-class record.
2. **Independent scaling & consistency.** The membership set can be large (a
   company directory) and changes independently of the Organization root;
   loading the whole membership set inside the Organization transaction would
   couple write paths unnecessarily (PERSISTENCE.md §4 aggregate ownership).
3. **Cross-aggregate rules are domain-service concerns.** The last-owner rule
   spans the membership set and needs `countOwners`, which the
   `MembershipDomainService` coordinates — exactly what domain services exist
   for (the same reason deactivation of a User ends Sessions in the identity
   domain).

## Organization aggregate

- **Lifecycle methods**: `activate`, `suspend`, `archive` — each enforces the
  transition table (`ORG_TRANSITIONS`) and emits its event.
- **Mutation methods**: `updateSettings` (emits `organization.settings_updated`
  with the changed keys), `updateProfile`.
- **Archival gating** is applied at the service layer
  (`OrganizationArchivalPolicy.assertCanMutate`) so the platform can evolve the
  rule without touching the aggregate; the aggregate itself enforces value
  invariants (valid settings/profile values) on every call.
- `OrganizationId.create()` generates the id inside the aggregate; the event
  envelope resolves `tenantId` from it (the organization is the tenant).

## OrganizationMembership aggregate

- **Creation** emits `organization.member_added`.
- **`changeRole`** is a no-op for the same role, bumps the version otherwise,
  and does **not** emit an event in v1 (the event catalog only defines
  `member_added`/`member_removed`; a `member_role_changed` event will follow
  when the canonical catalog adds it — see docs/BUSINESS_RULES.md).
- **Removal is a hard delete owned by the service**: the aggregate records no
  removal state; `MembershipDomainService.removeMember` enforces the
  last-owner rule, deletes the record, and emits `organization.member_removed`
  (with the role held at removal time for audit). This keeps re-adding a
  removed member conflict-free (no tombstone on the unique
  `organizationId + userId` key).

### First-owner provisioning flow

Members can only be added to **active** organizations (`MembershipPolicy`), so
an organization has no members during `provisioning`. Intended flow: platform
provisions (default Workspace, system Apps — PSD.md CO-B1) → `activate` → the
application layer adds the first `owner`. The domain deliberately does not
require an owner at activation; the app-layer provisioning flow is responsible
for adding one.

## Value objects

| Value object         | Rules                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `OrganizationId`     | `org_` + UUID v4; factory `create()`/`from()`                                                                              |
| `OrganizationName`   | trimmed, 1–120 chars                                                                                                       |
| `OrganizationSlug`   | lowercase `[a-z0-9]+(-[a-z0-9]+)*`, 3–64 chars; globally unique (domain contract)                                          |
| `OrganizationStatus` | `provisioning \| active \| suspended \| archived`                                                                          |
| `OrganizationType`   | `enterprise \| smb \| startup \| non_profit \| government \| other` (provisioning hint, not an industry tag — PSD.md CO-4) |

## Concurrency

Both aggregates bump a monotonic `version` on every mutation for optimistic
concurrency (EntityMeta); the infrastructure layer uses it in
compare-and-swap writes (PERSISTENCE.md §15).
