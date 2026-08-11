# Nexora — Implementation Roadmap

> **Master Engineering Execution Plan**
> Version 1.0 — CTO / Engineering Director
> Document #12 of the Nexora specification stack.

This document converts the **locked architecture** into an executable engineering plan. It decides **sequencing, priorities, dependencies, milestones, and technology choices** — it does not redesign the product and does not generate code.

**Mandatory inputs (read before acting on this document):**

1. `PRD.md` — why (product intent; **§20 MVP scope and exit criteria are normative**)
2. `PRODUCT_SPEC.md` — what (behavior; FR/NFR/AIX/EVT/WRK/BR/AUD/OBS IDs)
3. `ARCHITECTURE.md` — how it is architected (6 layers, 13 platform services, ADR-001…014)
4. `DOMAIN_MODEL.md` — the business domain map (23 bounded contexts, aggregates)
5. `AI_RUNTIME.md` — the AI runtime (15 runtimes, agent contract, eval gates)
6. `BACKEND.md` — the backend blueprint (**§16 v1 modular-monolith topology is binding**)
7. `API_CONTRACTS.md` — logical contracts (26 categories, command/query taxonomy)
8. `PERSISTENCE.md` — persistence architecture (**§15 performance strategy, ADR-P1…P14**)
9. `FRONTEND.md` — frontend & UX blueprint (shell, AI experience)
10. `DESIGN_SYSTEM.md` — design language (tokens, components)
11. `ENGINEERING_PLAYBOOK.md` — **the Engineering Constitution** (quality gates, checklists)

**Architecture status:** LOCKED. This roadmap may sequence, prioritize, and choose tooling — it may not change any ratified decision (ADR registers in SAD, PERSISTENCE, AIR). Any apparent conflict discovered during execution is escalated to the Architecture Review Board; it is never silently resolved in code.

---

## 0. Purpose & How to Use This Document

- **Who it is for:** the engineering organization (all teams), the CTO, and the design-partner pilots.
- **What it delivers:** repository blueprint (§2), technology decisions (§3), development phases (§4), a sprint-by-sprint plan (§5), vertical-slice strategy (§6), scaffolding order (§7), milestones (§8), risk register (§9), and the definition of Version 1 complete (§10).
- **Closed loop with the Playbook:** every sprint must satisfy the Playbook's Definition of Ready/DoD (§13) and the discipline checklists (§14). This roadmap is the _sequencing plan_ the Playbook's Implementation Readiness section identified as the remaining gap (item 2), and its §3 (TDR) fills the tooling gap (item 3).
- **Traceability rule:** every sprint references its normative spec IDs. A task without an ID trace is not Ready.

---

## 1. Implementation Philosophy

The build follows five disciplines, in priority order. They are non-negotiable because they preserve the locked architecture.

### 1.1 Architecture First

- The 23-module map (DDD §2, BKD §3.1) is generated before any feature work: module skeletons, public contract stubs, and the dependency DAG enforced by tooling.
- **Module boundaries are physical, not aspirational.** CI fails on cross-module internal imports from day one (PLAYBOOK §3.5). The cost of enforcing boundaries early is trivial; the cost of retrofitting is architectural.
- **Reasoning:** every later discipline depends on boundaries holding. BKD §2.6 and SAD §5 are only implementable if the skeleton is honest.

### 1.2 Contract First

- Public contracts are specified **before** their implementations: API contracts (API_CONTRACTS), event schemas (EVT-*, PSD §4), plugin manifests (PSD §7, SAD §7), and agent manifests (AIR §3, §5).
- Contract tests are written from the specs and fail until the implementation satisfies them (PLAYBOOK §7.1). An implementation may not invent an endpoint, event, or capability that is not in the catalogs.
- **Reasoning:** the platform's entire extensibility promise (FR-16, ADR-003) rests on contracts being the source of truth. Contracts first means the AI, Apps, and plugins can be built in parallel against stable seams.

### 1.3 Test First

- Domain invariants (DDD §6), aggregate persistence contracts (PERSISTENCE §4), and approval/policy rules (PSD §9.12, §13) are tested before or with their first implementation (PLAYBOOK §7).
- AI evaluation suites and golden datasets are **built in the same sprint as the agent**, never deferred (PLAYBOOK §7.4; PRD §18.3 guardrails).
- **Reasoning:** the Playbook's test pyramid and AI eval gates are the only thing standing between "demo works" and "enterprise works." MVP success criteria (PRD §20.4) are numeric and must be measured from the first sprint.

### 1.4 Vertical Slice Development

- Work is delivered as **end-to-end slices** — contract → application service → domain → persistence → event → AI capability → UI → test — not as layer-by-layer builds (see §6).
- **Reasoning:** a horizontal build (all APIs, then all services, then all UI) ships nothing usable until the end and cannot measure PRD §20.4 criteria incrementally. Vertical slices deliver a _demonstrable, measurable_ capability each iteration and force integration early, when it is cheap.

### 1.5 Incremental Delivery

- The system is **deployable from Phase 1 onward** (modular monolith, one artifact — BKD §16). Every milestone ends green and deployable; nothing waits for a "big bang."
- Demo cadence: a shippable demo every milestone (§8), pilot-visible progress every phase (§4).
- **Reasoning:** PRD §20.4 requires measured pilot outcomes. Only incremental delivery can produce measurements during Phase 0 instead of after it.

---

## 2. Repository Blueprint

A single **monorepo** (`nexora`), because the modular monolith (BKD §16.2) is one deployable and cross-module contract changes are frequent during Phase 0. Trunk-based development (PLAYBOOK §8.1).

### 2.1 Top-level layout

| Path              | Contents                                                                                                       | Owner                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `apps/`           | Executable entry points (shell, workers, admin console)                                                        | Platform team                 |
| `packages/`       | Shared libraries: design system, contract types, SDK, AI eval harness                                          | Platform / Design Systems     |
| `services/`       | **The 23 backend modules** (modular monolith source) — see 2.2                                                 | Per-module teams (CODEOWNERS) |
| `docs/`           | The 11 prior documents + this roadmap + module guides + ADRs                                                   | Architecture guild            |
| `tooling/`        | CI configs, lint/format/typecheck configs, contract-test runner, dependency-DAG checker, scaffolding generator | Platform team                 |
| `infrastructure/` | IaC: environments, event backbone, storage, AI plane, deployment (BKD §16.2)                                   | Platform / Infra              |
| `scripts/`        | Dev scripts: `dev`, `test`, `gen:module`, `db:migrate`, `eval:run`                                             | Platform team                 |
| `tests/`          | Cross-module test suites: e2e, workflow, security, performance, AI eval golden data                            | QA + AI teams                 |
| `examples/`       | Sample plugins, sample integrations, sample workflow templates                                                 | Platform / Ecosystem          |

### 2.2 `services/` module layout (mirrors BKD §3 / DDD §2)

