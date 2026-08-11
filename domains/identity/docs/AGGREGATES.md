# Identity Aggregate Boundaries

How the Identity aggregates are carved (DDD.md §6, PERSISTENCE.md §4) and why.

## `User`

- **Root:** `User`
- **Children:** `UserProfile` (1:1, no separate lifecycle)
- **Owns:** email, username, password hash, status, role _references_
  (role names, not the Role aggregates).
- **Boundary rule:** every mutation flows through `User` methods — there is no
  public setter. `activate`, `deactivate`, `assignRole`, `removeRole`,
  `updateProfile`, `changePassword` all enforce invariants and record events.
- **Transaction boundary:** `UserRepository.save` persists user + profile +
  role references atomically.

### Why role names, not Role objects?

`Role` is its own aggregate (its permission set mutates independently). The
`User` aggregate holds only role _names_ as references, so a permission change
inside a Role never touches the User aggregate. Cross-aggregate reference
integrity ("role must exist") is enforced by `UserDomainService.assignRole`,
which resolves the role before mutating the user.

## `Role`

- **Root:** `Role`
- **Children:** `Permission` (owned collection)
- **Owns:** name, level, approver flag, description, permission set.
- **Boundary rule:** permission mutations go through `grantPermission` /
  `revokePermission`, which enforce uniqueness and validity.
- **Transaction boundary:** `RoleRepository.save` persists the role and its
  permissions atomically.

## `Session`

- **Root:** `Session` (no children)
- **Owns:** token, status, timing.
- **Boundary rule:** status transitions are exclusive to `Session` methods
  (`touch`, `end`, `revoke`, `expire`). A session never becomes active again
  after ending.
- **Transaction boundary:** `SessionRepository.save`.

## Cross-aggregate references (never object references)

| From      | To     | Via              |
| --------- | ------ | ---------------- |
| `User`    | `Role` | role name string |
| `Session` | `User` | `userId`         |

Cross-aggregate rules (role exists, user active, session limit) are enforced
by the domain services, not by direct object navigation.

## Why these boundaries?

1. **Change locality** — a permission edit touches only `Role`; a profile edit
   only `User`. No aggregate is invalidated by another's internal change.
2. **Consistency scope** — each aggregate's invariants are checkable inside
   one transaction; rules spanning aggregates are deliberate service-level
   workflows (and produce events for the platform).
3. **Event sourcing readiness** — aggregates emit domain events on every
   mutation (`pullDomainEvents()`), so the persistence layer can later source
   projections without changing the domain (PSD.md §8).
