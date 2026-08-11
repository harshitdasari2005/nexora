# Changelog

All notable changes to `@nexora/domain-identity` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`0.1.0` foundation** — the Identity & Access bounded context domain core (DOMAIN_MODEL.md §2.2):
  - Aggregates: `User` (+ `UserProfile` child entity), `Session`, `Role` (+ `Permission` child entity), each with behavior-driven invariants and domain-event emission.
  - Value objects: `Email`, `Username`, `PasswordHash`, `DisplayName`, `UserStatus`, `SessionStatus`.
  - Domain events on the shared envelope (category `identity`): `UserCreated`, `UserActivated`, `UserDeactivated`, `RoleAssigned`, `RoleRemoved`, `SessionStarted`, `SessionEnded`.
  - Repository interfaces: `UserRepository`, `SessionRepository`, `RoleRepository`; the `PasswordHasher` port.
  - Domain services: `UserDomainService`, `SessionDomainService`, `PermissionDomainService`.
  - Policies: `UserLifecyclePolicy`, `SessionPolicy`, `PermissionInvariants`, `RoleInvariants`.
  - Error hierarchy extending `@nexora/shared` with canonical codes.
  - 172 unit tests; strict TypeScript; zero `any`; zero `TODO`; every public export documented.

### Added (code review hardening)

- **`User.suspend` / `UserDomainService.suspend`** — the transition table already
  allowed `active → suspended` but no operation could reach it; suspension is now
  a first-class use case that also ends the user's active sessions (no retained
  access). Emits the new `identity.user.suspended` event.
- **`UserSuspended` domain event** (`identity.user.suspended`) with reason.
- **`system` actor kind** — extended `EventActor` in `@nexora/shared` and
  `@nexora/contracts` (kept in sync) so unattended platform activity can be
  attributed correctly.

### Changed

- **No user enumeration at the login boundary** — an inactive user now surfaces
  as `InvalidCredentialsError` instead of `UserNotActiveError`; admin flows use
  the new throwing `UserLifecyclePolicy.assertUserCanStartSession` when the
  status must leak.
- **Passive session expiry is attributed to a `system` actor** — the `Session`
  aggregate no longer fabricates the session owner as the actor of an `expired`
  event (audit-trail integrity, PERSISTENCE.md §13).
- **`UserDomainService.changePassword`** — an incorrect current password is now
  an `InvalidCredentialsError` (auth failure), consistent with the login
  boundary, instead of a validation error.
- **`SessionDomainService`** — removed dead imports; the login boundary and
  idle-timeout handling are now covered by tests.
