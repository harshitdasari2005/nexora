# Projects Domain — Business Rules

Authoritative business rules of the Projects bounded context
(DOMAIN_MODEL.md §14.2). Every rule is enforced inside the `Project`
aggregate or its policies — never by the application layer, API, or AI.

## Rule catalog

| Id     | Rule                                                                                                                                                                                   | Enforced by                                 | Error                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------- |
| PRJ-1  | A project belongs to exactly one organization; `organizationId` is immutable.                                                                                                          | `Project` (readonly)                        | —                             |
| PRJ-2  | A project name is required, trimmed, and ≤ 120 characters.                                                                                                                             | `ProjectName` / `ProjectValuePolicy`        | `InvalidProjectValueError`    |
| PRJ-3  | A project description, when present, is ≤ 2000 characters.                                                                                                                             | `ProjectDescription` / `ProjectValuePolicy` | `InvalidProjectValueError`    |
| PRJ-4  | New projects start in `proposed` (charter drafted, awaiting approval per WRK-4).                                                                                                       | `Project.create`                            | —                             |
| PRJ-5  | `proposed → active` requires charter approval (WRK-4). In v1 the creating owner approves the charter at creation, so the **CreateProject** use case creates and activates in one step. | `Project.activate` + application service    | `ProjectStateTransitionError` |
| PRJ-6  | `active → on_hold` requires an authorized pause; `on_hold → active` requires a resume.                                                                                                 | `Project.hold` / `Project.resume`           | `ProjectStateTransitionError` |
| PRJ-7  | `active → completed` is the owner close (EVT-9); only a `completed` project may be archived (retention policy).                                                                        | `Project.complete` / `Project.archive`      | `ProjectStateTransitionError` |
| PRJ-8  | `proposed` and `active` projects may be cancelled (owner + approval); `archived` and `cancelled` are terminal — every further transition is rejected.                                  | `Project.cancel` + transition table         | `ProjectStateTransitionError` |
| PRJ-9  | Transitions are **validate → mutate → event**: an illegal transition leaves status, version, and events untouched.                                                                     | `Project.#transitionTo`                     | —                             |
| PRJ-10 | Project reads are tenant-scoped: listing returns only the requesting organization's projects (isolation at the repository + application layer).                                        | `ProjectRepository.listByOrganization`      | —                             |

## Lifecycle state machine

See [LIFECYCLE.md](LIFECYCLE.md) for the transition table and diagram.

## Application-layer contract (CreateProject)

The `CreateProject` use case (`@nexora/application-projects`):

1. **Validates** the command (name non-empty ≤ 80, description ≤ 2000) —
   early rejection with `ValidationError`.
2. **Creates** the aggregate via `ProjectDomainService.create` (`proposed`).
3. **Activates** it via `ProjectDomainService.activate` (`active` — v1 charter
   approval by the creating owner).
4. **Publishes** `project.created` + `project.activated` once, atomically after
   success.
5. Returns the authoritative aggregate + events.

Neither the API nor the AI tool adds business rules — both delegate to this
single path.
