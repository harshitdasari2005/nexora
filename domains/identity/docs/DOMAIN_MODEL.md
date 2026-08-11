# Identity Domain Model

Bounded context: **Identity & Access** (DOMAIN_MODEL.md §2.2). This document
explains the domain for engineers implementing against
`@nexora/domain-identity`.

## Responsibility

The Identity & Access context owns: users, their profiles and credentials,
sessions, roles, and the permission vocabulary that authorization consumes
(PSD.md §10, SAD.md §13.1–13.2). It produces identity events; the Policy
Engine consumes resolved principals for authorization decisions
(API_CONTRACTS.md §8).

## Building blocks

### Aggregates (roots)

| Aggregate | Owns                                                                           | Identity               | Invariants live in                                       |
| --------- | ------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------- |
| `User`    | `UserProfile` (child), email, username, password hash, status, role references | `UserId` (`usr_...`)   | `User` methods + `UserLifecyclePolicy`                   |
| `Session` | status, token, timing                                                          | session id (`ses_...`) | `Session` methods + `SessionPolicy`                      |
| `Role`    | `Permission` (child)                                                           | role id (`rol_...`)    | `Role` methods + `PermissionInvariants`/`RoleInvariants` |

### Value objects

- `Email` — normalized lowercase, validated.
- `Username` — lowercase, 3–32 chars, `[a-z0-9._-]`.
- `PasswordHash` — algorithm + encoded hash; never plaintext.
- `DisplayName` — 1–120 chars.
- `UserStatus` — `pending | active | suspended | deactivated`.
- `SessionStatus` — `active | expired | ended | revoked`.

### Domain services

- `UserDomainService` — register, activate, suspend, deactivate,
  assign/remove role, update profile, change password.
- `SessionDomainService` — start (authentication), validate, end, revoke,
  end-all-for-user.
- `PermissionDomainService` — permission evaluation (deny-wins), effective
  permission union.

### Events (category `identity`)

`identity.user.created`, `identity.user.activated`,
`identity.user.suspended`, `identity.user.deactivated`,
`identity.user.role_assigned`, `identity.user.role_removed`,
`identity.session.started`, `identity.session.ended`.

## Ports & repositories

The domain defines contracts only:

- `UserRepository`, `SessionRepository`, `RoleRepository` — persistence
  ports (implemented in the infrastructure layer).
- `PasswordHasher` — hashing port (never implement in the domain).

## Layering rule

The domain depends only on `@nexora/contracts` and `@nexora/shared`. It never
depends on the platform modules, the AI runtime, or infrastructure.
