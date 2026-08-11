# @nexora/application-organizations

The **application layer** of the Organizations bounded context
(BACKEND.md §4). It turns domain services into executable use cases for the
onboarding slice: organization provisioning and reads.

## Responsibilities

- **CreateOrganization** — provisions a new organization for the creator:
  `create (provisioning)` → `activate` → add the creator as the first
  `owner` (the documented first-owner provisioning flow in
  `@nexora/domain-organizations` docs/AGGREGATES.md). Emitted events
  (`organization.created`, `organization.activated`,
  `organization.member_added`) are published once the whole sequence
  succeeds.
- **ListOrganizations** — the organizations a user belongs to (via their
  memberships), as DTOs.

## Layering

```
apps/api (HTTP adapters)
   ↓ depends on
@nexora/application-organizations (this package)
   ↓ depends on
@nexora/domain-organizations (aggregates, services, policies)
   ↓ ports implemented by
@nexora/persistence (Drizzle/PostgreSQL)
```

No business rules live here — every invariant is enforced by the domain.
Domain events are collected from the domain service results and published
through the `EventPublisher` port.

## Use

```ts
const service = new OrganizationApplicationService({
  organizationsService: organizationDomainService,
  membershipsService: membershipDomainService,
  membershipsRepository: membershipRepository,
  publisher: loggingEventPublisher,
});
const result = await service.createOrganization({
  name: 'Acme',
  slug: 'acme',
  type: 'startup',
  actorId: user.id,
  correlationId: '…',
});
```

## Testing

`pnpm --filter @nexora/application-organizations test` — unit tests over the
application service and handlers with in-memory repository fakes.
