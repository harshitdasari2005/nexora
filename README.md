# Nexora

**Work. Orchestrated by AI.**

Nexora is an **AI-native enterprise operating system** — not an ERP. Users interact with the system in natural language; the Enterprise AI Orchestrator understands intent, plans the work, coordinates the right AI agents across installed applications, executes the workflow, and reports the result — with a human always in control and every action auditable.

> "Hire Sarah and assign her to the Mobile Banking project."
>
> → Nexora plans the workflow, invokes the HR and Projects agents, requests approval, executes, and explains what happened.

---

## The Product

- **AI First** — the AI is the primary interface; applications exist to support it, not the other way around.
- **Everything is an App** — installable applications (HR, Projects, CRM, Finance, Documents, Knowledge Base, …) each own their data, permissions, events, and an AI agent.
- **Human always in control** — money, people, contracts, and deletions always require human approval.
- **Every action is auditable and explainable** — the AI explains every decision.
- **Workspace-first** — every company can run multiple workspaces (Engineering, HR, Finance, …), each owning its apps, agents, knowledge, and permissions.
- **Enterprise grade** — multi-tenant, secure by design, event-driven, extensible, scalable.

## The Specification Stack

Twelve mutually consistent documents define Nexora from vision to first commit:

| #   | Document                  | Role                    |
| --- | ------------------------- | ----------------------- |
| 1   | `PRD.md`                  | Why — product intent    |
| 2   | `PRODUCT_SPEC.md`         | What — behavioral spec  |
| 3   | `ARCHITECTURE.md`         | How it's architected    |
| 4   | `DOMAIN_MODEL.md`         | Business domain model   |
| 5   | `AI_RUNTIME.md`           | AI runtime & agents     |
| 6   | `BACKEND.md`              | Backend blueprint       |
| 7   | `API_CONTRACTS.md`        | Logical API contracts   |
| 8   | `PERSISTENCE.md`          | Database & persistence  |
| 9   | `FRONTEND.md`             | Frontend & UX blueprint |
| 10  | `DESIGN_SYSTEM.md`        | Design language         |
| 11  | `ENGINEERING_PLAYBOOK.md` | How engineers build it  |
| 12  | `ROADMAP.md`              | Master execution plan   |

The specs are the source of truth; code references them by section (e.g. `BACKEND.md §16`).

## Status — what is actually built

This repo is **well past the MVP scaffold**. Broad strokes (see `DEVELOPMENT.md` for the current
"what's real" table and `ROADMAP.md` for the plan):

- **Platform**: Fastify modular monolith (`apps/api`), Vite + React SPA (`apps/web`), Keycloak
  OIDC auth, Postgres via Drizzle (migrations `0000`–`0018`), event pipeline (notifications +
  activity + webhooks + email), append-only-style audit views.
- **AI runtime**: Enterprise AI Orchestrator, capability discovery, sequential planner,
  approval engine (durable), journaled workflow engine, ~8 registered agents (Workspaces,
  Projects, HR, Knowledge, Notifications, Calendar, Finance, Workflow), Nexora MCP server
  (stdio + authenticated HTTP), external connectors (GitHub, Slack).
- **Apps / verticals**: HR, Projects, Documents, Knowledge, Calendar, Finance, plus
  Command Center, proactive problem detection, governed remediation, marketplace,
  integrations, role/persona-aware workspaces (S34 authoritative RBAC).
- **Quality gates**: `pnpm typecheck`, `pnpm lint`, and `pnpm test` (~1,300 tests) are green.

Domains still at stub level (one-line `index.ts`): CRM, Sales, Inventory, Procurement,
Analytics, Administration, Marketplace core — these arrive in later `ROADMAP.md` sprints.

## Repository Structure

```
apps/              Executable applications: api (Fastify), web (Vite/React); admin, docs are scaffold
packages/          Shared libraries: contracts, design-system, agent-sdk, plugin-sdk, config, persistence, shared
domains/           Business bounded contexts (DDD) — 16 domains, some with an application/ layer
platform/          Platform capabilities: ai-runtime, workflow, event-bus, policy, search, notifications,
                   measurements, configuration, observability, command-center, integrations, agents,
                   detection, remediation, domains, connectors, mcp
infrastructure/    Local infra (docker compose) + Keycloak realm import
scripts/           dev-local, seed-demo, gen-module, scan-secrets
tests/             Cross-module suites (performance/load, e2e placeholders)
examples/          Sample plugins, integrations, workflow templates
.github/           GitHub Actions CI
```

