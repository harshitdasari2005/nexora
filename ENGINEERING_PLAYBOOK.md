# Nexora — Engineering Playbook

**Product:** Nexora — _Work. Orchestrated by AI._
**Document Type:** Engineering Playbook / Engineering Constitution (ENB)
**Version:** 1.0
**Owner:** Engineering Excellence
**Audience:** Every engineer joining Nexora — read this before writing code
**Related documents:** PRD v1.0 · PSD v1.0 · SAD v1.0 · DOMAIN_MODEL v1.0 · AIR v1.0 · BKD v1.0 · API v1.0 · PERSISTENCE v1.0 · FRONTEND v1.0 · DESIGN_SYSTEM v1.0

---

## 0. Purpose & Consistency

### 0.1 Purpose

This document is the **Engineering Constitution**: the standards that govern implementation quality across the entire project. It defines how engineers build Nexora — philosophy, principles, repository structure, coding standards, AI and plugin engineering, testing, git workflow, documentation, security, performance, observability, quality gates, checklists, and how the engineering organization scales. It contains **no implementation code** — only standards with reasoning.

### 0.2 Consistency contract

Every standard here **enforces** the prior documents rather than repeating them:

| Prior document                                       | Enforced by                             |
| ---------------------------------------------------- | --------------------------------------- |
| BKD §1.3 (module boundaries), §6 (outbox), §8 (CQRS) | §3 repository, §4 coding, §7 testing    |
| DDD §6 (aggregates), §5.2 (transaction rules)        | §4 coding, §7 testing                   |
| AIR §15 (AI Studio eval), §16 (monitoring)           | §5 AI engineering, §7 testing           |
| API §12 (versioning), §10 (errors)                   | §6 plugins, §7 testing (contract)       |
| PERSISTENCE §8 (isolation), §13 (audit)              | §10 security, §7 testing                |
| FRONTEND/DESIGN_SYSTEM (tokens, FEX-*)               | §4 coding (frontend), §7 testing (a11y) |
| SAD ADR-001…014, AC-*                                | §10 security, §9 docs (ADR process)     |

---

## 1. Engineering Philosophy

### 1.1 Nexora is built differently from CRUD applications (reasoning)

| CRUD-app assumption                        | Nexora stance                                                                                                     | Why                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| The system is a set of screens over tables | The system is **orchestrated work**: AI plans, agents execute, humans approve — the UI is a projection            | The product is an AI Operating System (PRD §1, §3)           |
| Business rules live in services, sometimes | Business rules live in **aggregates**; invalid states are unrepresentable                                         | Invariants are the product's trust foundation (DDD §6, BR-*) |
| Frontend and backend are the system        | The **AI Runtime is a first-class peer** of frontend and backend; the AI acts under the same governance as humans | One governance path (PRM-8, ADR-001)                         |
| Modules are organizational happenstance    | Modules are **bounded contexts** with hard boundaries; no cross-module internals or storage                       | FR-16 (extensibility), AC-15, BKD §1.3                       |
| Events are an integration detail           | **Events are the cross-module contract**; projections rebuild from them                                           | PSD §8, ADR-002                                              |
| Databases are shared                       | **Databases serve domains**; per-module persistence with tenant isolation                                         | PERSISTENCE §1/§3/§8                                         |

**The engineer's mindset:** every change asks three questions — (1) _Does this respect aggregate boundaries?_ (2) _Does this go through the governed path (application services, tools, approval gates)?_ (3) _Is this observable and explainable?_ If the answer to any is no, the change is not ready.

---

## 2. Core Engineering Principles

| #     | Principle                         | Meaning                                                                                       | Reasoning / source           |
| ----- | --------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- |
| EN-1  | **Single Responsibility**         | One module, one class, one function — one reason to change                                    | AP-14 (high cohesion)        |
| EN-2  | **Composition over Inheritance**  | Compose behaviors via ports/contracts; inheritance only for true is-a                         | BKD §1.2 (hexagonal)         |
| EN-3  | **DDD**                           | Code mirrors the Domain Model: aggregates, VOs, domain services, per BC                       | DOMAIN_MODEL (all)           |
| EN-4  | **Clean Architecture**            | Domain core independent of infrastructure; adapters plug in                                   | BKD §1.2                     |
| EN-5  | **Event Driven**                  | Cross-module communication via events; trigger-not-action                                     | PSD §8, ADR-002              |
| EN-6  | **API First**                     | Contract before implementation; every capability reachable via defined interfaces             | API v1.0 (API-P1)            |
| EN-7  | **AI First**                      | Build the AI-governed path first; deterministic UI is the power layer                         | PRN-1, FR-8                  |
| EN-8  | **Plugin First**                  | First-party features dogfood the plugin contract                                              | PRD P5, BKD §10.1            |
| EN-9  | **Convention over Configuration** | Sensible defaults via platform conventions; config only where variance is real                | PRN-14                       |
| EN-10 | **YAGNI**                         | Build what the current requirement needs; extensions come via contracts, not speculative code | FR-16 (contracts, not forks) |
| EN-11 | **KISS**                          | The simplest correct design wins; complexity is a defect to be reviewed                       | FEX-5 analog                 |
| EN-12 | **SOLID**                         | Applied at module/class/function level across backend, frontend, AI                           | Standard practice            |
| EN-13 | **DRY**                           | Reuse platform services and contracts; no duplicated logic across modules                     | BKD §6 (shared infra)        |