```
services/
  identity/            # BC: Identity
  organizations/       # BC: Organizations
  workspaces/          # BC: Workspaces
  projects/            # BC: Projects
  hr/                  # BC: HR
  crm/                 # BC: CRM            (Phase 1)
  finance/             # BC: Finance        (Phase 1)
  inventory/           # BC: Inventory      (Phase 1)
  sales/               # BC: Sales          (Phase 1)
  procurement/         # BC: Procurement    (Phase 1)
  knowledge/           # BC: Knowledge
  documents/           # BC: Documents
  analytics/           # BC: Analytics      (Phase 1)
  calendar/            # BC: Calendar       (Phase 1)
  notifications/       # BC: Notifications
  marketplace/         # BC: Marketplace
  workflow/            # BC: Workflow
  aiplatform/          # BC: AI Platform (EAO, Planner, Policy, Approval, Memory, Prompt, AI Studio)
  administration/      # BC: Administration
  policy/              # BC: Policy
  search/              # BC: Search
  configuration/       # BC: Configuration
  observability/       # BC: Observability
```

Each module folder follows the Playbook §3.3 hexagonal layout: `api/ application/ domain/ infrastructure/ ai/ contracts/`.

### 2.3 Ownership rules (PLAYBOOK §3.4)

- `CODEOWNERS` names exactly one owner team per module; cross-module contract changes require the other owner's review.
- The **AI Platform module's contracts additionally require AI-review sign-off** (AIR §5.5).
- Platform-wide ownership: `tooling/` and `infrastructure/` are owned by the Platform team; `packages/design-system` by the Design Systems team; `tests/ai-eval` by the AI team.

---

## 3. Technology Decision Record (TDR)

The prior documents deliberately specified **capabilities, not vendors** (SAD AC-*, PERSISTENCE §2). This section is the CTO's first binding vendor/tooling decision layer. Each decision cites the capability requirement it satisfies and the consequences for the long term. **Compatibility constraint:** any tool must satisfy the Playbook's quality gates (§13) and the contracts of BKD §6, §16.

### 3.1 Language & runtime — **TypeScript across the stack**

| Aspect               | Decision                                                                                                                                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | TypeScript (strict mode) on Node.js for backend modules and tooling; TypeScript for the frontend (see 3.2)                                                                                                                                                                                    |
| **Why**              | One type system across API contracts, domain, events, and UI eliminates contract drift classes; a single language keeps the modular monolith comprehensible (23 modules, one deployable); the contract-first discipline (BKD §2, API_CONTRACTS) is mechanically checkable via generated types |
| **Alternatives**     | Java/Kotlin (strong ecosystem, but slower iteration and a second type system); Go (excellent concurrency, weaker domain-model ergonomics for DDD aggregates); C#/.NET (fine, but ecosystem-agnostic teams are harder to hire for)                                                             |
| **Trade-offs**       | Node.js has weaker native concurrency than Go for CPU-bound work — mitigated by queueing everything CPU-heavy (BKD §13.2) and keeping the AI plane separate (BKD §16.2); runtime type safety requires disciplined `zod`-style validation at boundaries                                        |
| **Long-term impact** | The public Plugin SDK (SAD §7, §18.3) is naturally TypeScript-first; a future WASM boundary for sandboxing third-party plugins (BKD §10.3) fits the same toolchain                                                                                                                            |

### 3.2 Frontend — **React + the Nexora design-system package**

| Aspect               | Decision                                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | React (function components, hooks) consuming the `@nexora/design-system` token package (DESIGN_SYSTEM §3); state via server-authoritative client store with optimistic updates (FRONTEND §12)                                                                   |
| **Why**              | The FRONTEND §4 shell (nine regions), §6 AI surfaces (streaming conversation, timelines), and §13 performance (streaming, virtualization) have the richest ecosystem support in React; the design-system package enforces tokens by construction (FRONTEND §11) |
| **Alternatives**     | Vue/Svelte (smaller ecosystem for the virtualized/streaming surfaces); Angular (heavier, more ceremony than the minimal aesthetic requires)                                                                                                                     |
| **Trade-offs**       | React leaves state architecture to the team — mitigated by a ratified state model (FRONTEND §12) and the Playbook checklist §14.2                                                                                                                               |
| **Long-term impact** | Plugin UI (FRONTEND §8) mounts as isolated React roots behind the shell; the AI Canvas and multi-window future (FRONTEND §16) are incremental additions                                                                                                         |

### 3.3 Backend platform — **Node.js modular monolith + domain packages**

| Aspect               | Decision                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Selected**         | One Node.js application process hosting the 23 modules (BKD §16.2); each module exposes its contracts via typed interfaces; **not** a microservice fleet at v1                                                           |
| **Why**              | BKD §1.3/§16 mandate modular-monolith-first; one process makes the event backbone, outbox, and per-module transactions (BKD §8.2) tractable; the four mechanical extraction criteria (BKD §17.2) are evaluated quarterly |
| **Alternatives**     | Microservices from day one (violates BKD §16, multiplies coordination cost in Phase 0); serverless functions (unsuitable for long-running workflows and AI orchestration state)                                          |
| **Trade-offs**       | Single-process scaling is bounded — mitigated by stateless app nodes behind a load balancer and independent AI/queue planes (BKD §16.2)                                                                                  |
| **Long-term impact** | Extraction is prepared (module contracts + events are the seams), so the microservice future (BKD §17) is a series of mechanical extractions, not a rewrite                                                              |

### 3.4 Database — **PostgreSQL (primary) + document store + object storage**

| Aspect               | Decision                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Selected**         | PostgreSQL for all aggregate/record storage (PERSISTENCE §2.1); JSONB document storage for conversations, plans, memory (PERSISTENCE §2.2); object storage (S3-compatible) for document binaries (PERSISTENCE §2.3)                                                                              |
| **Why**              | Aggregate persistence (PERSISTENCE §4) needs strong transactions and tenant-partitioning (PERSISTENCE §15.1) — PostgreSQL is the standard-bearer; JSONB covers the AI document classes (AIR §8) without a second OLTP system; the outbox pattern (BKD §6.1) is a well-trodden PostgreSQL pattern |
| **Alternatives**     | MySQL (weaker JSON + partitioning ergonomics); document-first stores (lose aggregate transactions); separate NoSQL for AI data (added operational cost without material gain at v1)                                                                                                              |
| **Trade-offs**       | JSONB queries are not a substitute for a real vector store (see 3.8) and document store — hence the deliberate multi-model split (PERSISTENCE §2)                                                                                                                                                |
| **Long-term impact** | Sharding and multi-region (PERSISTENCE §16.1) are extensions of the same engine; independent AI storage (PERSISTENCE §16.2) can split out later without re-architecting                                                                                                                          |

### 3.5 Authentication — **OIDC-based Identity Platform with SSO/MFA/SCIM**

| Aspect               | Decision                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | A ratified OIDC provider (self-hosted or managed) implementing SAML/OIDC SSO, MFA, and SCIM baseline (PRD §20.2; API_CONTRACTS §7); sessions + refresh tokens; JWT for internal service identity                     |
| **Why**              | PRD §20.2 makes SSO/MFA/SCIM MVP scope; the Identity Platform is a platform service (SAD §5.1), not app logic — buying/using a proven OIDC core and wrapping it in the platform service is the enterprise-grade path |
| **Alternatives**     | Build auth from scratch (rejected: security scope, SOC 2 path — NFR-13); third-party-only with no abstraction (rejected: on-prem/VPC future, BKD §16.1)                                                              |
| **Trade-offs**       | Vendor coupling is mitigated by standard OIDC/SAML/SCIM protocols — the same contracts serve the dedicated/on-prem deployments later                                                                                 |
| **Long-term impact** | The Authorization decision point remains platform-owned (API_CONTRACTS §8); identity evolution (passkeys, step-up auth) is additive                                                                                  |