## Prerequisites

- **Node.js** — see `.nvmrc` (currently **22**; `engines` allows ≥ 20). `nvm use` picks it up.
- **pnpm** `10.33.0` (`corepack enable`, or `npm i -g pnpm`)
- **Docker** + Docker Compose (Postgres, Redis, MinIO, Keycloak)

> **Do not keep this repo in an iCloud-Drive-synced folder** (`~/Desktop`, `~/Documents` with
> "Desktop & Documents Folders" on). iCloud stalls reads under `node_modules`, which makes the
> dev server hang on boot. Clone/move it somewhere like `~/dev/`.

## Getting Started

```bash
cp .env.example .env    # local settings; the defaults work as they are
pnpm install

# One command: starts the Docker infra, waits for health, then API :3001 + Web :5173.
# Ctrl+C stops API/Web; infra keeps running (`pnpm dev:local:down` to stop it).
pnpm dev:local

# Seed the demo tenant (log in once first as alex@nexora.dev / nexora123):
pnpm demo:reset
```

Postgres is mapped to host port **5433**; MinIO follows `S3_PORT` in `.env` (default 9000 —
change it there if that port is taken). Port overrides:
`NEXORA_API_PORT=3100 NEXORA_WEB_PORT=5174 pnpm dev:local` — sign-in through Keycloak is
registered for the default ports 3001/5173 only.

Other useful scripts:

```bash
pnpm dev:infra        # just the Docker infra
pnpm dev:api          # only the API (tsx watch)
pnpm dev:web          # only the web app (vite)
pnpm build            # turbo build across the workspace
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run (all packages)
pnpm scan:secrets     # secret-pattern gate
pnpm eval:run         # scenario evaluation (hermetic) → evaluation-results/latest.json
pnpm scenarios:seed   # deterministic scenario dataset into Postgres (scenarios:reset to reseed)
```

Database (Drizzle, in `@nexora/persistence`):

```bash
pnpm --filter @nexora/persistence db:generate   # SQL from schema changes
pnpm --filter @nexora/persistence db:migrate    # apply migrations
pnpm --filter @nexora/persistence db:studio
```

The API auto-runs migrations on boot when `DATABASE_AUTO_MIGRATE=true` (default in `.env.example`).

## Guided Demo (demo mode)

Set `NEXORA_DEMO_MODE=true` on the API to enable the gated demo experience (demo
sign-in is unauthenticated, so with `NODE_ENV=production` the API refuses to
start unless `NEXORA_DEMO_ALLOW_IN_PRODUCTION=true` is also set). At
boot the API seeds one deterministic, isolated demo organization — **Lumen
Capital (Demo)** — with four real seeded accounts (CEO, Team Manager, Finance
Controller, CFO), two workspaces (Engineering Delivery, Finance), projects,
employees, a budget and the organization's approval-authority policy. The
landing page then shows **Start demo** (`/demo`); the in-app **Guided demo**
(`/app/demo`) walks the story Request → Plan → Governance → Approval →
Execution → Verification → Trace, deriving every stage from backend state.

- Persona switching starts a **real session** for a seeded account
  (`POST /api/demo/login` with a persona key from the server's allowlist — never
  an email or user id); authorization then runs the normal pipeline.
- **Reset demo** (`POST /api/demo/reset`) restores only the demo organization
  (the browser names no target), is serialized and idempotent, and records the
  reset as an activity item. Earlier demo audit history is cleared with the data.
- With demo mode off, `/api/demo/*` answers 404 and nothing else changes.

```bash
NEXORA_DEMO_MODE=true pnpm dev:api   # API with the demo world
pnpm dev:web                          # then open http://localhost:5173 → Start demo
```

## Development Conventions

- **Contract first** — public contracts (API, events, manifests) live in `@nexora/contracts` and are the source of truth.
- **Module boundaries are enforced** — no cross-module internals, no dependency cycles (a DAG checker reads `tooling/ci/module-map.md`).
- **ESM source uses `.js` import specifiers** even in `.ts`/`.tsx` files.
- **Vertical slices** — ship a feature end-to-end (domain → application → route → UI), not layer-by-layer.
- **Commits are sprint-scoped**: `feat(s34): <summary>` (sprint numbers track `ROADMAP.md`).

---

_Nexora — Work. Orchestrated by AI._