**Conflict resolution (reasoning):** when principles conflict, safety and governance win: **Security → Isolation → Explainability → Human control → Correctness → Simplicity** (mirrors PRN-15, AC-*). A simple change that bypasses governance is rejected; a governed change with acceptable complexity is preferred.

---

## 3. Repository Standards

Realizes: SAD §5 (13 platform services), DDD §2 (23 bounded contexts), BKD §3 (23 modules).

### 3.1 Organization philosophy

- **One codebase, many modules.** The repository mirrors the architecture: a single deployable (modular monolith, BKD §16) containing **23 modules that map 1:1 to the DDD bounded contexts** (BKD §3.1). No module exists outside that map; adding a module without a bounded context is a review-blocking smell.
- **The map is the law.** `docs/module-map.md` is the single source of truth for module ownership. Every source file's first-level directory must resolve to exactly one module in the map.
- **Boundaries over shortcuts.** Dependency rules (below) are enforced by tooling in CI, not by reviewer memory (BKD §2.6 layer rules).

### 3.2 Naming conventions

| Scope                     | Convention                                                                                 | Reasoning                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Modules                   | Bounded-context name, PascalCase, single word (e.g., `Identity`, `Projects`, `AIPlatform`) | 1:1 traceability to DDD §2; searchable; no acronyms                  |
| Packages/namespaces       | `nexora.<module>.<layer>` (e.g., `nexora.projects.domain`)                                 | Reflects the 4-layer component model (BKD §2.2)                      |
| Aggregate roots           | Singular domain noun, PascalCase (`Employee`, `PurchaseOrder`)                             | The root IS the concept (DDD §6)                                     |
| Value objects             | Immutable noun, PascalCase (`Money`, `EmailAddress`)                                       | Reusable, side-effect-free (DDD §5)                                  |
| Domain services           | Verb phrase + `Service`, PascalCase                                                        | Services DO things (DDD §7)                                          |
| Application services      | `<Verb><Domain>ApplicationService`                                                         | One service per use case group (BKD §4)                              |
| Application/domain events | Past-tense verb, PascalCase, `*ed`/`*Created`                                              | Events are facts that already happened (PSD §4)                      |
| Repositories              | `I<Aggregate>Repository` (interface), `<Aggregate>RepositoryImpl`                          | Persistence behind the aggregate contract (BKD §6.1, PERSISTENCE §4) |
| Skills / tools (AI)       | `<domain>.<verb>.<noun>` skill IDs; `tool_<verb>_<noun>` tool IDs                          | Registry-friendly, globally unique (AIR §3/§5)                       |

### 3.3 Folder conventions

Per module (hexagonal, BKD §2.2):

```
modules/<Module>/
  api/            # command/query contracts exposed by this module (BKD §3, API_CONTRACTS)
  application/    # application services, use cases, sagas (BKD §4)
  domain/         # entities, VOs, aggregates, domain services, domain events (DDD §4-8)
  infrastructure/ # persistence, outbox, integrations, connectors (BKD §6, §9)
  ai/             # agent manifest, skills, tools, knowledge for this module's agent (AIR §3, §10)
  contracts/      # manifests: capability, skill, tool, policy, workflow, knowledge, permission (AIR §5)
```

**Reasoning:** the folder tree is the dependency graph made visible; `domain` depends on nothing, `infrastructure` depends on the domain (dependency inversion).

### 3.4 Module ownership

- Each module has exactly **one named owner team** in `CODEOWNERS`. The owner is accountable for its contracts, events, and agent (SAD §6.3).
- **Cross-module change rule:** a change touching another module's public contract requires that module's owner to approve; the AI Platform module's contracts additionally require AI-review sign-off (AIX-*, AIR §5.5).

### 3.5 Dependency rules