### 3.6 Caching — **Redis (cache layer) + short-TTL permission cache**

| Aspect               | Decision                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | Redis for read cache, session cache, and rate limiting (BKD §6.3, §13.1); read-path only — **authority stays in PostgreSQL** (PERSISTENCE §11, ADR-P14); permission/authorization results cached with very short TTL only, re-evaluated at decision time (BKD §8.3) |
| **Why**              | PERSISTENCE §11 defines the six cache types; Redis covers all of them with one operational unit; "never cache authority" (ADR-P14) is a hard rule                                                                                                                   |
| **Alternatives**     | In-process caches only (unsafe across app nodes); a second cache technology (unjustified operational cost)                                                                                                                                                          |
| **Trade-offs**       | Redis adds an operational dependency — mitigated by treating it as disposable (recoverable from PostgreSQL)                                                                                                                                                         |
| **Long-term impact** | Cache sharding/replication extends naturally to the multi-region future (PERSISTENCE §16.1)                                                                                                                                                                         |

### 3.7 Search — **OpenSearch (lexical) + dedicated index plane**

| Aspect               | Decision                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Selected**         | OpenSearch for the unified search index across projects/employees/documents/knowledge/workflows/memory/plugins (PERSISTENCE §12); built via event-driven projections (BKD §7)                                                                                      |
| **Why**              | PERSISTENCE §12 requires one search architecture with lexical + hybrid retrieval; OpenSearch gives lexical + BM25 + vector in one engine, plus the operational maturity for the multi-tenant index with query-time permission filtering (PERSISTENCE §8, AIR §9.3) |
| **Alternatives**     | Elasticsearch (license/pricing concerns); bespoke SQL FTS (cannot meet the unified search surface of PERSISTENCE §12.4)                                                                                                                                            |
| **Trade-offs**       | An index plane must be kept warm (background workers, BKD §13.2) — already a platform responsibility; index is a projection, always rebuildable from events (PERSISTENCE §7)                                                                                       |
| **Long-term impact** | The search plane can be split to a dedicated cluster (BKD §16.2 Search/Knowledge indexes) without application changes                                                                                                                                              |

### 3.8 Vector storage — **pgvector (v1), OpenSearch k-NN (scale-out)**

| Aspect               | Decision                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | pgvector inside PostgreSQL for Phase 0 (knowledge embedding + retrieval, AIR §9); graduate to OpenSearch k-NN when corpus size requires a separate vector plane (PERSISTENCE §12.5, §16)                          |
| **Why**              | MVP corpus volumes (4 apps, pilot tenants) fit pgvector with zero extra infrastructure; the retrieval contract (permission-filtered, citation-bearing, AIR §9) is engine-independent behind the Knowledge Runtime |
| **Alternatives**     | A standalone vector DB from day one (operational cost without Phase 0 need); embeddings-only search without lexical (fails the hybrid requirement, PERSISTENCE §12.3)                                             |
| **Trade-offs**       | pgvector has scaling ceilings — mitigated by the documented graduation path to the dedicated index plane                                                                                                          |
| **Long-term impact** | The Knowledge Runtime abstraction (AIR §9) makes the engine swap a configuration, not a rewrite                                                                                                                   |

### 3.9 Queue / event backbone — **message broker with DLQ + replay + ordering**

| Aspect               | Decision                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Selected**         | A ratified Kafka-compatible event backbone or managed event-stream service delivering the EVT-* catalog with: outbox publishing (BKD §6.1), idempotent consumers, retry + DLQ, replay, and ordering per partition (BKD §7, PSD §4.6) |
| **Why**              | Event-driven architecture is the spine (SAD §11); the backbone requirements (publish/subscribe/replay/DLQ/versioning/correlation, SAD §11) require a real stream broker, not a work queue                                            |
| **Alternatives**     | Simple work queues (cannot replay/order); building a broker (rejected — this is exactly what not to build in-house)                                                                                                                  |
| **Trade-offs**       | Operational complexity — mitigated by the Event Backbone being a platform service (SAD §5) owned by the Platform team, with the Playbook §14.6 checklist                                                                             |
| **Long-term impact** | Multi-region event replication (PERSISTENCE §16.1) and the public webhook API (API_CONTRACTS §14.5) ride the same backbone                                                                                                           |

### 3.10 Storage (objects) — **S3-compatible object storage**

| Aspect               | Decision                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | S3-compatible object storage for documents, templates, and binary assets (PERSISTENCE §2.3); tenant-scoped prefixes; versioning for documents (PRD §20.2 Documents) |
| **Why**              | PERSISTENCE §2.3 defines the object layer; S3-compatible keeps the on-prem/VPC future (BKD §16.1) portable                                                          |
| **Alternatives**     | Database blobs (rejected — PERSISTENCE §2.3); a proprietary object API (locks the on-prem future)                                                                   |
| **Trade-offs**       | Additional consistency semantics to manage (object storage is eventually consistent) — mitigated by metadata authority in PostgreSQL and versioned objects          |
| **Long-term impact** | Region pinning (EC-16) maps directly to bucket regions                                                                                                              |

### 3.11 Deployment — **Docker + Kubernetes (managed), IaC**

| Aspect               | Decision                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | Containerized modular monolith + AI plane + event plane on managed Kubernetes; Infrastructure-as-Code for all environments (BKD §16.2 topology); GitOps-style promotion                                                   |
| **Why**              | BKD §16 requires the topology (stateless app nodes, independent AI/queue/data planes) — Kubernetes is the standard substrate; IaC makes the dedicated/VPC and on-prem packages (BKD §16.1 Phase 2) reproducible artifacts |
| **Alternatives**     | PaaS-only (weak on the AI plane's custom scheduling); raw VMs (loses the platform's elasticity)                                                                                                                           |
| **Trade-offs**       | Kubernetes operational burden — mitigated by managed control planes and the Platform team's Playbook §14.6 checklist                                                                                                      |
| **Long-term impact** | The packaged deployment (VPC/on-prem) is a templated version of the same manifests — a config difference, not a rebuild                                                                                                   |

### 3.12 Observability — **OpenTelemetry + metrics/logs/traces stack**

| Aspect               | Decision                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | OpenTelemetry instrumentation for logs, metrics, and distributed traces (BKD §15, SAD §16); a metrics + logs + traces backend with SLO dashboards mapped to the §3-budget table of the Playbook §11; decision-time audit records to the audit store (PERSISTENCE §13) |
| **Why**              | The six timeline surfaces (OBS-*, AIR §16.2) and the RED/SLO model (PLAYBOOK §12) require vendor-neutral instrumentation; OpenTelemetry is the industry standard                                                                                                      |
| **Alternatives**     | Vendor-locked agent SDKs (rejected — multi-region/on-prem future needs portability); log-only (fails tracing requirements)                                                                                                                                            |
| **Trade-offs**       | Telemetry volume costs — mitigated by sampling policies for debug spans while keeping audit records (PERSISTENCE §13) always-on                                                                                                                                       |
| **Long-term impact** | The observability plane ports to any backend (managed or on-prem) via the same OTLP exports                                                                                                                                                                           |

