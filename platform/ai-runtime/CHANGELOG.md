# Changelog

All notable changes to `@nexora/ai-runtime` are documented here.

## 0.1.0 — 2026-08-09

**Enterprise AI Runtime, Phase 1.** First implementation of the orchestration layer.

### Added

- **Orchestrator** (`src/orchestrator`): `EnterpriseAIOrchestrator` implementing the governed pipeline (intent → context → discovery → planning → execution → verification → narration → decision record). Consequential gates block without approval; `autoApprove` is test-only.
- **Planner** (`src/planner`): plan artifact (task graph + gates + authority envelope), `PlannerContext`, `PlanningStrategy` interface, and the deterministic `SequentialPlanner`.
- **Discovery** (`src/discovery`): `CapabilityMatcher` (token-overlap ranking), `CapabilityResolver` (capability → skill → tool), `CapabilityDiscovery` (permission-filtered).
- **Registry** (`src/registry`): `RuntimeRegistry` over canonical `RegistryEntryUnion` entries, `SkillIndex`, `ExecutableToolRegistry`, and `registerPluginAiSurface` (plugin-sdk integration).
- **Execution** (`src/execution`): `ToolExecutor` gatekeeper with `SideEffectGuard`, `RetryPolicy`, `TimeoutPolicy`; unverified results are never reported as done.
- **Verification** (`src/verification`): `ExecutionVerifier`, verification rules, `ConfidenceScore`, pre-execution `SafetyCheck`s.
- **Conversation** (`src/conversation`): sessions, bounded history, `HeadTailSummarizer`, store port + in-memory store.
- **Memory** (`src/memory`): scoped memory contracts (interfaces only, reusing the Agent SDK contracts).
- **Context** (`src/context`): `AIContext` assembly + validation.
- **Prompting** (`src/prompting`): versioned `PromptTemplate`s, strict `TemplateRenderer`, `PromptRegistry`, `SystemPromptBuilder`.
- **Providers** (`src/providers`) + **adapters** (`src/adapters`): chat/embedding/streaming abstractions, `ProviderRegistry`, and OpenAI/Groq/Anthropic/Ollama contract placeholders.
- **Telemetry** (`src/telemetry`): decision-time records (`ExecutionTrace`, `DecisionRecord`, `PromptRecord`, latency, cost) and sinks.
- **Events** (`src/events`): runtime events (`plan.created`, `tool.*`, `response.generated`) + canonical-envelope mapping.
- **Reasoning** (`src/reasoning`): `DecisionRecord`, evidence, and the explainability builder (canonical `ExplanationRecord`).
- **Errors** (`src/errors`): runtime error hierarchy with stable codes.
- **Testing** (`src/testing`): `MockModelProvider`, `MockTool`, `MockToolExecutor`, `FakeConversationStore`, `FakeMemoryProvider`.
- 158 unit tests across 18 test files.
- Documentation: README, ARCHITECTURE, ORCHESTRATION, EXECUTION_PIPELINE, EXTENDING_THE_RUNTIME.

### Notes

- Provider transports are intentionally **not** wired in Phase 1; adapters throw `ProviderError` until Phase 2.
- No vector database; memory is contracts-only.
