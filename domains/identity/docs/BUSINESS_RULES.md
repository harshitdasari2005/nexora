# Identity Business Rules

Authoritative list of the business rules implemented by
`@nexora/domain-identity`, mapped to the specs (PSD.md §10, DOMAIN_MODEL.md
§9, §13). Each rule lists where it is enforced.

## User lifecycle

| Rule                                                                                                                                     | Enforcement                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A user is created with status `pending` unless an explicit status is supplied.                                                           | `User.create`                                                  |
| A user may transition `pending → active`, `active → suspended/deactivated`, `suspended → active/deactivated`. `deactivated` is terminal. | `USER_TRANSITIONS` / `UserLifecyclePolicy.assertCanTransition` |
| Only `active` users may start sessions.                                                                                                  | `UserLifecyclePolicy.assertCanStartSession`                    |
| A user cannot be activated when already active or deactivated.                                                                           | `User.activate` → throws `UserStateTransitionError`            |
| A user cannot be deactivated when pending or already deactivated.                                                                        | `User.deactivate`                                              |
| A user cannot be suspended when pending or deactivated.                                                                                  | `User.suspend`                                                 |
| Suspending a user ends all of their active sessions (they keep no access).                                                               | `UserDomainService.suspend`                                    |
| Deactivating a user ends all of their active sessions.                                                                                   | `UserDomainService.deactivate`                                 |

## Credentials

| Rule                                                                                                  | Enforcement                            |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Passwords must be at least 8 characters and contain a letter and a digit.                             | `UserLifecyclePolicy.validatePassword` |
| Only the hash is ever stored; plaintext never lives on the aggregate.                                 | `PasswordHash` + `PasswordHasher` port |
| Changing a password requires the current password to verify.                                          | `UserDomainService.changePassword`     |
| An incorrect current password is an auth failure (`InvalidCredentialsError`), not a validation error. | `UserDomainService.changePassword`     |

## Roles & permissions

| Rule                                                               | Enforcement                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Role names are lowercase dotted segments (e.g. `workspace.admin`). | `RoleInvariants.assertValidRole`                      |
| Role levels are `global`, `workspace`, or `application`.           | `RoleInvariants.assertValidRole`                      |
| A role may be granted to a user at most once.                      | `User.assignRole` → throws `RoleAlreadyAssignedError` |
| Removing a role that is not assigned fails.                        | `User.removeRole` → throws `RoleNotAssignedError`     |
| Roles must exist before assignment.                                | `UserDomainService.assignRole` → `RoleNotFoundError`  |
| Permission names are lowercase dotted segments.                    | `PermissionInvariants`                                |
| A permission must carry at least one `resource:action` scope.      | `PermissionInvariants`                                |
| A role cannot hold two permissions with the same name.             | `Role.grantPermission` → `DuplicatePermissionError`   |
| Revoking an unknown permission fails.                              | `Role.revokePermission` → `PermissionNotFoundError`   |

## Sessions

| Rule                                                                       | Enforcement                          |
| -------------------------------------------------------------------------- | ------------------------------------ |
| A session is active until its expiry; expired sessions cannot be used.     | `Session.touch` / `Session.validate` |
| An ended/revoked session can never be used again.                          | `Session` status machine             |
| Ending a session is idempotent (double logout is safe).                    | `Session.end`                        |
| A user may hold at most `maxConcurrentSessions` active sessions.           | `SessionPolicy.assertCanOpenSession` |
| Passive expiry is attributed to a `system` actor, never the session owner. | `Session` (event actor)              |

## Privacy & security

| Rule                                                                                  | Enforcement                  |
| ------------------------------------------------------------------------------------- | ---------------------------- |
| Authentication failures use a single `InvalidCredentialsError` (no user enumeration). | `SessionDomainService.start` |
| Session tokens are opaque and unique per session.                                     | `Session.start` (`uuid()`)   |

## Domain constraints (PERSISTENCE-relevant)

- Email and username are unique **per tenant** (checked in `UserDomainService`,
  enforced by unique indexes in the infrastructure layer).
- Aggregate mutations bump `version` for optimistic concurrency
  (`EntityMeta`).