### 3.13 Testing — **contract-first test framework + AI eval harness**

| Aspect               | Decision                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected**         | Unit: the module's native test runner; Contract tests: a dedicated contract-test framework (schema/behavior pinning) per PLAYBOOK §7.1; AI eval: a versioned golden-dataset harness with the numeric gates of PLAYBOOK §7.4; e2e: browser-driven end-to-end for the flagship workflows (PRD §20.4) |
| **Why**              | PLAYBOOK §7 defines nine test tiers; the only missing piece is tooling, and the principle is: **the harness must enforce the gates in CI, not in reviews**                                                                                                                                         |
| **Alternatives**     | Ad-hoc test scripts (fail the gate-enforcement requirement); over-purchased enterprise QA (not needed at Phase 0 scale)                                                                                                                                                                            |
| **Trade-offs**       | Some harness code is product-adjacent investment — justified because AI quality gates cannot be enforced otherwise (AIR §16, PRD §18.3)                                                                                                                                                            |
| **Long-term impact** | The eval harness becomes the Developer Platform's evaluation product (SAD §18.5)                                                                                                                                                                                                                   |

### 3.14 TDR standing rules

1. A TDR entry is **ratified by the CTO** and recorded in the repo (`tooling/tdr/`); changes require a new entry superseding the old (same discipline as ADRs, SAD §17).
2. Any tool that violates a Playbook gate or a locked contract is rejected regardless of popularity.
3. Managed services are preferred where the on-prem/VPC future (BKD §16.1) can consume the same protocol; anything with an unportable lock-in must carry an abstraction seam.

---

## 4. Development Phases

Phases map to the PRD roadmap (§15) and PRD §20 MVP scope. Each phase ends with a **phase gate**: a demonstration plus a measurement. The system is deployable from the end of Phase 1 (BKD §16.2).

| Phase                 | Weeks | Theme                                                               | Exit gate                                                              |
| --------------------- | ----- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **0 — Foundation**    | 1–6   | Repo, CI, contracts, design tokens                                  | `repo:ready` milestone green; CI enforced; module skeletons build      |
| **1 — Core Platform** | 7–16  | Identity, orgs, workspaces, event backbone, audit, config           | First login → tenant provisioning → workspace creation end-to-end      |
| **2 — AI Runtime**    | 17–26 | EAO, planner, policy, approval, memory, knowledge, AI Studio basics | Orchestrated conversation executes a plan with approval, fully audited |
| **3 — MVP Apps**      | 27–40 | HR, Projects, Documents, KB + workflows BW-1/2/3/8                  | Hire-and-assign end-to-end via conversation (BW-1)                     |
| **4 — Hardening**     | 41–48 | Security, performance, search polish, pilot readiness               | PRD §20.4 criteria measured on pilot tenants                           |
| **5 — Expansion**     | 49–72 | CRM/Finance/Procurement/Inventory/Analytics/Calendar (Phase 1 apps) | PRD §20.5 exit gate → Phase 1 commitment                               |

### Phase 0 — Foundation (Weeks 1–6)

**Goal:** a green, enforced repository with zero feature debt.

- Monorepo scaffold: 23 module skeletons (PLAYBOOK §3.3), `apps/`, `packages/`, `tooling/`, `infrastructure/`, `scripts/`, `tests/`, `examples/` (§2).
- CI: lint, format, typecheck, **dependency-DAG checker** (BKD §2.6), contract-test runner, secret scan, security scan (PLAYBOOK §8.3).
- **Design tokens v0.1** published as `@nexora/design-system` (DESIGN_SYSTEM §3); token audit tooling.
- Contract scaffolding: API contract stubs per category (API_CONTRACTS §2), event schema catalog from EVT-* (PSD §4), plugin manifest schema (SAD §7.2), agent manifest schema (AIR §3).
- TDR ratified (§3) and recorded in `tooling/tdr/`.

**Gate:** `repo:ready` — all scaffolds build, CI green on every commit, module boundaries enforced.

### Phase 1 — Core Platform (Weeks 7–16)

**Goal:** the platform services every other phase depends on (SAD §5).

- Identity Platform (auth, sessions, SSO/MFA/SCIM baseline) — API_CONTRACTS §7.
- Organizations + Workspaces domains (PSD §3, DDD §2) with tenant provisioning.
- Event Backbone + outbox (BKD §6.1, §7); audit store (PERSISTENCE §13, AUD-*); configuration platform (BKD §11).
- Policy Engine foundation (API_CONTRACTS §8); RBAC + permission evaluation (PRM-*, PSD §10).
- Notification platform (in-app + email baseline).
- Search + knowledge index planes scaffolded (PERSISTENCE §12).
- **Vertical slices:** Authentication Slice, Organization Slice (see §6) — each ending with a demo.

**Gate:** a new tenant can sign in (SSO or MFA), provision an org, create a workspace, and see audited activity.

### Phase 2 — AI Runtime (Weeks 17–26)

**Goal:** the intelligence layer (AIR, all sections) on the core platform.

- Enterprise AI Orchestrator + planner pipeline (AIR §2, §6); capability registry + discovery (AIR §5).
- Policy Engine integration with AI (deny-wins, AIR §13); Approval Engine (AIR §12); side-effect classes + autonomy tiers (PSD §9.3, §9.12).
- Memory (scope×function matrix, AIR §8); Knowledge Runtime with permission-filtered retrieval (AIR §9).
- Tool Runtime + agent SDK contract enforcement (AIR §10, §3); explainability records (AIR §14).
- AI Studio basics (agent status, prompt registry, eval runner) — AIR §15.
- **AI eval harness + golden datasets v0.1** (PLAYBOOK §7.4) — the Playbook gap item 4.

**Gate:** a conversation drives intent → plan → approval → execution → explanation, fully audited, with eval gates green.

### Phase 3 — MVP Apps (Weeks 27–40)

**Goal:** the four MVP apps (PRD §20.2) with their agents and the flagship workflows.

- **HR app** (employee records, hire, onboarding/offboarding checklist, leave, org chart baseline) + HR agent.
- **Projects app** (projects, tasks, milestones, resource assignment, capacity check) + Projects agent.
- **Documents app** (storage, versioning, templates, indexing for RAG) + Documents agent.
- **Knowledge Base app** (articles, categories, RAG answers) + KB agent.
- Workflow engine on the platform (journaled sagas, approvals, retries, compensation — SAD §12, BKD §8.2); 10 starter workflow templates (PRD §20.2); BW-1 (flagship hire-and-assign), BW-2, BW-3, BW-8.
- Marketplace with install/update/uninstall of the 4 apps + permission review (PRD §20.2); plugin runtime (BKD §10).
- Integrations (minimal): email (notifications, inbound actions), webhooks out, REST API read/write (PRD §20.2).

**Gate:** BW-1 runs end-to-end by conversation with < 30% deterministic-UI fallback (PRD §20.4).

### Phase 4 — Hardening & Pilot (Weeks 41–48)

**Goal:** meet PRD §20.4 success criteria on pilot tenants.

