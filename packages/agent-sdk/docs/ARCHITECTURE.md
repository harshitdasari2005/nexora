# Agent SDK — Architecture Notes

How `@nexora/agent-sdk` realizes the AI Runtime specification (AIR.md).

## 1. The agent contract (AIR.md §3)

Every agent — regardless of domain — implements the same 14-element contract:

| Element       | SDK surface                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| Identity      | `manifest.identity` (canonical `AgentIdentity` from `@nexora/contracts/ai`) |
| Manifest      | `AgentManifest` (canonical)                                                 |
| Capabilities  | `CapabilityRegistry`                                                        |
| Skills        | `SkillRegistry`                                                             |
| Tools         | `ToolRegistry`                                                              |
| Policies      | injected `PolicyEvaluator` + `checkPolicy` hook                             |
| Permissions   | declared via manifest `policyIds`; enforced by the platform Policy Engine   |
| Knowledge     | `KnowledgeProvider` interface (injected)                                    |
| Events        | `AgentEventBus` (typed `AgentEvent` union)                                  |
| Memory        | `MemoryProvider` / `MemoryStore` interfaces (injected)                      |
| Lifecycle     | `LifecycleStateMachine`                                                     |
| Health        | `registerHealthCheck` + `health()`                                          |
| Version       | `manifest.version` (SemVer)                                                 |
| Configuration | `AgentConfig` + optional `ConfigManager` from `@nexora/config`              |

**Why a single contract:** the Enterprise AI Orchestrator must discover, inspect, and
execute _any_ agent through one uniform surface (AIR.md §5). Capability discovery,
the agent registry, health monitoring, and the AI Studio all rely on this
uniformity.

## 2. Execution pipeline (`BaseAgent.run`)

```
run(input, context)
  ├─ validateExecutionContext      → VALIDATION_ERROR (failures are values)
  ├─ readiness gate                → AGENT_NOT_READY
  ├─ lifecycle gate                → AGENT_BUSY
  ├─ shouldRequireApproval()       → approval hook (AIR.md §12)
  │    └─ requestApproval()        → APPROVAL_REJECTED on denial
  ├─ lifecycle → executing
  ├─ publish execution.started
  ├─ execute(input, context)       → the only abstract hook
  ├─ publish execution.completed | execution.failed
  ├─ lifecycle → ready (reusable)
  └─ metrics recorded throughout (execution, latency, usage)
```

Design decisions:

- **Failures are values.** `run` returns an `ExecutionResult<TOutput>`; thrown errors
  are converted to `INTERNAL_ERROR` failures (with logging) and the agent returns to
  a stable state. Domains never manage try/catch around agents.
- **Human always in control.** Approval is _checked before_ the lifecycle enters
  `executing`, so no side effect can occur before a decision.
- **Reusable by design.** After every execution the agent returns to `ready`, so a
  single agent instance serves many conversations (session-less runtime).

## 3. Deterministic orchestration

- `SequentialPlanningStrategy` converts ordered `(skillId, input)` pairs into a
  `TaskGraph` with dependency edges.
- `executePlan` executes the graph **deterministically**: it validates steps, resolves
  each skill from the registry, runs in dependency order, and fails fast — a failed or
  missing step stops downstream steps. No hidden parallelism in the SDK; parallel
  execution is a strategy concern (AIR.md §11).

## 4. Provider independence

The SDK has **zero runtime coupling** to any LLM provider. The seams:

- **Planning** — `PlanningStrategy` interface; the platform injects an LLM-backed
  planner; rule-based strategies (e.g. `SequentialPlanningStrategy`) ship in the SDK.
- **Policies** — `PolicyEvaluator` interface; the platform Policy Engine implements it.
- **Knowledge** — `KnowledgeProvider`; the platform Knowledge Runtime implements it.
- **Memory** — `MemoryProvider`/`MemoryStore`; the platform Memory Manager implements them.
- **Metrics** — `MetricsRecorder`; the platform plugs in OpenTelemetry or similar.

## 5. Dependencies

`@nexora/contracts` (canonical vocabulary), `@nexora/shared` (Result, logger, ids,
time, errors), `@nexora/config` (typed configuration). Nothing else. Domains,
platform modules, databases, HTTP, and frameworks are never imported.
