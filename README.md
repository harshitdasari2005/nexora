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

Twelve mutually consistent documents define Nexora from vision to first commit (see [`docs/README.md`](docs/README.md)):

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

## Repository Structure

```
apps/              Executable applications (web, admin, docs)
packages/          Shared libraries (contracts, design-system, agent-sdk, plugin-sdk, config)
domains/           Business bounded contexts — 16 domains (DDD)
platform/          Platform capabilities — 8 modules (ai-runtime, workflow, event-bus, policy, search, configuration, notifications, observability)
docs/              The specification stack + architecture/engineering docs
tooling/           Shared configs, CI checks, DAG enforcement
infrastructure/    Local infra (compose) + Infrastructure-as-Code
scripts/           Development scripts (dev, test, gen:module, db:migrate, eval:run)
tests/             Cross-module suites (e2e, workflow, security, performance, ai-eval)
examples/          Sample plugins, integrations, workflow templates
.github/           GitHub Actions CI
```

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`corepack enable` or `npm i -g pnpm`)
- **Docker** + Docker Compose (for local infrastructure)
- **Turborepo** is provided via the workspace (`turbo` dev dependency)

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Start local infrastructure (PostgreSQL, Redis, MinIO, Keycloak)
cp .env.example .env   # adjust credentials as needed
pnpm dev:infra

# 3. Run the dev toolchain
pnpm dev        # starts workspace dev tasks (turbo)
pnpm test       # runs all tests
pnpm lint       # runs ESLint across the workspace
```

> Scaffold note: this repository is the **Wave A/B/C skeleton** (ROADMAP.md §7) — module skeletons, contracts, tooling, and infra placeholders. Business logic, UI pages, and endpoints arrive in later sprints per `ROADMAP.md`. There is intentionally **no application code yet**.

## Development Conventions

- **Contract first** — public contracts (API, events, manifests) are the source of truth (ENGINEERING_PLAYBOOK.md §1.2).
- **Module boundaries are enforced** — no cross-module internals, no dependency cycles (ENGINEERING_PLAYBOOK.md §3.5).
- **Vertical slices** — work ships end-to-end, never layer-by-layer (ROADMAP.md §6).
- **Quality gates** — lint, typecheck, tests, contract tests, and AI evaluations run in CI (ENGINEERING_PLAYBOOK.md §13).

## Status

**Scaffold phase (Roadmap M1 — Repository Ready in progress).** See [`ROADMAP.md`](ROADMAP.md) for the phase plan, sprint plan, and milestones.

---

_Nexora — Work. Orchestrated by AI._