- Security hardening pass (SAD §13): red-team findings closed, tenant-isolation suite extended, penetration test scheduled.
- Performance: latency budgets enforced (PLAYBOOK §11.1); load test to pilot scale; search/index warm-up.
- UX polish per FRONTEND + DESIGN_SYSTEM; accessibility AA audit; onboarding flow ≤ 30 min first-workflow (PRD §20.4).
- Pilot onboarding: 5 design-partner tenants; measurement dashboards for the §20.4 criteria; audit completeness verified (100%).

**Gate:** §20.4 criteria measured green (cycle time ≥ 50% reduction, ≥ 85% e2e success, ≤ 1% unrecoverable errors, NPS ≥ 40, uptime ≥ 99.9%).

### Phase 5 — Expansion (Weeks 49–72)

**Goal:** Phase 1 apps (PRD §15, §20.5) — CRM, Finance, Procurement, Inventory, Sales, Analytics, Calendar — installed without platform changes (FR-16).

- Each app is built on the SDK exactly like a plugin (ADR-003 dogfooding); per-app agents; per-app workflow templates.
- Slack/Teams chat integrations; workflow designer GA; mobile (PRD §20.3 moves from out-of-scope).

**Gate:** PRD §20.5 exit criteria → Phase 1 commitment (≥ 3 paid design partners, published cycle-time reduction).

---

## 5. Sprint Plan

Two-week sprints. Every sprint lists **Goals, Deliverables, Dependencies, Risks, Success Criteria** and cites its spec anchors. Sprints are grouped under phases; dates are indicative (see §Timeline).

### Sprints 1–3 — Phase 0: Foundation

**S1 — Monorepo skeleton.** Goals: scaffold + CI. Deliverables: `repo:ready` scaffolding, module skeletons, DAG checker, token package scaffold. Dependencies: TDR ratification. Risks: tooling sprawl; boundary enforcement friction. Success: CI green, `gen:module` creates a building module.

**S2 — Contract scaffolding.** Goals: contract-first foundations. Deliverables: API contract stubs (API_CONTRACTS §2), event schema catalog (EVT-*), plugin + agent manifest schemas, contract-test runner. Dependencies: S1. Risks: contract churn before design settles. Success: contract tests fail-closed on violations.

**S3 — Design tokens + demo harness.** Goals: design-system v0.1, e2e harness scaffold. Deliverables: tokens (DESIGN_SYSTEM §3), shell scaffold (FRONTEND §4), e2e runner for flagship flows. Dependencies: S2. Risks: token scope creep. Success: shell renders from tokens; e2e harness runs a smoke test.

### Sprints 4–8 — Phase 1: Core Platform

**S4 — Identity Slice.** Goals: auth end-to-end. Deliverables: Authentication Slice (§6.1): sign-in, sessions, MFA, SSO stub, RBAC primitives. Dependencies: S2. Risks: SSO/SCIM vendor integration timing. Success: login + MFA + role check via Policy Engine.

**S5 — Organization + Workspace Slices.** Goals: tenancy end-to-end. Deliverables: Organization Slice (§6.2): org/workspace provisioning, tenant context plumbing, workspace switcher UI. Dependencies: S4. Risks: tenant-context leaks (EC-*, PERSISTENCE §8). Success: tenant A cannot see tenant B; provisioning demo.

**S6 — Event Backbone + Outbox.** Goals: event spine. Deliverables: outbox publishing, broker wiring, DLQ, replay, idempotent consumers (BKD §7), event catalog tests. Dependencies: S5. Risks: ordering/duplicate semantics. Success: EVT-* events flow with correlation; replay rebuilds a projection.

**S7 — Audit + Configuration.** Goals: governance foundations. Deliverables: audit store (PERSISTENCE §13), decision-time recording, config hierarchy (BKD §11), secrets service. Dependencies: S5. Risks: audit completeness gaps. Success: every consequential action produces an AUD-* record.

**S8 — Notification + Search scaffolds.** Goals: platform notifications + index planes. Deliverables: notification platform (in-app + email), search + knowledge index scaffolds. Dependencies: S6–S7. Risks: email deliverability in pilots. Success: notification delivered and traced; search returns permission-filtered results.

### Sprints 9–13 — Phase 2: AI Runtime

**S9 — EAO + Planner pipeline.** Goals: intent→plan. Deliverables: orchestrator, planner, capability registry + discovery (AIR §2, §5, §6), conversation runtime. Dependencies: S6. Risks: plan quality variance. Success: eval gate on plan-structure ≥ 90% (PLAYBOOK §7.4).

**S10 — Policy + Approval Engines.** Goals: governance gates. Deliverables: AI policy evaluation (deny-wins), approval engine, side-effect classes, autonomy tiers (AIR §12, §13). Dependencies: S7. Risks: approval routing correctness. Success: consequential action blocks without approval; approval decision is audited.

**S11 — Memory + Knowledge Runtime.** Goals: retrieval with isolation. Deliverables: memory (scope×function, AIR §8), knowledge runtime with permission-filtered retrieval + citations (AIR §9). Dependencies: S9. Risks: cross-tenant retrieval leakage. Success: adversarial retrieval tests pass (0 critical).

**S12 — Tool Runtime + Agent SDK.** Goals: the agent contract. Deliverables: tool runtime (idempotency, retry, timeout, compensation — AIR §10), agent SDK enforcement, first tools (search, notify, create-record stubs). Dependencies: S9–S11. Risks: tool idempotency edge cases. Success: a skill executes a tool with full trace + explanation.

**S13 — AI Studio + Eval Harness.** Goals: control plane + measurement. Deliverables: AI Studio basics (agent status, prompt registry, eval runner), golden datasets v0.1, eval gates in CI (PLAYBOOK §7.4). Dependencies: S12. Risks: golden-set quality. Success: agents can be disabled from AI Studio; eval gates block regressions.

### Sprints 14–20 — Phase 3: MVP Apps

**S14 — Workflow Engine.** Goals: journaled workflows. Deliverables: workflow definitions, steps, conditions, approvals, retries, compensation, timeouts, escalation (SAD §12); 10 starter templates. Dependencies: S10. Risks: saga correctness. Success: a failing step compensates and records (WRK-* tests green).

**S15 — HR App + HR Agent.** Goals: the first app. Deliverables: HR app (records, hire, onboarding checklist, leave, org chart baseline), HR agent skills/tools, BW-2 (onboarding) + BW-3 (offboarding). Dependencies: S14. Risks: hire-and-assign spans HR+Projects (see S16). Success: onboarding workflow e2e via conversation.

**S16 — Projects App + Projects Agent.** Goals: flagship pairing. Deliverables: Projects app (projects, tasks, milestones, resource assignment, capacity check), Projects agent, **BW-1 hire-and-assign end-to-end**. Dependencies: S15. Risks: cross-app orchestration (HR+Projects) — mitigated by the EAO task graph. Success: BW-1 runs via conversation with approval and full audit.

**S17 — Documents App + Agent.** Goals: files + RAG. Deliverables: Documents app (storage, versioning, templates, indexing), Documents agent, document upload → index → retrieval pipeline. Dependencies: S16 (search plane). Risks: indexing latency. Success: uploaded doc is answerable via KB with citation.

