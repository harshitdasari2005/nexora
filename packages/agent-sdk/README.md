# @nexora/agent-sdk

The Nexora **Agent SDK** (AIR.md §3) — the canonical, provider-independent SDK for building every AI Agent in Nexora.

Every future agent — HR, Projects, CRM, Finance, Knowledge, Workflow, Inventory, Sales, Procurement — extends `BaseAgent` from this package. The SDK defines the 14-element agent contract (identity, manifest, capabilities, skills, tools, policies, permissions, knowledge, events, memory, lifecycle, health, version, configuration) and the generic execution behavior around it.

**This package contains NO business logic.** It is completely generic and domain-agnostic.

## Design rules

| Rule                             | Why                                                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider-independent**         | The SDK never imports an LLM provider (OpenAI, Anthropic, Gemini, Groq), HTTP, framework, database, or Nexora domain. Planning, reasoning, and execution are contracts + deterministic behavior; providers are injected by the platform. |
| **Reuse canonical contracts**    | All shared vocabulary comes from `@nexora/contracts` (AI contracts, events, errors). Nothing is re-declared.                                                                                                                             |
| **Reuse shared utilities**       | `@nexora/shared` provides `Result`, logging, ids, and time.                                                                                                                                                                              |
| **Composition over inheritance** | Agents are wired from injected dependencies (logger, policy evaluator, metrics recorder) and composed registries (skills, tools, capabilities).                                                                                          |
| **Failures are values**          | Execution returns `ExecutionResult<T>` (`Result`-based); only truly unexpected failures throw.                                                                                                                                           |
| **Human always in control**      | Consequential executions route through the approval hooks before any side effect (AIR.md §12).                                                                                                                                           |

## Package structure

| Module          | Contents                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base/`         | Abstract `BaseAgent`, `AgentConfig`, `AgentDependencies`, manifest validation                                                                                                                  |
| `contexts/`     | Typed execution contexts (tenant, company, workspace, conversation, execution, planning, reasoning, memory, knowledge, policy, approval) + validator                                           |
| `execution/`    | `executePlan` — the deterministic task-graph executor                                                                                                                                          |
| `planning/`     | `ExecutionPlan`, `TaskGraph`, `ExecutionStep`, `PlanningStrategy`, `SequentialPlanningStrategy`                                                                                                |
| `reasoning/`    | `ReasoningRecord`, `DecisionRecord`, `Evidence`, `Confidence`, `AlternativeDecision`; re-exports the canonical `ExplanationRecord`                                                             |
| `memory/`       | Memory interfaces (short/long-term, working, semantic) + `MemoryProvider`, `MemoryStore` — interfaces only                                                                                     |
| `knowledge/`    | `KnowledgeSource`, `KnowledgeProvider`, `RetrievalRequest/Result`, `Citation`                                                                                                                  |
| `tools/`        | `Tool`, `ToolManifest`, `ToolRegistry`, `ToolDescriptor`, `ToolResult`                                                                                                                         |
| `skills/`       | `Skill`, `SkillManifest`, `SkillRegistry`, `SkillInput/Output`                                                                                                                                 |
| `capabilities/` | `Capability`, `CapabilityManifest`, `CapabilityRegistry`, `CapabilityDescriptor`                                                                                                               |
| `policies/`     | `PolicyEvaluationContext`, `PolicyDecision`, `PolicyEvaluation`, `PolicyRequirement`, `PolicyEvaluator`, `evaluatePolicies` (deny-wins)                                                        |
| `approval/`     | `ApprovalRequestBuilder`, `ApprovalMetadata`, `ApprovalResult`                                                                                                                                 |
| `health/`       | `HealthStatus`, `HealthCheck`, `HealthReport`, `HealthSnapshot`, `runHealthChecks`                                                                                                             |
| `metrics/`      | `ExecutionMetrics`, `LatencyMetrics`, `UsageMetrics`, `TokenMetrics`, `CostMetrics`, `MetricsRecorder` + in-memory/no-op recorders                                                             |
| `lifecycle/`    | `LifecycleState` (registered → ready → executing → waiting → paused → disabled → recovering → updating → retired) + state machine                                                              |
| `registry/`     | `AgentRegistry`, `AgentDescriptor`, `AgentMetadata`, `AgentFactory`                                                                                                                            |
| `errors/`       | SDK error hierarchy (`AgentInitializationError`, `AgentExecutionError`, `CapabilityNotFoundError`, `SkillNotFoundError`, `ToolNotFoundError`, `PolicyViolationError`, `ApprovalRequiredError`) |
| `events/`       | `AgentEventBus` + `AgentEvent` union (registered, ready, execution started/completed/failed, health changed, capability added/removed)                                                         |
| `types/`        | SDK-level execution types (`ExecutionFailure`, `ExecutionMetadata`, `ExecutionResult`, `executionOk`/`executionErr`)                                                                           |
| `builders/`     | Fluent builders: `AgentBuilder`, `ManifestBuilder`, `CapabilityBuilder`, `SkillBuilder`, `ToolBuilder`                                                                                         |
| `testing/`      | `MockAgent`, `MockTool`, `MockSkill`, `FakeMemoryProvider`, `fakeExecutionContext`, `testManifest`                                                                                             |

## Quick start

```ts
import { BaseAgent } from '@nexora/agent-sdk/base';
import { fakeExecutionContext } from '@nexora/agent-sdk/testing';
import { ok, type Result } from '@nexora/shared/result';

class GreeterAgent extends BaseAgent<string, string> {
  protected async execute(input: string): Promise<Result<string, ExecutionFailure>> {
    return ok(`Hello, ${input}`);
  }
}

const agent = new GreeterAgent({ manifest: testManifest() });
agent.markReady();
const result = await agent.run('Nexora', fakeExecutionContext());
// { ok: true, output: 'Hello, Nexora' }
```

## Documentation

- [Architecture notes](docs/ARCHITECTURE.md) — how the SDK realizes AIR.md.
- [Creating a new agent](docs/CREATING_AN_AGENT.md) — step-by-step.
- [Extension guide](docs/EXTENSION_GUIDE.md) — skills, tools, planning strategies, providers.
- [Consuming the SDK](docs/CONSUMING_THE_SDK.md) — how domains and the AI Runtime wire agents.

## Quality

- TypeScript strict mode; zero `any`; zero `TODO`; every public export JSDoc-documented.
- 111 unit tests across lifecycle, builders, registries, execution, contexts, planning, policies, approval, health, metrics, events, tools, memory, and errors (`pnpm test`).
- No circular dependencies; no duplicated contracts.
