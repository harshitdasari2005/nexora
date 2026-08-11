# @nexora/application-identity

The **application layer** of the Identity & Access bounded context
(BACKEND.md §4). It turns domain services into executable use cases for the
onboarding slice: OIDC authentication, session lifecycle, and current-user
reads.

## Responsibilities

- **AuthenticateWithOidc** — provisions a local user from verified OIDC
  claims (idempotent by email) and issues a session for the verified
  principal. Passwords are never handled: Keycloak owns authentication for
  external identities (the provisioned account carries a generated, unusable
  password and a `tnt_platform` bootstrap tenant until the user joins an
  organization).
- **EndSession** — logout.
- **GetCurrentUser** — the public `UserDto` for the authenticated user.

## Layering

```
apps/api (HTTP adapters)
   ↓ depends on
@nexora/application-identity (this package — commands/handlers/queries)
   ↓ depends on
@nexora/domain-identity (aggregates, services, policies — pure business rules)
   ↓ ports (repository interfaces) implemented by
@nexora/persistence (Drizzle/PostgreSQL)
```

The package contains **no business rules of its own** — every invariant is
enforced by the domain. It collects domain events emitted by the domain
services and publishes them through the `EventPublisher` port.

## Use

```ts
const service = new IdentityApplicationService({
  users: userRepository, // UserRepository port
  usersService: userDomainService,
  sessionsService: sessionDomainService,
  publisher: loggingEventPublisher,
});
const result = await service.authenticateWithOidc({
  oidcSubject: '…',
  email: 'alex@example.com',
  emailVerified: true,
  issuer: '…',
  correlationId: '…',
});
```

## Testing

`pnpm --filter @nexora/application-identity test` — unit tests over the
application service and handlers with in-memory repository fakes.