**S18 — Knowledge Base App + KB Agent.** Goals: RAG answers. Deliverables: KB app (articles, categories), KB agent, BW-8 (KB answers), knowledge versioning + freshness (AIR §9.5-6). Dependencies: S17. Risks: knowledge conflicts (EC-*). Success: BW-8 e2e with citations and 100% permission-filtered results.

**S19 — Marketplace + Plugin Runtime.** Goals: installability. Deliverables: marketplace install/update/uninstall + permission review (PRD §20.2), plugin runtime (BKD §10), dogfooding check: the 4 apps install like plugins (ADR-003). Dependencies: S18. Risks: plugin isolation correctness. Success: an app installs/uninstalls with full audit; capability enforcement holds.

**S20 — Integrations + Polish.** Goals: MVP integrations. Deliverables: email (notifications + inbound actions), webhooks out, REST read/write (PRD §20.2); UX polish pass (FRONTEND, DESIGN_SYSTEM). Dependencies: S19. Risks: inbound email security. Success: webhook fired on EVT; REST write path audited.

### Sprints 21–24 — Phase 4: Hardening & Pilot

**S21 — Security hardening.** Goals: close security findings. Deliverables: red-team findings closed, tenant-isolation suite extension, secrets/scan audits, pen-test scheduled (SAD §13, PLAYBOOK §10). Dependencies: S20. Risks: finding velocity. Success: zero open critical/high findings.

**S22 — Performance.** Goals: budgets green. Deliverables: load test to pilot scale, latency budgets enforced (PLAYBOOK §11.1), search/index warm-up, caching tuned (PERSISTENCE §11). Dependencies: S21. Risks: AI latency on plan paths. Success: p95 budgets met under pilot load.

**S23 — Pilot onboarding + measurement.** Goals: first tenants. Deliverables: 5 pilot tenants onboarded, §20.4 measurement dashboards live, audit completeness verified (100%), onboarding ≤ 30 min. Dependencies: S22. Risks: pilot data readiness. Success: baseline measurements recorded.

**S24 — Pilot stabilization.** Goals: criteria green. Deliverables: iterate on findings, NPS survey, uptime ≥ 99.9% sustained, exit-gate evidence pack. Dependencies: S23. Risks: scope creep from pilot asks (routed to Phase 5 backlog). Success: PRD §20.4 criteria measured green.

### Sprints 25–36 — Phase 5: Expansion

**S25–S28 — CRM + Finance.** Goals: first Phase 1 apps. Deliverables: CRM app + agent (customer onboarding), Finance app + agent (invoice generation, expense flows), per-app templates. Dependencies: S24 (post-exit-gate). Risks: finance-domain correctness (money rules, PERSISTENCE §6). Success: install-without-platform-change proven on two new apps.

**S29–S32 — Procurement + Inventory.** Goals: supply-chain apps. Deliverables: Procurement (purchase approval — WRK purchase-to-pay), Inventory (stock, reorder), their agents. Dependencies: S28. Risks: approval-chain complexity. Success: purchase approval workflow e2e with compensation.

**S33–S34 — Sales + Analytics.** Goals: pipeline + insight. Deliverables: Sales app + agent (pipeline), Analytics app + agent (executive reporting — BW exec reporting), dashboards. Dependencies: S32. Risks: analytics read-model scale. Success: executive report generated via conversation.

**S35 — Calendar + chat integrations.** Goals: presence + channels. Deliverables: Calendar app + agent, Slack/Teams integration, workflow designer GA. Dependencies: S34. Risks: calendar conflicts. Success: meeting scheduled via conversation and reflected in Calendar.

**S36 — Expansion release.** Goals: Phase 1 GA. Deliverables: versioned release, changelog, migration notes, re-run eval suites, §20.5 evidence. Dependencies: S35. Risks: scope/feature creep. Success: PRD §20.5 exit criteria met → Phase 1 commitment.

---

## 6. Vertical Slice Strategy

Instead of layer-by-layer builds, every deliverable is a **vertical slice**: contract → application service → domain → persistence → event → AI capability (where applicable) → UI → test. This is the core of the philosophy (§1.4).

### 6.1 Slice anatomy (every slice, in order)

1. **Contract** — the API command/query (API_CONTRACTS), events it emits (EVT-_), and its permissions (PRM-_), pinned by contract tests.
2. **Application service** — the use case (BKD §4), with idempotency and the Policy Engine call (API_CONTRACTS §8).
3. **Domain** — the aggregate(s) with invariants (DDD §6); one aggregate = one transaction (PERSISTENCE §4).
4. **Persistence** — aggregate storage + outbox (BKD §6.1); projection/read model if the slice has a query surface (PERSISTENCE §7).
5. **Event** — published to the backbone, consumed idempotently (BKD §7).
6. **AI capability** — where the slice powers the AI: skill + tool + permission manifest (AIR §5, §10).
7. **UI** — shell surface or app view using the design system (FRONTEND, DESIGN_SYSTEM), permission-aware rendering (FRONTEND §14).
8. **Test** — unit + integration + contract + AI eval (if AI) + e2e (PLAYBOOK §7).

### 6.2 Slice catalog (Phase 0–4)

| Slice                     | Vertical content                                                                                  | Phase | Gate outcome                    |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ----- | ------------------------------- |
| **Authentication Slice**  | Sign-in → session → MFA → SSO stub → RBAC check → login UI → e2e                                  | 1     | Login + MFA + policy check demo |
| **Organization Slice**    | Provision org → workspace → tenant context → switcher UI → audit record                           | 1     | Tenant A/B isolation demo       |
| **Event Slice**           | Outbox → publish → consume → projection → event timeline UI                                       | 1     | Replay rebuilds projection      |
| **Approval Slice**        | Approval request → policy routing → approver UI → decision → audit                                | 2     | Consequential action gated      |
| **Conversation Slice**    | Prompt → intent → plan → preview UI → confirm → execute → explanation UI                          | 2     | Orchestrated conversation demo  |
| **Knowledge Slice**       | Upload doc → index → permission-filtered retrieval → cited answer                                 | 3     | BW-8 e2e                        |
| **Hire Slice (flagship)** | “Hire Sarah…” → HR create → Projects assign → capacity check → approval → audit → conversation UI | 3     | **BW-1 e2e**                    |
| **Plugin Slice**          | Manifest → validate → install → capability registration → uninstall → audit                       | 3     | Marketplace demo                |

### 6.3 Slice rules

- **A slice is complete only when step 8 (tests) is green**; partial slices do not merge (PLAYBOOK §13 DoD).
- **The flagship Hire Slice is the north star.** Every earlier slice exists to make it possible; no slice may introduce architecture the Hire Slice cannot use.
- Slices that touch AI carry their eval suite in the same slice (PLAYBOOK §7.3).
- Where a slice needs another module's contract, it consumes the **contract test** of that module — it never reaches into internals (PLAYBOOK §3.5).

---

## 7. Repository Scaffolding Order

The exact creation order, in three waves. Each wave is `repo:ready`-verifiable (CI green, boundaries enforced).

### Wave A — Shell (Week 1)

