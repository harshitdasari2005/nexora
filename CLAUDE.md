# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Nexora is

An **AI-native enterprise operating system** (not an ERP): users speak in natural language, an
Enterprise AI Orchestrator plans the work, coordinates per-app AI agents, executes, and reports —
with human approval always required for money, people, contracts, and deletions, and every action
auditable.

Twelve specification documents at the repo root are the source of truth (`PRD.md`,
`PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `AI_RUNTIME.md`, `BACKEND.md`,
`API_CONTRACTS.md`, `PERSISTENCE.md`, `FRONTEND.md`, `DESIGN_SYSTEM.md`, `ENGINEERING_PLAYBOOK.md`,
`ROADMAP.md`). Code references them by section (e.g. `BACKEND.md §4`).

## What's actually built (vs. spec)

The specs describe the full vision; the code is well past MVP but far from all of it. Quick map:

| Area | State |
| --- | --- |
| `apps/api` (Fastify modular monolith), `apps/web` (Vite/React SPA) | Real, primary |
| Auth (Keycloak OIDC + cookie session), RBAC (S34 authoritative — `business-context/permissions.ts`) | Real |
| Persistence: Postgres via Drizzle, migrations `0000`–`0018` | Real |
| AI runtime: orchestrator, discovery, planner, durable approval engine, workflow engine | Real |
| Registered agents: Workspaces, Projects, HR, Knowledge, Notifications, Calendar, Finance, Workflow | Real |
| MCP server (stdio + authenticated HTTP), external connectors (GitHub, Slack) | Real |
| Verticals: HR, Projects, Documents, Knowledge, Calendar, Finance, Command Center, detection/problems, remediation, marketplace, integrations, audit views | Real |
| `domains/`: crm, sales, inventory, procurement, analytics, administration, marketplace | **Stub** (one-line `index.ts`) — later `ROADMAP.md` sprints |
| `apps/admin`, `apps/docs` | Scaffold only |

`git log` HEAD is `feat(s34)`; the working tree typically carries later uncommitted sprint work.
`pnpm typecheck` / `pnpm lint` / `pnpm test` (~1,300 tests) are the gates — keep them green.

## Commands

Requires Node ≥ 20 (see `.nvmrc` — currently 22), pnpm `10.33.0` (via `packageManager`), Docker.

**Do not run this repo from an iCloud-synced folder** (`~/Desktop`, `~/Documents`): iCloud stalls
`node_modules` reads and the dev server hangs silently on boot. Keep it under e.g. `~/dev/`.

```bash
pnpm install

# One-command local dev: starts Docker infra, waits for health, then API + Web with logs.
# API :3001, Web :5173. Ctrl+C stops API/Web; infra keeps running.
pnpm dev:local
pnpm dev:local:down          # stop the infra containers

pnpm dev:infra               # just the Docker infra (Postgres, Redis, MinIO, Keycloak)
pnpm dev                     # turbo dev across the whole workspace
pnpm dev:api                 # only @nexora/app-api   (tsx watch)
pnpm dev:web                 # only @nexora/app-web   (vite)

pnpm build                   # turbo run build   (tsc / vite build per package)
pnpm lint                    # turbo run lint    (eslint)
pnpm typecheck               # turbo run typecheck (tsc --noEmit)
pnpm test                    # turbo run test    (vitest run)
pnpm format                  # prettier --write
pnpm format:check

pnpm demo:reset              # seed demo data (apps/api/scripts/seed-demo.ts)
pnpm scan:secrets            # scripts/scan-secrets.mjs
```

Ports can be overridden: `NEXORA_API_PORT=3100 NEXORA_WEB_PORT=5174 pnpm dev:local`. The
`.claude/launch.json` config (`nexora-dev`) runs `pnpm dev:local` with Web :5180 / API :3010.
Copy `.env.example` to `.env` first — Postgres is mapped to host port **5433** (not 5432).

### Scoped / single-package / single-test

```bash
pnpm --filter @nexora/domain-hr test                       # one package's tests
pnpm --filter @nexora/domain-hr exec vitest run test/employee-entity.test.ts   # one file
pnpm --filter @nexora/domain-hr exec vitest run -t "rejects invalid status"    # one test by name
pnpm --filter @nexora/app-api exec vitest run --watch      # watch mode for a package
pnpm --filter @nexora/app-api mcp                          # run the API's MCP server
```

### Database (Drizzle, in `@nexora/persistence`)

```bash
pnpm --filter @nexora/persistence db:generate   # generate SQL from schema changes
pnpm --filter @nexora/persistence db:migrate    # apply migrations (packages/persistence/drizzle/*.sql)
pnpm --filter @nexora/persistence db:studio
```

The API auto-runs migrations on boot when `DATABASE_AUTO_MIGRATE=true` (default in `.env.example`).

## Architecture

**pnpm + Turborepo monorepo, ESM everywhere, TypeScript strict.** Workspace globs
(`pnpm-workspace.yaml`): `apps/*`, `packages/*`, `domains/*`, `domains/*/application`, `platform/*`.
The design is DDD + hexagonal + CQRS + event-driven, deployed as a **modular monolith** (one
Fastify process wiring all modules).

### Layer / package layout

| Tree | Package name pattern | Role & allowed dependencies |
| --- | --- | --- |
| `domains/<ctx>/src` | `@nexora/domain-<ctx>` | Pure bounded-context core: entities, aggregates, value objects, domain events, repository **interfaces**, domain services/policies. Depends only on `@nexora/contracts` and `@nexora/shared`. No persistence, HTTP, or infra. (16 contexts: hr, identity, organizations, workspaces, projects, documents, knowledge, calendar, finance, crm, sales, inventory, procurement, analytics, administration, marketplace.) |
| `domains/<ctx>/application` | `@nexora/application-<ctx>` | Use-case layer: command/query handlers, DTOs, validators orchestrating the domain core. No persistence/HTTP/infra. Only some contexts have this layer so far. |
| `platform/<cap>` | `@nexora/module-<cap>` (also `@nexora/ai-runtime`, `@nexora/connectors`, `@nexora/mcp`) | Platform capabilities: workflow, event-bus, policy, search, notifications, measurements, configuration, observability, command-center, integrations, agents, detection, remediation, domains, plus the AI runtime. |
| `packages/*` | `@nexora/<name>` | Shared libs — see below. |
| `apps/*` | `@nexora/app-<name>` | Executables: `app-api`, `app-web`; `app-admin` and `app-docs` are scaffold only. |

Legacy hexagonal sub-dirs inside domains (`api/`, `ai/`, `infrastructure/`, `contracts/`) are
mostly `.gitkeep` placeholders per `ENGINEERING_PLAYBOOK.md §3.3`; real code lives in `src/` and
`application/`.

### Shared packages

- **`@nexora/contracts`** — source of truth for API, event, and manifest contracts (contract-first).
- **`@nexora/shared`** — shared kernel; `@nexora/shared/events` holds the `EventPublisher` contract.
- **`@nexora/persistence`** — Drizzle schema (`./schema`), migrations in `drizzle/`, and Postgres
  repository implementations (`./repositories`) behind the domain repository interfaces.
- **`@nexora/design-system`**, **`@nexora/agent-sdk`**, **`@nexora/plugin-sdk`**, **`@nexora/config`**.

### apps/api (`@nexora/app-api`) — Fastify 5 modular monolith

- `src/app.ts` — `buildApp(deps)` is **pure composition**. Routes receive their handlers from the
  container; the container receives repository implementations (Postgres, or in-memory fakes in
  tests). The whole surface is testable with `fastify.inject()` and no external services.
- `src/container.ts` — dependency wiring.
- `src/config.ts` — environment config.
- `src/routes/*.ts` — one file per surface, each exporting `register<X>Routes(app, dependencies)`.
- Handlers return a Result-shaped value (`{ ok: true, value }` / `{ ok: false, error }`); routes
  translate failures with `toHttpError` (`src/http/errors.ts`).
- `src/ai/*` — AI runtime integration (runtime, workflow-planner, workflow-executor, chat-stream,
  approval-engine, conversation store).
- `src/oidc/gateway.ts` + `src/plugins/auth.ts` (`requireAuth`) — Keycloak OIDC + cookie session.
- `src/mcp-server.ts` — Model Context Protocol server exposing the API as tools.

### apps/web (`@nexora/app-web`) — Vite 6 + React 18 SPA

- `src/App.tsx` — routes. Onboarding flow: Landing → Login (SSO) → `/onboarding/organization` →
  `/onboarding/workspace` → `/app` shell (`/app/command-center`, `/app/agent`, `/app/projects`,
  `/app/employees`, `/app/finance`, `/app/audit`, …). `RequireAuth` + `SessionProvider` live in
  `src/session.tsx`; `GET /api/me` resolves the session.
- Dev server proxies `/api/*` → `http://localhost:3001` so SPA and API share an origin and the
  session cookie flows without CORS.
- Role-based theming: `src/lib/roleThemes.ts`, `src/lib/RoleThemeContext.tsx`, `src/lib/rolePersonas.ts`.

### Infrastructure (`infrastructure/compose/`)

PostgreSQL (host :5433), Redis, MinIO (S3-compatible document storage; :9000, override to :9002),
Keycloak (:8080, `nexora` realm imported at startup). When `S3_ENDPOINT` is unset the API falls
back to in-memory document storage. When `GROQ_API_KEY` is unset the AI uses deterministic
narration instead of the Groq LLM.

## Conventions

- **Contract-first**: define contracts in `@nexora/contracts` before implementation.
- **Module boundaries are enforced** — no cross-module internals, no dependency cycles. A DAG
  checker reads `tooling/ci/module-map.md`. Dependency direction: `domain` → nothing;
  `application` → domain + contracts + shared; `infrastructure` → domain.
- **ESM source uses `.js` import specifiers** even in `.ts`/`.tsx` files
  (e.g. `import { Login } from './pages/Login.js'`).
- **ESLint** (`eslint.config.mjs`): `consistent-type-imports` (use `import type`), `eqeqeq`
  always, `no-console` except `warn`/`error`, `no-explicit-any` is a warning.
- **Naming**: `I<Aggregate>Repository` interfaces, `<Verb><Domain>Handler` / `ApplicationService`,
  past-tense domain/application events.
- **Vertical slices** — ship a feature end-to-end (domain → application → route → UI), not
  layer-by-layer.
- **Commits** are sprint-scoped: `feat(s34): <summary>` (sprint numbers track `ROADMAP.md`).
