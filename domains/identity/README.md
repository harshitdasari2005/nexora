# @nexora/domain-identity

The **Identity & Access** bounded context (DOMAIN_MODEL.md §2.2). Pure business
domain — no persistence, no APIs, no authentication implementation.

## Scope

| Layer         | Contents                                                                          |
| ------------- | --------------------------------------------------------------------------------- |
| Aggregates    | `User` (+ `UserProfile`), `Session`, `Role` (+ `Permission`)                      |
| Value objects | `Email`, `Username`, `PasswordHash`, `DisplayName`, `UserStatus`, `SessionStatus` |
| Events        | `identity.user.*`, `identity.session.*` on the shared envelope                    |
| Repositories  | `UserRepository`, `SessionRepository`, `RoleRepository` (interfaces)              |
| Services      | `UserDomainService`, `SessionDomainService`, `PermissionDomainService`            |
| Policies      | `UserLifecyclePolicy`, `SessionPolicy`, `PermissionInvariants`, `RoleInvariants`  |

## Non-goals

- ❌ No database / ORM / persistence implementations.
- ❌ No REST/gRPC APIs, controllers, or HTTP.
- ❌ No JWT/OAuth/SSO or middleware.
- ❌ No application services or dependency-injection containers.

The infrastructure layer (in `infrastructure/`) will implement the repository
interfaces and the `PasswordHasher` port per ROADMAP.md Phase 1.

## Quick usage

```ts
import { UserDomainService, SessionDomainService } from '@nexora/domain-identity';
import { InMemoryUserRepository } from './infra/in-memory-user-repository';

const users = new InMemoryUserRepository();
const service = new UserDomainService({
  users,
  roles: roleRepository,
  sessions: sessionRepository,
  hasher: argonHasher, // infrastructure implementation of the port
});

const result = await service.register(
  {
    tenantId: 'tenant_1',
    email: 'alice@example.com',
    username: 'alice',
    password: 'CorrectHorse1',
    displayName: 'Alice',
  },
  { actor: { kind: 'user', id: 'usr_admin' }, correlationId: 'corr_1', tenantId: 'tenant_1' },
);
```

Domain services return `Result<T, IdentityDomainError>`; emitted domain events
are returned alongside the aggregate so the application layer can publish them
via the event bus (SAD.md §11).

## Documentation

- [`docs/DOMAIN_MODEL.md`](./docs/DOMAIN_MODEL.md) — domain explanation
- [`docs/BUSINESS_RULES.md`](./docs/BUSINESS_RULES.md) — business rules
- [`docs/AGGREGATES.md`](./docs/AGGREGATES.md) — aggregate boundaries
