# @nexora/application-workspaces

The **application layer** of the Workspaces bounded context (BACKEND.md §4).
It turns domain services into executable use cases for the onboarding slice:
workspace provisioning and reads.

## Responsibilities

- **CreateWorkspace** — provisions a new workspace inside an organization for
  the creator: `create (provisioning)` → `activate` → add the creator as the
  first `owner`. Emitted events (`workspace.created`,
  `workspace.activated`, `workspace.member_added`) are published once the
  whole sequence succeeds.
- **ListWorkspaces** — the workspaces of an organization, as DTOs.

## Layering

```
apps/api (HTTP adapters)
   ↓ depends on
@nexora/application-workspaces (this package)
   ↓ depends on
@nexora/domain-workspaces (aggregates, services, policies)
   ↓ ports implemented by
@nexora/persistence (Drizzle/PostgreSQL)
```

No business rules live here — every invariant is enforced by the domain.
Domain events are collected from the domain service results and published
through the `EventPublisher` port.

## Use

```ts
const service = new WorkspaceApplicationService({
  workspacesService: workspaceDomainService,
  membershipsService: workspaceMembershipService,
  publisher: loggingEventPublisher,
});
const result = await service.createWorkspace({
  organizationId: org.id,
  slug: 'engineering',
  name: 'Engineering',
  type: 'engineering',
  actorId: user.id,
  correlationId: '…',
});
```

## Testing

`pnpm --filter @nexora/application-workspaces test` — unit tests over the
application service and handlers with in-memory repository fakes.