1. `domain` → nothing (pure).
2. `application` → domain + other modules' application/domain via contracts only.
3. `api` → application only.
4. `infrastructure` → domain + platform infrastructure contracts (no other module's domain internals).
5. **Modules communicate only through contracts and events** (DDD §10, BKD §2.6); direct service-to-service calls between module internals are prohibited.
6. **No cycles.** The dependency graph must be a DAG; CI enforces it (BKD §2.6).

---

## 4. Coding Standards

### 4.1 General principles

- **Small, single-purpose functions:** a function does one thing, reads top-to-bottom, and fits the screen (aim ≤ 40 lines; exceeding it is a refactor signal, not a badge).
- **Classes own one responsibility** (SOLID, §2). An aggregate root holds its invariants; an application service orchestrates; an infrastructure adapter adapts. If a class name contains “And”, split it.
- **File organization:** one primary type per file; file name matches the type. Files over 250 lines are a decomposition signal.
- **Comments explain WHY, never WHAT.** Code should be self-evident; comments capture decisions, invariants, and non-obvious reasoning. Every comment that cites a spec must cite the **normative ID** (e.g., `// BR-07: employees cannot belong to deleted departments`).
- **Documentation lives with the code** (see §9). Public contracts must carry intent-level doc references to the API/PSD contract they implement.
- **No dead code, no speculative generality** (YAGNI). Delete what you don't use; add generics only when a second concrete use exists.

### 4.2 Error handling philosophy

- **Errors are data, not exceptions to be swallowed.** Business-rule violations return typed domain outcomes (the `ValidationError`, `PolicyViolation`, `ConflictError` taxonomy of API_CONTRACTS §10), never raw system exceptions.
- **Fail loud at the edge, fail safe at the core.** The API layer translates; the domain throws/returns invariant violations; the AI layer must never receive an untyped error.
- **Idempotency is a contract, not an afterthought:** every command carries an idempotency key (BKD §8.2); handlers must be safe to re-run.
- **Retry only what is retryable** (transient infra errors); business-rule failures are never retried blindly — they escalate (BKD §14.3).
- **No `catch` without a decision:** every catch must handle, translate, log+rethrow with context, or compensate — never silently swallow (AUD-_, OBS-_).
- **Never log secrets or PII beyond what audit requires** (SAD §13.6, PERSISTENCE §13).

### 4.3 Concurrency & transactions

- **One aggregate = one transaction** (DDD §6, PERSISTENCE §4). Multi-aggregate/multi-module flows are journaled sagas with compensation (BKD §8.2, SAD §12.4).
- **Optimistic concurrency** on aggregate writes (version field); conflicts return the typed `ConflictError` and the caller re-reads (PERSISTENCE §4).
- **All event publishing goes through the outbox** in the same transaction as the aggregate write (BKD §6.1, §7.1). No fire-and-forget publishing.

---

## 5. AI Engineering Standards

Realizes: AI_RUNTIME.md (all sections), PSD §9 (AIX-*), SAD §8.

### 5.1 How AI components are built

- **AI is a governed layer, not a free-for-all.** Every AI component (agent, skill, tool, workflow, memory class, prompt) is declared in a manifest and passes through the registries (AIR §5) before it can execute. No ambient AI.
- **Deterministic core, stochastic skin.** The orchestration pipeline (planner → verification) is deterministic and testable; only the reasoning sub-steps consume models (AIR §1.5 invariant 3, §6).
- **Every AI decision is recordable.** Components that act must emit the decision-time explainability record (AIR §14: intent, reasoning, knowledge used, policies applied, capabilities, agents, tools, approvals, final decision, confidence). If a component cannot be explained, it is not shippable (PSD AIX-11/19).

### 5.2 Prompt management

- Prompts are **versioned assets in the Prompt Registry** (AIX-13), never string literals in code. Changes are diffable, reviewable, and rollbackable (AIR §15, PSD AIX-13).
- Every prompt declares: purpose, input contract, expected output contract, model compatibility, version, and owner.
- **No prompt writes policy.** Policy text lives in the Policy Registry; prompts only reference policy by ID (AIR §13.5).
- Prompt changes require the same review bar as code, plus an AI-evaluation pass (§7.4).

### 5.3 Agent development

- Every agent implements the **14-element agent contract** (AIR §3): identity, manifest, capabilities, skills, tools, policies, permissions, knowledge, events, memory, lifecycle, health, version, configuration. An agent missing any element does not register.
- Agents expose capabilities only; they never reach into another module's internals. Capabilities map to skills; skills map to tools (AIR §5).
- **Human-approval requirements are declared per skill** in the permission manifest (SideEffectClass, AutonomyTier — PSD §9.3, AIR §12.1). Undeclared = default to most restrictive tier.
- Agent memory is scoped (workspace/company, PSD AIX-5) and lifecycle-managed (AIR §8.5); no agent accumulates unbounded memory.

### 5.4 Tool development

- Tools are the only way agents touch the world (AIR §10). Tool manifests declare: schema, side-effect class, idempotency, timeout, retry policy, and permission requirements (SAD §8.1, API_CONTRACTS §5).
- **Idempotent by design** — a tool must be safe to invoke twice with the same key (AIR §10.7).
- Tools validate input before side effects; they return typed results or typed errors, never raw exceptions.
- **No destructive tool without approval** (PSD BR-*: deletions, money, people, contracts always require human approval).

### 5.5 Memory & knowledge

- Memory uses the scope×function matrix (AIR §8); storage and TTL per memory class are defined in the memory manifest.
- Knowledge items are versioned, source-attributed, and permission-tagged at ingestion (AIR §9.5-6).
- **Retrieval must be permission-filtered at query time** — a retrieval that bypasses the access filter is a security defect (AIR §9.3, SAD §13.7).

### 5.6 Evaluation & safety

- Every agent ships with an evaluation suite (§7.4): correctness, refusal, safety, and policy-adherence cases — including adversarial cases (prompt injection, cross-tenant leakage attempts).
- **Red-team checklist before release:** injection attempts, unauthorized knowledge access, approval bypass, tool misuse, goal confusion.
- Safety gates: consequential actions require approval (PSD §9.12); policy violations stop execution with deny-wins (AIR §13.4); failures escalate to humans rather than improvising (AIR §2.6).

---

## 6. Plugin Development Standards

Realizes: SAD §7 (Plugin SDK), PSD §7 (App Contract), API_CONTRACTS §6, FRONTEND §8.

### 6.1 Plugin lifecycle

- Plugins follow the ratified lifecycle: **Register → Validate → Install → Activate → (Update) → Deactivate → Uninstall** (SAD §7.3, DDD §14.8). Every transition is recorded in the audit log.
- **Validation before install:** manifest schema, capability conflicts, dependency resolution, permission declarations, and policy compatibility (SAD §7.8, API_CONTRACTS §6.3). Unvalidated plugins cannot install.

### 6.2 Manifest rules

- The manifest is the **single contract** (PSD §7.2). It declares: id, version, name, capabilities, permissions, dependencies, events produced/consumed, navigation, configuration schema, and the agent manifest (AIR §3).
- Manifests are versioned semantic versions; a manifest change without a version bump is a CI failure.

### 6.3 Versioning, dependencies, isolation

- **SemVer:** breaking changes bump the major version; the platform supports co-installation of compatible major versions during transition (SAD §7.10).
- **Dependency declarations are explicit** (name+version range); the platform resolves and validates them at install (SAD §7.9). No dynamic discovery at runtime.
- **Isolation contract:** v1 first-party modules run in-process but must satisfy the same boundary rules as third-party plugins (BKD §10.3); third-party code runs in sandboxed processes. A plugin can never reach outside its declared capabilities (SAD §7.11).
- **Compatibility:** plugins declare a supported platform API version; the platform enforces it at install and blocks incompatible upgrades (SAD §7.12).

### 6.4 Plugin data & config

- Plugin data is namespaced and versioned (PERSISTENCE §10); migrations are reversible and staged.
- Plugin configuration is validated against the declared schema; configuration values are tenant-scoped (BKD §11.4).

### 6.5 First-party dogfooding

- **First-party Apps are plugins too** (ADR-003). The HR App, Projects App, etc., are developed under exactly the same SDK rules as third-party plugins — this is the guarantee that future Apps install without platform changes (FR-16, PSD §7).

---

## 7. Testing Standards

### 7.1 Test pyramid

- **Unit tests** cover domain logic: entities, VOs, aggregates, invariants, domain services (DDD §4-7). Target: fastest feedback, highest count.
- **Integration tests** cover application services against real infrastructure (repository, outbox, messaging) in a contained environment — not mocks of everything (BKD §6).
- **Contract tests** pin public contracts: API contracts (API_CONTRACTS), event schemas (PSD §4), and plugin manifests (SAD §7). A contract change without a versioned, reviewed update is a CI failure.
- **AI evaluation** (see §7.4) is a first-class test tier, not an afterthought.
- **Workflow tests** execute journaled workflow definitions end-to-end: steps, conditions, approvals, retries, compensation, timeouts, escalation (SAD §12, WRK-*). Every workflow ships with at least one happy-path and one failure-path test per approval point.
- **Performance tests** guard the latency budgets: p95 read < 200 ms, p95 write < 400 ms, p95 AI plan < 8 s (NFR-_, AC-_). Regression beyond budget blocks release.
- **Security tests** run in CI: tenant-isolation probes, permission-boundary tests, secrets scanning, dependency vulnerability scanning, and AI red-team cases (§5.6).
- **End-to-end tests** cover the flagship journeys (hire-and-assign, purchase approval, invoice generation — BW-_/WRK-_) through UI + AI + backend together.

### 7.2 Testing rules

- **Name tests by behavior, not implementation:** `assigns_employee_to_project_emits_EmployeeAssigned`.
- One behavior per test; arrange–act–assert with no hidden setup in assertions.
- **Tests may not depend on other tests** (no shared mutable state); use fresh tenant/workspace fixtures per test.
- Every aggregate invariant (DDD §6) has at least one positive and one negative test.
- **Property-based tests** for value-object invariants (e.g., Money never has float rounding — PERSISTENCE §6).

### 7.3 AI testing

- **Deterministic layers are tested like code**: planner output structure, capability matching, policy evaluation, approval routing (AIR §5-6, §12).
- **Non-deterministic layers are tested with evaluation suites + golden datasets**, not unit asserts: intent detection, plan quality, summarization.
- Golden datasets are versioned artifacts; regenerating them requires review.

### 7.4 AI evaluation gates

| Dimension        | Minimum bar                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| Correctness      | ≥ 90% on golden task suite per agent                                   |
| Refusal quality  | ≥ 95% correct refusal on out-of-scope asks                             |
| Safety           | 0 critical failures (injection, leakage, bypass) on red-team suite     |
| Policy adherence | 100% on policy-violation test set (deny-wins)                          |
| Explainability   | 100% of acting responses carry a complete explanation record (AIR §14) |

**Reasoning:** AI quality gates must be numeric and enforced in CI like any other test tier, or they silently decay (AIR §16, PRD §18.3 guardrail metrics).

---

## 8. Git Workflow

### 8.1 Branch strategy

- **Trunk-based development.** Short-lived feature branches (≤ 2 days) off `main`; merge via PR. Releases are tags on `main`. No long-lived integration branches.
- **One concern per branch**; branch names: `<module>/<summary>` (e.g., `projects/assign-employee-command`).

### 8.2 Commit conventions

- Conventional Commits: `feat(projects):`, `fix(identity):`, `ai(hr):`, `plugin(sdk):`, `refactor(workflow):`, `docs(api):`, `test(persistence):`.
- Each commit is a coherent unit that builds green; no “wip” commits on shared branches.
- **Commit messages may not reference secrets or customer data.**

### 8.3 Pull request requirements

Every PR must:

1. Reference the spec IDs it implements (e.g., "Implements FR-12, PSD APP-HR, AIR §10").
2. Include tests for every behavior change (§7).
3. Pass all quality gates (§13) and CI checks (lint, typecheck, tests, contracts, security scans, AI evals if AI code touched).
4. **Explicitly state when an AI component is changed**, with the evaluation results attached.
5. Keep changes small and reviewable (≤ 400 lines of production change unless pre-approved with a rationale).

### 8.4 Code review checklist

- Correctness and edge cases (EC-* catalog is a checklist source).
- Aggregate invariants preserved; transaction boundary respected (one aggregate = one transaction).
- Event names/contracts match the normative catalogs (EVT-*, DDD §8) — no ad-hoc new events without spec update.
- Permission checks present and correct on every command and query (API_CONTRACTS §3-4, PRM-*).
- No secrets, no PII in logs; audit record completeness (AUD-*).
- Idempotency keys on all commands; outbox used for publishing.
- AI changes carry manifest updates, evaluation evidence, and approval-tier declarations.
- Accessibility & design-token compliance for UI changes (FRONTEND §11, DESIGN_SYSTEM §3).
- **Dependency direction**: no module depends on another module's internals; no cycles.

### 8.5 Release strategy

- **SemVer** on the platform; additive-only API evolution with deprecation windows (API_CONTRACTS §12).
- Release trains: **weekly** minor/patch; **quarterly** feature milestones; **never** breaking changes without a documented migration + deprecation period.
- Every release ships with: changelog, migration notes, updated contract docs, and re-run AI evaluation suites.
- **Release blockers:** any quality gate red, any open security finding above threshold, any breaking change without deprecation plan.

---

## 9. Documentation Standards

### 9.1 Documentation tiers

| Tier         | Artifacts                                      | Owner              | Where                             |
| ------------ | ---------------------------------------------- | ------------------ | --------------------------------- |
| Product      | PRD, PSD, Design System                        | Product            | `docs/product/`                   |
| Architecture | SAD, DDD, AIR, BKD, API, PERSISTENCE, ADRs     | Architecture guild | `docs/architecture/`              |
| Engineering  | Playbook, module guides, runbooks              | Engineering        | `docs/engineering/`               |
| API/contract | Contract specs, event catalog, plugin SDK docs | Each module owner  | `docs/api/` (generated + curated) |
| Code         | Doc comments, ADRs, decision notes             | Author             | With the code                     |
| User         | Help center, KB content, in-app guides         | Product education  | `docs/user/`                      |

### 9.2 Rules

- **Architecture docs cite normative IDs** (FR-_, EVT-_, AIX-_, WRK-_, ADR-*) so claims are traceable to decisions. No ID, no claim.
- **Every significant decision becomes an ADR** — decision, reason, alternatives, trade-offs, benefits, future impact (SAD §17 format). ADRs are immutable; changes are new ADRs that supersede.
- **API docs must not drift from contracts:** contract tests (§7.1) fail when behavior diverges from documented contracts.
- **User docs never promise AI behavior the runtime cannot explain** (AIR §14); feature docs link to the relevant explainability view.
- **Docs are code-reviewed like code**; dead docs (documenting removed behavior) are deleted with the code that removes it.
- Keep docs close to code: module READMEs, generated API references, and a single `docs/README.md` index.

---

## 10. Security Standards

Realizes: SAD §13, PERSISTENCE §8/§13, API_CONTRACTS §7-8.

### 10.1 Secrets

- **Never in code, config, or logs.** Secrets live in the Secrets Manager (BKD §6.9); code reads them only at runtime via the platform secrets service.
- Rotate on schedule and on suspicion; integration credentials are scoped per connector (BKD §9.4).
- CI scans for secret patterns on every commit; violations block merge.

### 10.2 Authentication & authorization

- Authentication via the Identity platform (SSO-ready, MFA, sessions — API_CONTRACTS §7); no bespoke auth code in modules.
- **Authorization is a single decision point:** every command and query calls the Policy Engine synchronously (BKD §8.3, API_CONTRACTS §8). Modules never implement their own permission checks.
- Least privilege: agents get scoped identities; service principals get minimum scopes; users get default-deny with explicit grants (PSD §10).
- **Tenant isolation is test-enforced:** cross-tenant access attempts are part of the security test suite (§7.1) and any breach blocks release (PERSISTENCE §8).
- **Plugin isolation:** third-party plugins run sandboxed; capability enforcement at the boundary (SAD §7.11, BKD §10.3).
- **AI safety:** permission-filtered knowledge retrieval (AIR §9.3), approval tiers on consequential actions (PSD §9.12), no prompt-controlled policy (AIR §13.5).
- Audit completeness: every consequential action records Who/When/Why/Source/Tenant/Workspace/Agent/Approval/Result (PERSISTENCE §13, AUD-*).
- Compliance: SOC 2 + regional requirements are design constraints from day one (NFR-13, SAD §13.8) — never retrofits.

---

## 11. Performance Standards

Realizes: AC-_, NFR-_, PERSISTENCE §15, FRONTEND §13.

### 11.1 Budgets

| Surface                    | Budget                                   |
| -------------------------- | ---------------------------------------- |
| p95 interactive read (p95) | < 200 ms                                 |
| p95 command/write          | < 400 ms                                 |
| p95 AI plan generation     | < 8 s (with streaming first-token < 1 s) |
| Search result window       | < 300 ms p95                             |
| First contentful paint     | < 1.5 s (4G)                             |
| Time to interactive        | < 2.5 s (desktop)                        |

Budgets are enforced by performance tests in CI (NFR-9).

### 11.2 Rules

- **Caching is read-path only**; authority stays in the database (PERSISTENCE §11, ADR-P14). Never cache authorization results beyond short TTL; permission checks run against policy at decision time (BKD §8.3).
- **Queries target projections, not aggregates** (BKD §8.2); read models are built from events, never ad-hoc joins across modules.
- **Background work goes to queues**: email, notifications, analytics aggregation, index updates (BKD §13.2). No blocking work in request paths.
- **Concurrency:** optimistic concurrency for writes; bounded concurrency for background workers; no unbounded parallelism in AI execution (AIR §11.5).
- **Memory:** streaming responses, pagination everywhere (API_CONTRACTS §11), virtualization for long lists (FRONTEND §13.5); no loading unbounded datasets.
- **AI:** model selection by latency/cost tier (AIR §17.1); caching of stable knowledge retrieval; token budgets per plan (AIR §16.4).
- **Horizontal scaling** is stateless at the service layer; storage scales by tenant-partitioned design (SAD §15, PERSISTENCE §15.1).

---

## 12. Observability Standards

Realizes: BKD §15, SAD §16, PSD §16 (OBS-*), AIR §16.

### 12.1 Logs

- Structured, tenant-tagged, machine-parseable. Every log line carries: `tenant_id`, `workspace_id`, `correlation_id`, `request_id`, `timestamp`, `severity`, and the emitting module.
- **No PII and no secrets in logs**; personal data appears only where audit requires, in the audit store (PERSISTENCE §13), never in operational logs.

### 12.2 Metrics & tracing

- RED metrics (Rate, Errors, Duration) per service; SLOs mapped from the §11 budgets.
- **Distributed tracing** with correlation IDs threaded through every request, event, and AI execution (API_CONTRACTS §13, AIR §16). The AI timeline, workflow timeline, and activity timeline (OBS-*) are trace-joined views over the same correlation chain.
- AI telemetry: token usage, model latency, cost per execution, and guardrail metric drift (PRD §18.3) — emitted as metrics, not just logs (AIR §16.4).
- Business telemetry: workflow completion/abandonment, approval turnaround, agent success/failure rates — the product metric families (PRD §18) are instrumented as first-class telemetry.

### 12.3 Timelines (product surfaces)

The six timeline surfaces (Activity, AI, Workflow, Decision, Memory, Knowledge — OBS-*, AIR §16.2) are **product features**, not debug tools. Engineering must treat them as shipped surfaces with the same quality bar as any UI: permission-filtered, streaming, and complete.

---

## 13. Quality Gates

### 13.1 Definition of Ready (before work starts)

- The task references its spec IDs (FR/AIX/EVT/WRK/ADR or equivalent) — no un-spec'd feature work.
- Acceptance criteria are testable and enumerated; edge cases from the EC-* catalog are considered.
- AI work has an evaluation plan and approval-tier declarations; plugin work has a manifest and dependency list.
- Performance implications are identified against the §11 budgets.

### 13.2 Definition of Done (per change)

- Implementation matches the referenced spec; no un-documented deviations.
- Tests added/passed per §7 (unit + integration + contract + AI eval as applicable).
- All CI gates green: lint, typecheck, security scan, contract tests, performance tests, AI evaluations.
- Documentation updated (API docs, ADRs, module READMEs) and normative IDs cited.
- Audit-ability confirmed: new actions emit their events and audit records (AUD-_, EVT-_).
- Reviewed per the §8.4 checklist; owner sign-off for cross-module changes.

### 13.3 Merge requirements

- All DoD items satisfied; PR is small and focused; CI green; required reviewers approved; no open blocking findings.

### 13.4 Release requirements

- All DoD/merge items for every change in the release; release blockers (§8.5) clear; changelog and migration notes complete; AI evaluation suites re-run; contracts versioned correctly (API_CONTRACTS §12).

---

## 14. Engineering Checklists

### 14.1 Backend checklist

- Module boundary respected; dependency direction valid (DAG); no module-internal leaks.
- One aggregate per transaction; outbox for events; idempotency keys on commands.
- Policy Engine consulted on every command/query; no local permission logic.
- Errors mapped to the API error taxonomy (API_CONTRACTS §10); no untyped exceptions at the edge.
- Logs structured + tenant-tagged; audit records complete; no secrets/PII in logs.

### 14.2 Frontend checklist

- UI reads from projections (no direct aggregate queries); optimistic updates with safe rollback (FRONTEND §12).
- Design tokens only — no ad-hoc colors/spacing (DESIGN_SYSTEM §3); accessibility AA; keyboard paths tested.
- Permission-aware rendering matches policy (FRONTEND §14); AI surfaces use the dedicated AI components (§6).
- Performance: virtualization, pagination, streaming, prefetching within budgets.

### 14.3 AI checklist

- Agent implements the full 14-element contract (AIR §3); manifests registered and validated.
- Skills declare SideEffectClass + AutonomyTier; consequential actions route to approval.
- Knowledge retrieval permission-filtered; explanations complete (AIR §14); eval suite green (§7.4).

### 14.4 Plugin checklist

- Manifest complete + versioned; dependencies explicit; validation passed; isolation contract respected.
- Plugin events match the normative catalog or are declared extensions; permissions declared at install.
- Plugin config schema declared; data namespaced with reversible migrations (PERSISTENCE §10).

### 14.5 Database checklist

- Aggregates persist per the aggregate contract (PERSISTENCE §4); projections rebuildable from events.
- Tenant isolation enforced and tested; retention/archival rules applied; money stored per VO rules (§6).
- Indexes bounded and justified against query patterns; no N+1 projections.

### 14.6 Infrastructure checklist

- Deployment topology matches BKD §16; secrets in Secrets Manager; backups + PITR verified (PERSISTENCE §14).
- Circuit breakers/fallbacks configured per BKD §14; capacity and SLO dashboards live.

---

## 15. Future Engineering Evolution

How the engineering organization scales without rewriting the system (realizes: BKD §17, SAD §18, AIR §17).

### 15.1 1 → 5 developers

- **One team, full stack.** The 23-module map is maintained by individuals; module ownership is shared but visible in CODEOWNERS.
- Trunk-based flow with strict CI (§8) compensates for lack of reviewers; contract tests keep boundaries honest.
- **No premature extraction:** the modular monolith stays one deployable (BKD §16). Discipline, not process, holds.

### 15.2 5 → 20 developers

- **Feature teams own module clusters** (e.g., People cluster = Identity + HR + Workspaces). Each team owns contracts, events, and its agent(s) end-to-end.
- ADR + architecture-guild review becomes mandatory for cross-module contracts; AI changes get an AI-specialist reviewer.
- Evaluation suites and golden datasets become per-team artifacts with shared infrastructure (AIR §15).
- First extraction candidates appear — identified by the four mechanical criteria (BKD §17.2): team velocity, deployment independence, resource profile, security boundary.

### 15.3 20 → 100 developers

- **Platform guild + product teams.** The platform guild owns the runtime (AI, workflow, plugin, marketplace, policy, identity); product teams build Apps on the SDK.
- **Apps are built by App teams exactly like third-party plugins** (dogfooding, §6.5) — the same SDK, the same validation, the same isolation. This is the organizational mirror of ADR-003.
- Microservice extraction proceeds one service at a time, each with the migration contract (BKD §17.1): extract, dual-run, cut over, decommission — with API/event compatibility preserved throughout.
- Independent AI Runtime and Plugin Runtime teams operate their planes as platforms (BKD §17.4, AIR §17).
- **Developer Platform team** owns the public SDK, marketplace developer portal, and ISV program (SAD §18.5).
- Culture: written decisions (ADRs), readable architecture (docs with IDs), and guardrails over gates (tooling enforces what reviews used to).

**Invariant:** at every scale, the modular monolith can remain one deployable or split on the four criteria — the 23-module map and contract-first discipline make both paths safe (BKD §17.5).

---

## Closing: Engineering Readiness

The Engineering Playbook is ratified as the **Nexora Engineering Constitution**. Every engineer reads §0–2 and their discipline's checklist (§14) before first commit; the quality gates (§13) apply to every change, including AI and plugin changes.

**Readiness assessment:** the specification stack (PRD → PSD → SAD → DDD → AIR → BKD → API → PERSISTENCE → FRONTEND → DESIGN_SYSTEM → this Playbook) defines what to build, how it is architected, how to persist it, how to render it, and how to build it well. Engineering can begin implementation with the modular-monolith v1 topology (BKD §16) once: (1) module skeletons are generated from the 23-module map, (2) contract-test scaffolding exists, (3) the AI eval harness is stood up, and (4) CI quality gates are enforced.

## Implementation Readiness

**Score: 8/10** — all architectural decisions are ratified (ADR registers in SAD, PERSISTENCE, AIR); module boundaries, contracts, and quality gates are specified. The four items needed to reach 9.5 before large-scale build:

1. **Schema design** per aggregate (the next document: DBSCHEMA) — the only remaining un-documented implementation surface.
2. **Sequencing plan** — MVP module build order and milestone dependency graph (from PRD §20 MVP scope).
3. **CI/CD skeleton + tooling choices** (the Playbook prescribes standards, not vendors).
4. **AI eval golden datasets v0.1** for the four MVP agents (HR, Projects, Documents, Knowledge).

## Technical Debt Strategy

- **Debt is registered, not hidden:** a Debt Register (module, description, spec impact, cost, owner, due-by). New debt requires an explicit ADR-lite entry.
- **Bounded by gates:** debt that breaks a quality gate is fixed immediately; debt that degrades a budget is scheduled with a hard date; speculative debt (YAGNI) is not incurred.
- **Contracts protect evolution:** additive-only APIs, versioned events, and contract tests mean most debt is local and repayable without coordination (API_CONTRACTS §12).
- **AI debt is different:** prompt/model drift is AI debt — measured by evaluation suites (§7.4) and repaid by retraining golden sets and re-running evals, not by firefighting.
- **Quarterly debt review:** each quarter, top 5 debt items are resolved or explicitly deferred with owner sign-off.

## Continuous Improvement Strategy

- **Borrowed rituals, sized for scale:** weekly demo + retro; monthly architecture sync; quarterly ADR review and roadmap alignment.
- **Data-driven:** every improvement proposal cites a metric (a budget in §11, an eval gate in §7.4, a metric family in PRD §18).
- **Paved roads over mandates:** engineering improvements ship as internal tooling and checklists (this Playbook's checklists become CI checks), not as memos.
- **AI-eval culture:** agents improve through versioned evaluation, red-team findings, and golden-set evolution — the same rigor applied to human-written code.
- **The Playbook itself evolves by ADR:** changes to engineering standards are proposed, reasoned, ratified, and versioned like any other architecture decision.

---

## Appendix A — Traceability Index

| Playbook section  | Anchored in                                |
| ----------------- | ------------------------------------------ |
| §1 Philosophy     | PRD §1-5, BKD §1                           |
| §2 Principles     | PRN-_, AC-_, SAD §2-3                      |
| §3 Repository     | DDD §2, BKD §2-3, SAD §5                   |
| §4 Coding         | DDD §6, BKD §4-5, API_CONTRACTS §10        |
| §5 AI Engineering | AIR (all), PSD §9, SAD §8                  |
| §6 Plugins        | SAD §7, PSD §7, BKD §10, API_CONTRACTS §6  |
| §7 Testing        | BKD §14, AIR §7.4, PERSISTENCE §13         |
| §8 Git            | SAD §17 (ADR), API_CONTRACTS §12           |
| §9 Documentation  | SAD §17, FRONTEND §2                       |
| §10 Security      | SAD §13, PERSISTENCE §8/§13, AIR §13       |
| §11 Performance   | AC-_, NFR-_, PERSISTENCE §15, FRONTEND §13 |
| §12 Observability | BKD §15, SAD §16, PSD §16, AIR §16         |
| §13 Quality Gates | PRD §20, API_CONTRACTS §12                 |
| §14 Checklists    | All prior documents (per checklist)        |
| §15 Evolution     | BKD §17, SAD §18, AIR §17                  |

_End of the Nexora Engineering Playbook — the Engineering Constitution._
