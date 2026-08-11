# AI Runtime — Architecture

> Work. Orchestrated by AI.

This document describes the internal architecture of `@nexora/ai-runtime` —
the Enterprise AI Runtime that sits between the UI and every business
capability. It realizes the AI Platform responsibilities defined in
`AI_RUNTIME.md` and the orchestration layers defined in `ARCHITECTURE.md`
(§8 AI Runtime Architecture).

---

## 1. Position in the platform

```
User Prompt
     │
     ▼
┌────────────────────────────┐
│   EnterpriseAIOrchestrator │  orchestrator/
└────────────┬───────────────┘
             │ (plan + execute + verify + narrate)
┌────────────▼───────────────┐
│   Planner (Sequential)     │  planner/
└────────────┬───────────────┘
             │ (capability-intent match)
┌────────────▼───────────────┐
│   CapabilityDiscovery      │  discovery/  ──►  registry/ (RuntimeRegistry)
└────────────┬───────────────┘
             │ (resolve to executable tool)
┌────────────▼───────────────┐
│   ToolExecutor             │  execution/  (retry, timeout, side-effect guard)
└────────────┬───────────────┘
             │ (verify result)
┌────────────▼───────────────┐
│   ExecutionVerifier        │  verification/
└────────────┬───────────────┘
             │ (response narration)
┌────────────▼───────────────┐
│   Response + decision      │  reasoning/  +  telemetry/
└────────────────────────────┘
```

The runtime is a **pure orchestration engine**: it never calls business
services directly. Every business action happens through a _discovered,
resolved, executed_ Tool (implemented by agents or plugins via
`@nexora/agent-sdk` / `@nexora/plugin-sdk`).

## 2. Modules and responsibilities

| Module          | Responsibility                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `orchestrator/` | Entry point; runs the full pipeline; owns run status, decision records, traces, narration.                          |
| `planner/`      | Converts user intent into an ordered `ExecutionPlan` (task graph of steps).                                         |
| `discovery/`    | Matches intent to registered capabilities; scores; resolves to tools.                                               |
| `registry/`     | `RuntimeRegistry` — the single capability/skill/tool source of truth; `PluginRegistry` adapts `@nexora/plugin-sdk`. |
| `execution/`    | Executes tools with retry, timeout, side-effect (destructive-action) guarding.                                      |
| `verification/` | Post-execution verification rules, confidence scoring, safety checks.                                               |
| `reasoning/`    | Records the _why_: evidence, alternatives, decisions; explainability-ready.                                         |
| `conversation/` | Sessions, turns, history, summarization seam.                                                                       |
| `memory/`       | Scoped memory contracts (working, conversation, workspace, long-term).                                              |
| `context/`      | Validated tenant/workspace/user/execution/permission context.                                                       |
| `prompting/`    | Templates, registry, renderer, system-prompt builder.                                                               |
| `providers/`    | LLM/embedding abstractions + registry (no vendor code).                                                             |
| `adapters/`     | Vendor adapter _contracts_ (OpenAI, Groq, Anthropic, Ollama) — placeholders.                                        |
| `telemetry/`    | Execution traces, decision/prompt records, token/latency/cost metrics, sinks.                                       |
| `events/`       | Runtime domain events + canonical envelope mapping.                                                                 |
| `errors/`       | Typed error hierarchy.                                                                                              |
| `testing/`      | Mocks, fakes, harness helpers for unit and integration tests.                                                       |

## 3. Layering and dependency rules

```
                    ┌───────────────────────┐
                    │  orchestrator/ (top)  │
                    └───────────┬───────────┘
      ┌────────────┬────────────┼────────────┬────────────┐
      ▼            ▼            ▼            ▼            ▼
 planner/    discovery/   conversation/  reasoning/   telemetry/
      │            │
      ▼            ▼
 execution/   registry/ ◄────── plugin-registry (plugin-sdk seam)
      │            │
      ▼            ▼
 verification/  (skill-index, executable-tools)
      │
      ▼
 context/, memory/, prompting/, providers/, events/, errors/, testing/
```

Rules:

1. **Downward only** — modules may depend on modules listed below them;
   nothing may depend on `orchestrator/`.
2. **No business domains** — the runtime is generic; it depends only on
   `@nexora/contracts`, `@nexora/shared`, `@nexora/config`,
   `@nexora/agent-sdk`, and `@nexora/plugin-sdk`.
3. **No vendor code** — providers are abstractions; adapters are contracts.
4. **Everything observable** — every interesting step produces a telemetry
   record and, where applicable, a runtime event.
5. **No circular dependencies** — enforced by the layering above and
   verified by `pnpm` (and lint rules).

## 4. Key decisions and reasoning

| Decision                                    | Reasoning                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Orchestrator owns the pipeline, not the LLM | The runtime must work even with a stub provider (tests, demos). "AI" here is orchestration, not chat. |
| Capabilities discovered dynamically         | Apps/agents register at runtime; the AI never hardcodes a module (AIR.md §5).                         |
| Execution is always through Tools           | Guarantees auditability, side-effect guarding, retry, and timeout uniformly.                          |
| Deterministic sequential planner first      | Phase-1 scope (AIR.md §6); `PlanningStrategy` leaves room for parallel/LLM planners.                  |
| Providers behind interfaces                 | OpenAI/Groq/etc. become drop-in adapters; no runtime change required (AIR.md §17 multi-LLM).          |
| Reasoning records are first-class           | Explainability (AIR.md §14) is a product requirement, not a log afterthought.                         |
| Memory is interfaces only                   | Vector stores are a later phase; the contracts already support them.                                  |

## 4a. Tenant scoping assumption

Discovery filters candidates by the run's **permission context** (`allowedActions`),
not by tenant id. Tenant isolation is therefore achieved by **instantiating a
`RuntimeRegistry` (and its skill/tool indexes) per tenant** at the platform
boundary (PERSISTENCE.md §8 tenant isolation). A shared registry across tenants
would require adding tenant scoping to discovery — a Phase 2 concern, tracked
as a known assumption, not silently relied upon.

## 5. Failure containment

- Planner failures → `PlanningError` → run ends `failed` (no tools executed).
- Discovery failures → `DiscoveryError` → clarifying response.
- Tool failures → `ExecutionError` → retried per `RetryPolicy`, then failed step.
- Verification failures → `VerificationError` → step marked failed, decision recorded.
- Provider failures → `ProviderError` (used by future adapters; already typed).
- A failing tool never crashes the orchestrator: the run completes with a
  `failed` status and a narrated explanation.