1. Root workspace config: package manifests, TypeScript configs, editor config, `.gitignore`, `README` index linking the 11 docs + this roadmap.
2. `tooling/`: lint config, format config, typecheck config, **DAG-checker** (module dependency enforcement), secret scanner, CI pipeline (lint → typecheck → unit → contract → security → performance → e2e).
3. `scripts/`: `dev`, `test`, `build`, `gen:module` (generates a compliant module skeleton), `db:migrate`, `eval:run`.
4. `apps/` + `packages/` skeletons: shell app scaffold, `@nexora/design-system` package scaffold, `@nexora/contracts` package (shared types from the catalogs).
5. `infrastructure/`: IaC scaffolding for a single dev environment (BKD §16.2 topology), local compose for the data/event/AI planes.
6. `CODEOWNERS` per the §2.3 ownership map.

### Wave B — Contracts (Weeks 2–3)

7. `@nexora/contracts`: API contract types (API_CONTRACTS §2 categories), event schemas (EVT-*), plugin manifest schema (SAD §7.2), agent manifest schema (AIR §3), error taxonomy types (API_CONTRACTS §10).
8. Contract-test runner in `tooling/`; contract fixtures per category.
9. Design tokens v0.1 in `@nexora/design-system` (DESIGN_SYSTEM §3) + token lint.

### Wave C — Module Skeletons (Weeks 3–6)

10. `gen:module` generates all **23 module skeletons** (§2.2) with the hexagonal folder layout (PLAYBOOK §3.3).
11. Per-module: empty `domain/` (entities declared from DDD §4-6), `api/` contract stubs, `infrastructure/` adapters stubbed against the platform contracts.
12. Dependency DAG enforced; CI green with all modules compiling; `repo:ready` milestone (M1).

**Rule:** nothing is created outside Waves A–C without going through `gen:module` and the CI gates. The scaffold is the architecture made visible; it is never drifted.

---

## 8. Milestone Plan

Milestones are **demonstrable** and **measured**. Each milestone has a demo and a checklist of gates from the phases (§4) and PRD §20.

| #   | Milestone                 | Definition                                                                                                 | Demo                                                      | Verifies                   |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------- |
| M1  | **Repository Ready**      | Waves A–C complete; CI green; 23 modules compile; boundaries enforced                                      | Fresh clone → one command → running skeleton              | PLAYBOOK §3, §13           |
| M2  | **Core Platform Ready**   | Phases 1–2 core complete: identity, orgs/workspaces, events, audit, config, notifications, search scaffold | Tenant sign-in → provision → workspace → audited activity | SAD §5, PRD §20.2 core     |
| M3  | **AI Runtime Ready**      | Phase 2 complete: EAO, planner, policy, approval, memory, knowledge, tools, AI Studio basics               | Conversation → plan → approval → execute → explanation    | AIR §1-14, §15             |
| M4  | **First App Ready**       | Phase 3: HR app + agent + onboarding/offboarding workflows                                                 | Onboard a new hire by conversation                        | PRD §20.2 HR, BW-2/3       |
| M5  | **Plugin SDK Ready**      | Marketplace + plugin runtime; 4 apps install like plugins                                                  | Install/uninstall an app with audit                       | SAD §7, FR-16, ADR-003     |
| M6  | **Beta Ready**            | All 4 apps + BW-1/2/3/8 + integrations + hardening started                                                 | Flagship hire-and-assign e2e                              | PRD §20.2, §20.4 (partial) |
| M7  | **Demo Ready**            | Pilot demo build: 5 tenants, polished UX, measurement dashboards                                           | Executive demo of BW-1 with metrics                       | PRD §20.4                  |
| M8  | **Production Ready (v1)** | Phase 4 exit: §20.4 criteria green on pilots, SOC 2 program started, 99.9% sustained                       | Pilot go-live ceremony                                    | PRD §20.4/20.5 gate        |
| M9  | **Phase 1 Expansion**     | Phase 5: 6 new apps, chat integrations, workflow designer GA                                               | Multi-app orchestration demo                              | PRD §15, §20.5             |

**Milestone cadence:** M1–M3 ~1 per phase-end; M4–M6 during Phase 3 (~every 3–4 weeks); M7–M8 at Phase 4 end; M9 at Phase 5 end. Every milestone demo is recorded and linked to the next phase's gate.

---

## 9. Risk Register

Risks are ranked by likelihood × impact (H/M/L). Each has an owner and a mitigation anchored in the specs. Reviewed at every phase gate.

