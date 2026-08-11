# @nexora/domain-organizations

The **Organizations** bounded context (DOMAIN_MODEL.md §1 Tenancy). Pure business
domain — no persistence, no APIs, no infrastructure.

## Scope

| Layer         | Contents                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Aggregates    | `Organization` (+ `OrganizationProfile`, `OrganizationSettings`), `OrganizationMembership`              |
| Value objects | `OrganizationId`, `OrganizationName`, `OrganizationSlug`, `OrganizationStatus`, `OrganizationType`      |
| Events        | `organization.*`, `organization.member_*` on the shared envelope (category `platform`)                  |
| Repositories  | `OrganizationRepository`, `MembershipRepository` (interfaces)                                           |
| Services      | `OrganizationDomainService`, `MembershipDomainService`                                                  |
| Policies      | `OrganizationLifecyclePolicy`, `OrganizationArchivalPolicy`, `MembershipPolicy`, `SlugUniquenessPolicy` |

## Tenancy model

This bounded context owns the lifecycle of organizations (companies) within
Nexora (PRD tenant ⇔ PSD Company ⇔ this domain's Organization). Tenancy is a
**Generic/platform** domain (DOMAIN_MODEL.md DOM-01), so organization events use
category `platform`. The `Organization` aggregate id _is_ the tenant id
(`OrganizationId` maps 1:1 to the contracts `TenantId` at the infrastructure
boundary).

Lifecycle (PSD.md CO-3): `provisioning → active → suspended → archived`.
`archived` is terminal in v1 — data and audit are retained, mutations are
rejected.

## Non-goals

- ❌ No database / ORM / persistence implementations.
- ❌ No REST/gRPC APIs, controllers, or HTTP.
- ❌ No application services or dependency-injection containers.
- ❌ No Workspace domain (separate bounded context, `domains/workspaces`).

The infrastructure layer (in `infrastructure/`) will implement the repository
interfaces per ROADMAP.md Phase 1.

## Quick usage

```ts
import { OrganizationDomainService, MembershipDomainService } from '@nexora/domain-organizations';
import { InMemoryOrganizationRepository } from './infra/in-memory-organization-repository';

const organizations = new InMemoryOrganizationRepository();
const orgService = new OrganizationDomainService({ organizations });

const result = await orgService.create(
  { slug: 'acme', name: 'Acme Corp', type: 'enterprise' },
  { actor: { kind: 'user', id: 'usr_admin' }, correlationId: 'corr_1' },
);
```

Domain services return `Result<T, OrganizationDomainError>`; emitted domain
events are returned alongside the aggregate so the application layer can publish
them via the event bus (SAD.md §11).

## Documentation

- [`docs/AGGREGATES.md`](./docs/AGGREGATES.md) — aggregate design & boundaries
- [`docs/BUSINESS_RULES.md`](./docs/BUSINESS_RULES.md) — business rules
- [`docs/LIFECYCLE.md`](./docs/LIFECYCLE.md) — lifecycle diagrams (Mermaid)
