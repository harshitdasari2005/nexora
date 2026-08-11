# @nexora/domain-projects — Projects Domain Core

The **Projects** bounded context (DOMAIN_MODEL.md §14.2, DOM-05). A project is a
unit of work owned by exactly one organization with a name, an optional
description, and a governed lifecycle. This package is the **pure business
domain**: entities, value objects, domain events, repository interfaces,
domain services, and policies. No persistence, no APIs, no infrastructure.

> The Projects domain is a **Supporting** domain (DOMAIN_MODEL.md §14 — it is
> valuable but pluggable; the orchestration layer is the core differentiator).
> Its events ride the canonical envelope with category `projects`.

## Layout

```
src/
  entities/project.ts          Project aggregate root (lifecycle behavior)
  value-objects/               ProjectId, ProjectName, ProjectDescription, ProjectStatus
  events/                      project.created / activated / on_hold / resumed / completed / archived / cancelled
  policies/                    PROJECT_TRANSITIONS table + lifecycle policy + value policy
  repositories/                ProjectRepository port
  services/                    ProjectDomainService (use-case orchestration)
```

## The Project aggregate

- Belongs to **exactly one organization** (`organizationId`, immutable).
- Lifecycle (DOMAIN_MODEL.md §14.2):

```
proposed → active (charter approved, WRK-4)
active   → on_hold (authorized pause) ⇄ active (resume)
active   → completed (owner closes, EVT-9)
completed → archived (retention policy)
proposed → cancelled ; active → cancelled (owner + approval)
```

- Every transition **validates → mutates → emits**: an illegal transition
  throws `ProjectStateTransitionError` with no state change and no event.
- `archived` and `cancelled` are terminal in v1 (immutable).
- Optimistic-concurrency `version` bumps on every mutation; `snapshot()` /
  `hydrate()` provide persistence round-trips (PERSISTENCE.md §4).

## Business rules

See [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) and
[docs/LIFECYCLE.md](docs/LIFECYCLE.md).

## Integration

- **Persistence:** `@nexora/persistence` implements `ProjectRepository`
  (Drizzle `projects` table, migration 0004).
- **Application layer:** `@nexora/application-projects` composes this domain
  with the event publisher and exposes `CreateProjectHandler` /
  `ListProjectsHandler`.
- **API + AI:** `apps/api` routes (`POST/GET /api/projects`) and the
  `CreateProjectTool` both delegate to the same application layer — ONE
  business execution path for humans and agents.

## Development

```bash
pnpm --filter @nexora/domain-projects build     # tsc
pnpm --filter @nexora/domain-projects typecheck # tsc --noEmit
pnpm --filter @nexora/domain-projects lint      # eslint
pnpm --filter @nexora/domain-projects test      # vitest
```
