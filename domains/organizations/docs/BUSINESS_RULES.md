# Business Rules

Authoritative list of the business rules implemented by
`@nexora/domain-organizations`, mapped to the specs (PSD.md §3 CO-_, §4 WS-_,
DOMAIN_MODEL.md §1, §13). Each rule lists where it is enforced.

## Organization lifecycle

| Rule                                                                                                                        | Enforcement                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| An organization is created with status `provisioning` unless an explicit status is supplied.                                | `Organization.create`                                                 |
| Transitions: `provisioning → active`, `active → suspended/archived`, `suspended → active/archived`; `archived` is terminal. | `ORG_TRANSITIONS` / `OrganizationLifecyclePolicy.assertCanTransition` |
| Archival is allowed from `active` and `suspended` only.                                                                     | `OrganizationArchivalPolicy.assertCanArchive`                         |
| An archived organization rejects all mutations (settings, profile, memberships).                                            | `OrganizationArchivalPolicy.assertCanMutate` (+ service gating)       |
| Only `active` organizations accept new members.                                                                             | `MembershipPolicy.assertCanAddMember`                                 |
| Member removal is allowed while the organization is not archived.                                                           | `MembershipPolicy.assertCanRemoveMember`                              |
| A suspended organization freezes new memberships and lifecycle actions while retaining data and audit.                      | lifecycle + membership policies                                       |

## Tenancy & identity

| Rule                                                             | Enforcement                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Slugs are globally unique across the platform (domain contract). | `SlugUniquenessPolicy` + `existsBySlug` + unique index (infra) |
| The organization id is the tenant id (PRD tenant ⇔ PSD Company). | `OrganizationId` / `tenantId`                                  |
| An organization never implies cross-company data access (R-03).  | platform boundary (out of domain)                              |

## Memberships

| Rule                                                                                        | Enforcement                                                          |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A user may be a member of an organization at most once.                                     | `MembershipDomainService.addMember` → `MemberAlreadyExistsError`     |
| A membership role is one of `owner \| admin \| member`.                                     | `OrganizationMembership.create` / `MembershipPolicy.assertValidRole` |
| An organization must retain at least one `owner`.                                           | `MembershipPolicy.assertCanRemoveOwner` (last-owner rule)            |
| The last owner cannot be removed or demoted.                                                | `MembershipDomainService.removeMember` / `changeRole`                |
| Removing a non-member fails.                                                                | `MemberNotFoundError`                                                |
| Removing a member from an archived organization fails.                                      | `OrganizationArchivedError`                                          |
| Role changes emit no domain event in v1 (catalog has only `member_added`/`member_removed`). | `OrganizationMembership.changeRole` (documented gap)                 |

## Settings

| Rule                                                                                            | Enforcement                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Settings are versioned and carry validated values (locale, timezone, residency, retention, AI). | `OrganizationSettings.update`                     |
| Retention is bounded to 30–3650 days.                                                           | `OrganizationSettings` (`MIN/MAX_RETENTION_DAYS`) |
| Data residency is `auto` or a two-letter region code (PSD CO-B3).                               | `OrganizationSettings`                            |
| Every settings change emits `organization.settings_updated` with the changed keys.              | `Organization.updateSettings`                     |

## Privacy & security

| Rule                                                                                    | Enforcement                   |
| --------------------------------------------------------------------------------------- | ----------------------------- |
| Passive/system activity is attributed to a `system` actor, never a user or agent.       | event envelope (`EventActor`) |
| Organization events ride the shared envelope with category `platform` (DOM-01 Generic). | `events/index.ts`             |

## Domain constraints (PERSISTENCE-relevant)

- Slug uniqueness is enforced in the domain (via the repository port) **and**
  in the infrastructure layer (unique index) — defense in depth.
- Aggregate mutations bump `version` for optimistic concurrency (EntityMeta).
- `organizationId + userId` is unique per membership (unique index in infra).
