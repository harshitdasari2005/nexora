# Changelog

All notable changes to `@nexora/agent-sdk` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`0.1.0` foundation** — canonical, provider-independent Agent SDK (AIR.md §3):
  - Abstract `BaseAgent` with lifecycle gating, approval hooks, policy hooks, health checks, metrics recording, and event publishing.
  - Typed execution contexts (tenant, company, workspace, conversation, execution, planning, reasoning, memory, knowledge, policy, approval) with validation.
  - Planning abstractions (`ExecutionPlan`, `TaskGraph`, `PlanningStrategy`, `SequentialPlanningStrategy`) and the deterministic `executePlan` task-graph runtime.
  - Reasoning contracts (`ReasoningRecord`, `DecisionRecord`, `Evidence`, `Confidence`, `AlternativeDecision`) re-exporting the canonical `ExplanationRecord`.
  - Memory and knowledge interfaces (short/long-term, working, semantic; providers, retrieval, citations).
  - Tool, skill, and capability manifests and registries with fluent builders (`AgentBuilder`, `ManifestBuilder`, `CapabilityBuilder`, `SkillBuilder`, `ToolBuilder`).
  - Deny-wins policy evaluation and the approval request builder.
  - Health checks and metrics recording (execution, latency, usage, tokens, cost) with in-memory and no-op recorders.
  - Agent lifecycle state machine (registered → ready → executing → waiting → paused → disabled → recovering → updating → retired).
  - Agent registry (`AgentDescriptor`, `AgentMetadata`, `AgentFactory`), SDK error hierarchy, and the typed `AgentEventBus`.
  - Testing support (`MockAgent`, `MockTool`, `MockSkill`, `FakeMemoryProvider`, `fakeExecutionContext`, `testManifest`).
  - strict TypeScript; zero `any`; zero `TODO`; every public export documented.

### Changed

- **Execution pipeline hardened** (review pass):
  - `BaseAgent.run` now enforces, in order: context validation → readiness → concurrency → **policy gate** (deny-wins, `POLICY_VIOLATION`) → approval gate → work.
  - `AgentConfig` is now injectable (`AgentDependencies.config`) and **enforced**: `timeoutMs` (timeout race, `TIMEOUT` failure), `maxAttempts` (retry on transient thrown failures only; typed failures never retry), `memoryEnabled`/`knowledgeEnabled` (provider gating). Unenforced `maxSteps` removed.
  - **Concurrency guard**: a synchronous `#busy` flag is claimed before the first await, eliminating the TOCTOU race on concurrent `run()` calls.
  - SDK `ExecutionMetadata` renamed to `ExecutionResultMetadata` to avoid collision with the canonical `@nexora/contracts/ai` `ExecutionMetadata` (per-tool/skill execution record).
  - `AgentEventBus` history is now bounded (default 1000 events, oldest dropped).
  - `AgentExecutionTimeoutError` added (extends the shared `TimeoutError`, canonical `TIMEOUT` code) for the timeout path.
  - **Second review pass**: timeouts are never retried (in-flight work may still run — no duplicate side effects); exceptions escaping the policy/approval gates are converted to `INTERNAL_ERROR` failures (`run` never throws); the manifest's `policyIds` now feed the policy gate as requirements. 123 unit tests.
