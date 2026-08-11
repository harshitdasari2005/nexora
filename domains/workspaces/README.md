# @nexora/domain-workspaces

The **Workspaces** bounded context (DOMAIN_MODEL.md §1 Tenancy; PSD.md §4).
Pure business domain — no persistence, no APIs, no infrastructure.

## Scope

| Layer         | Contents                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aggregates    | `Workspace` (+ 10 child entities), `WorkspaceMembership`, `WorkspaceInstallation`                                                                                                                       |
| Value objects | `WorkspaceId`, `WorkspaceName`, `WorkspaceSlug`, `WorkspaceStatus`, `WorkspaceVisibility`, `WorkspaceType`, `WorkspaceColor`, `WorkspaceIcon`, `WorkspaceTimeZone`, `WorkspaceLocale`, `MembershipRole` |
| Events        | 18 `workspace.*` events on the shared envelope (category `platform`)                                                                                                                                    |
| Repositories  | `WorkspaceRepository`, `WorkspaceMembershipRepository`, `WorkspaceInstallationRepository` (interfaces)                                                                                                  |
| Services      | `WorkspaceDomainService`, `WorkspaceMembershipService`, `WorkspaceInstallationService`, `WorkspacePolicyService`                                                                                        |
| Policies      | `WorkspaceLifecyclePolicy`, `WorkspaceArchivalPolicy`, `WorkspaceMembershipPolicy`, `WorkspaceInstallationPolicy`, `WorkspaceBindingPolicy`, `SlugUniquenessPolicy`                                     |

## Workspace model

A **Workspace** is the operational boundary of Nexora (PSD.md §4 "Workspace
model"). It owns collaboration and execution: every application, plugin, AI
agent, workflow, document, and knowledge source is attached to exactly one
Workspace. A Workspace belongs to exactly one Organization (the tenant).

Lifecycle (PSD.md WS-R5): `provisioning → active → suspended/archived`;
`archived` is terminal in v1 — immutable, data and audit retained.
A suspended Workspace cannot execute workflows; an archived Workspace rejects
every mutation.

Tenancy is a **Generic/platform** domain (DOMAIN_MODEL.md DOM-01), so workspace
events use category `platform`.

## Core invariants

- A Workspace belongs to exactly one Organization.
- Every installed plugin belongs to one Workspace.
- Every Agent executes inside one Workspace.
- Knowledge cannot exist without a Workspace.
- A suspended Workspace cannot execute workflows.
- An archived Workspace is immutable.
- A Workspace must always retain at least one `owner` member.
- Workspace slugs are unique **within an organization**.

## Aggregate design

| Aggregate               | Why a root                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| `Workspace`             | Owns settings, branding, preferences, features, and the five bindings |
| `WorkspaceMembership`   | Own identity/role/lifecycle; last-owner rule spans memberships        |
| `WorkspaceInstallation` | Own identity per installed plugin (App)                               |

See [docs/AGGREGATES.md](docs/AGGREGATES.md) for the full design and
transaction boundaries.

## Non-goals

- ❌ No database / ORM / persistence implementations.
- ❌ No REST/gRPC APIs, controllers, or HTTP.
- ❌ No application services or dependency-injection containers.
- ❌ No HR/Projects/CRM etc. domains (separate bounded contexts).

The infrastructure layer will implement the repository interfaces per
ROADMAP.md Phase 1.

## Quick usage

```ts
import { WorkspaceDomainService } from '@nexora/domain-workspaces';

const service = new WorkspaceDomainService({ workspaces: repo });

const result = await service.create(
  { organizationId: tenantId, slug: 'engineering', name: 'Engineering', type: 'engineering' },
  context,
);
// result: Result<{ workspace, events }, InvalidWorkspaceValueError | SlugAlreadyExistsError>
```

## Documentation

- [docs/AGGREGATES.md](docs/AGGREGATES.md) — aggregate boundaries & transaction rules
- [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) — every business rule with spec traceability
- [docs/LIFECYCLE.md](docs/LIFECYCLE.md) — lifecycle state diagrams
- [CHANGELOG.md](CHANGELOG.md) — version history
