# Changelog

## 0.1.0 — 2026-08-09

- Initial Projects bounded context (DOMAIN_MODEL.md §14.2).
- `Project` aggregate with full lifecycle: proposed → active → on_hold ⇄
  active → completed → archived; cancelled from proposed/active.
- Value objects: `ProjectId`, `ProjectName`, `ProjectDescription`,
  `ProjectStatus`.
- Domain events: `project.created`, `project.activated`, `project.on_hold`,
  `project.resumed`, `project.completed`, `project.archived`,
  `project.cancelled`.
- `ProjectDomainService` (create / activate / hold / resume / complete /
  archive / cancel / find / list) — all `Result`-returning.
- `ProjectRepository` port; `PROJECT_TRANSITIONS` table;
  `ProjectLifecyclePolicy`; `ProjectValuePolicy`.
- Error vocabulary extending `NexoraError` (VALIDATION_ERROR / NOT_FOUND /
  BUSINESS_RULE_VIOLATION).
- 81 domain unit tests.