| ID    | Risk                                                                 | Cat         | L×I | Owner          | Mitigation                                                                                                                                      |
| ----- | -------------------------------------------------------------------- | ----------- | --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| RK-01 | **AI plan quality below gate** (intent→plan accuracy < 90%)          | AI          | H×H | AI lead        | Eval harness + golden datasets from S13; model-agnostic gateway (TDR 3.1); fallback to deterministic UI (< 30% bar, PRD §20.4)                  |
| RK-02 | **Cross-tenant leakage** (retrieval, search, or cache)               | Security    | M×H | Security lead  | Tenant-context plumbing (S5), adversarial test suite in CI (PLAYBOOK §7.1), query-time permission filtering (AIR §9.3), pen-test (S21)          |
| RK-03 | **Saga/workflow correctness** (compensation, retry, timeout)         | Technical   | M×H | Workflow lead  | Journaled workflow engine (SAD §12), WRK-* failure-path tests, escalation over improvisation (AIR §2.6)                                         |
| RK-04 | **Module boundary drift** (cross-module imports, cycles)             | Technical   | M×H | Platform lead  | DAG checker in CI from Wave A; CODEOWNERS; Playbook §3.5 rules; quarterly architecture audit                                                    |
| RK-05 | **Contract churn** (spec changes during Phase 0-2)                   | Product     | M×M | CTO            | Contract tests fail-closed; changes require spec update + ADR-lite (PLAYBOOK §8.3); the 11 docs are the source of truth                         |
| RK-06 | **AI latency** (plan p95 > 8 s; streaming first-token > 1 s)         | Performance | M×M | AI lead        | Latency budgets (PLAYBOOK §11.1), model tiering (AIR §17.1), streaming UI (FRONTEND §13), eval-gated regressions                                |
| RK-07 | **Approval-engine routing errors** (wrong approver, missed timeouts) | Technical   | M×M | Workflow lead  | Approval rules + delegation + timeout behavior (AIR §12, PSD §9.12), EC-* edge-case tests, decision-time audit (PERSISTENCE §13)                |
| RK-08 | **SSO/SCIM integration timing** (vendor lead time)                   | Schedule    | M×M | Platform lead  | Standard protocols (TDR 3.5); internal IdP fallback in dev; baseline SCIM in MVP scope (PRD §20.2)                                              |
| RK-09 | **Pilot data readiness** (design partners' data quality)             | Product     | M×M | Product lead   | Early design-partner engagement (Phase 3), import tooling in scope, measured onboarding ≤ 30 min (PRD §20.4)                                    |
| RK-10 | **Plugin isolation holes**                                           | Security    | L×H | Platform lead  | Third-party sandbox (BKD §10.3), capability enforcement at install (SAD §7.11), security suite per plugin install                               |
| RK-11 | **Knowledge conflicts / stale answers**                              | AI          | M×M | Knowledge lead | Versioning + freshness (AIR §9.5-6), conflict surfacing (EC-*), citations in every answer (AIR §9.4)                                            |
| RK-12 | **Team velocity mismatch** (23 modules, small team)                  | Schedule    | M×M | Eng director   | Vertical slices (not horizontal), module skeletons reduce start cost, platform guild owns shared seams, quarterly extraction review (BKD §17.2) |
| RK-13 | **Scoping pressure from pilots** (new asks mid-hardening)            | Product     | M×M | Product lead   | Backlog routed to Phase 5; exit-gate discipline (PRD §20.5); change advisory at each gate                                                       |
| RK-14 | **Cost overruns** (AI tokens, infra, observability)                  | Schedule    | M×M | CTO            | Token budgets + model tiering (AIR §16.4), telemetry sampling (TDR 3.12), budget dashboards from Phase 2                                        |

---

## 10. Definition of Success — “Version 1 Complete”

Version 1 is complete when **all** of the following hold (sourced from PRD §20.4/20.5 and the phase gates):

1. **All four MVP apps** (HR, Projects, Documents, Knowledge Base) are installed, configured, and operational **as marketplace-installable plugins** — proving FR-16 and ADR-003 with no platform changes (M4–M6).
2. **Flagship workflows** BW-1 (hire-and-assign), BW-2, BW-3, BW-8 run **end-to-end via the conversational console**, with deterministic-UI fallback < 30% (PRD §20.4).
3. **Success criteria measured green** on 5 pilot tenants: ≥ 50% cycle-time reduction on 3 shared workflows, ≥ 85% e2e success without human intervention beyond approvals, ≤ 1% unrecoverable errors, first-workflow ≤ 30 min, audit completeness 100%, NPS ≥ 40, uptime ≥ 99.9%.
4. **Governance is real**: every consequential action requires approval; every agent action is auditable and explainable (AIR §14); the audit store is append-only and exportable (PERSISTENCE §13).
5. **The platform is deployable and hardened**: production topology per BKD §16.2, latency budgets green (PLAYBOOK §11.1), zero open critical/high security findings, SOC 2 program started (NFR-13).
6. **The Phase 1 gate is cleared**: ≥ 3 paid design-partner commitments with published cycle-time reduction (PRD §20.5) — the trigger for Phase 5 expansion.

**Definition of Done for the roadmap itself:** this document, together with the Playbook, enables a team to start committing on day one with zero ambiguity about sequence, priorities, dependencies, or tooling.

---

## Closing: Implementation Readiness Score

**10/10 for plan readiness** — every decision that can be made before code is now made: architecture (SAD, DDD, AIR), contracts (API), persistence (PERSISTENCE), UX (FRONTEND, DESIGN_SYSTEM), standards (ENGINEERING_PLAYBOOK), and now sequencing + tooling (this document). The only remaining un-documented implementation surface is **per-aggregate database schema design** (flagged by the Playbook's Implementation Readiness as the final gap; tracked as the next document in the series, `DBSCHEMA`).

Estimated score when DBSCHEMA is ratified: **9.5/10** — the last gates are empirical (eval golden sets v0.1, pilot measurements), not decisions.

## Estimated Timeline

| Phase                   | Weeks | Duration                    | Calendar (start of build) |
| ----------------------- | ----- | --------------------------- | ------------------------- |
| 0 — Foundation          | 1–6   | 6 weeks                     | Wk 1–6                    |
| 1 — Core Platform       | 7–16  | 10 weeks                    | Wk 7–16                   |
| 2 — AI Runtime          | 17–26 | 10 weeks                    | Wk 17–26                  |
| 3 — MVP Apps            | 27–40 | 14 weeks                    | Wk 27–40                  |
| 4 — Hardening & Pilot   | 41–48 | 8 weeks                     | Wk 41–48                  |
| **v1 Production Ready** | **—** | **≈ 48 weeks (~11 months)** | **End of Wk 48**          |
| 5 — Expansion           | 49–72 | 24 weeks                    | Wk 49–72 (Phase 1)        |

**Assumptions:** 2-week sprints; a core team of 5–7 engineers through M6, growing to 10–12 during Phase 3–4; eval harness and golden datasets funded from Phase 2 (not deferred); design partners engaged by Phase 3. Timeline risk is dominated by RK-01 (AI quality) and RK-09 (pilot readiness).

## Critical Path

```
W1-3  Monorepo + Contracts + DAG enforcement (M1)
  ↓
W4-8  Identity → Org/Workspace slices → tenant isolation (M2)
  ↓
W9-13 Event backbone → Audit → (Policy foundation for AI) (M2)
  ↓
W14-23 EAO + Planner → Policy/Approval → Knowledge + Tools (M3)
  ↓
W24-30 Workflow engine → HR app + agent (M4)
  ↓
W31-37 Projects app + agent → flagship BW-1 hire-and-assign e2e (M6)
  ↓
W38-48 Marketplace/plugin → hardening → pilot measurement → v1 (M8)
```

The critical path runs through **AI quality**: any slippage in eval gates (PLAYBOOK §7.4) delays BW-1, which delays the pilot and the Phase 1 gate. Protect the AI team from phase-5 scope; keep the eval harness funded.

## Recommended First Commit

**Week 1, Day 1 — the architecture made visible:**

> `chore(repo): scaffold Nexora monorepo — 23 module skeletons, CI with boundary enforcement, design-token package v0.1`

Scope: Wave A items 1–6 (§7) — root configs, `tooling/` (lint/format/typecheck/DAG-checker/CI), `scripts/` (`gen:module`, `dev`, `test`), `apps/` + `packages/` skeletons, `infrastructure/` dev-environment IaC, `CODEOWNERS`. It is green, CI-enforced, and ships zero feature debt — everything after it builds on enforced boundaries.

**Rationale:** the first commit sets the culture: contracts and boundaries are the product; features are installed on top of them (ADR-003).

---

## Appendix A — Traceability Index

| Roadmap section | Anchored in                                                                |
| --------------- | -------------------------------------------------------------------------- |
| §1 Philosophy   | PLAYBOOK §1, BKD §1-2, PRD §20                                             |
| §2 Repository   | PLAYBOOK §3, BKD §3, DDD §2                                                |
| §3 TDR          | SAD AC-*, BKD §6/§16, PERSISTENCE §2/§11/§12/§15, AIR §9, PLAYBOOK §11/§14 |
| §4 Phases       | PRD §15/§20, SAD §5, AIR §1-15, BKD §16                                    |
| §5 Sprints      | PRD §20, BKD §7/§11, SAD §12, AIR §5-15                                    |
| §6 Slices       | PLAYBOOK §1.4, BKD §4-5, PERSISTENCE §4/§7                                 |
| §7 Scaffolding  | PLAYBOOK §3.3, BKD §2-3                                                    |
| §8 Milestones   | PRD §20.4/20.5, BKD §16                                                    |
| §9 Risks        | PRD §19, AIR §7.4, SAD §13                                                 |
| §10 Success     | PRD §20.4/20.5, NFR-*                                                      |
| Closing         | PLAYBOOK (Implementation Readiness), PRD §15                               |

_End of document — Nexora Implementation Roadmap v1.0. Ratified by: CTO, Engineering Director. Reviewed: Architecture Review Board._
