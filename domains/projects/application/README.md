# @nexora/application-projects — Projects Application Layer

The use cases of the Projects bounded context (BACKEND.md §4): commands,
command handlers, queries, query handlers, DTOs, validators, and the
application service. Composes `@nexora/domain-projects` with the platform
event publisher. **No persistence, no HTTP, no infrastructure.**

## Surface

| Export                                      | Kind      | Purpose                                                      |
| ------------------------------------------- | --------- | ------------------------------------------------------------ |
| `CreateProjectCommand`                      | command   | Organization, name, optional description, actor, correlation |
| `CreateProjectHandler`                      | handler   | Application entry point for project creation                 |
| `ListProjectsQuery` / `ListProjectsHandler` | query     | Tenant-scoped project listing                                |
| `ProjectDto` / `toProjectDto`               | DTO       | Public project representation                                |
| `validateCreateProject`                     | validator | Structural command validation                                |
| `ProjectApplicationService`                 | service   | Orchestrates domain + event publishing                       |

## One business execution path

Both the HTTP API (`POST/GET /api/projects`) and the AI `CreateProjectTool`
delegate to `CreateProjectHandler` / `ListProjectsHandler` — never to the
domain or repositories directly. The AI may propose the _name_, but the
tenant, identity, permissions, and approval state come exclusively from the
trusted execution context.

## Development

```bash
pnpm --filter @nexora/application-projects build
pnpm --filter @nexora/application-projects test
```
