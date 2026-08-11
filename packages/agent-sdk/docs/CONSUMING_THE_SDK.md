# Consuming the SDK

How the rest of Nexora depends on `@nexora/agent-sdk` — and how it must **not**.

## Dependency direction

```
domains/ (hr, projects, crm, ...)  ──►  @nexora/agent-sdk  ◄──  platform/ai-runtime
                                                 │
                                                 ▼
                    @nexora/contracts · @nexora/shared · @nexora/config
```

The SDK depends only on the three foundation packages. Domains and the AI Runtime
depend on the SDK. **The SDK never imports a domain or platform module.**

## For domains (building an agent)

1. Implement skills and tools that delegate to the domain's application services via
   injected ports (interfaces defined in the domain's `contracts/`).
2. Extend `BaseAgent` (see [CREATING_AN_AGENT.md](./CREATING_AN_AGENT.md)).
3. Register the agent's capabilities so the Enterprise AI Orchestrator can discover
   it through the Capability Registry (AIR.md §5).
4. Use `agent.events` to emit domain-agnostic agent events; the domain translates
   them into canonical domain events (`@nexora/contracts/events`) for the event bus.

```ts
// domains/hr/src/ai/hr-agent.ts
import { BaseAgent } from '@nexora/agent-sdk/base';
import type { AgentDependencies } from '@nexora/agent-sdk/base';
import { HireEmployeeSkill } from './skills/hire-employee.skill';
import type { HrPort } from '../contracts/hr-port';

export class HrAgent extends BaseAgent<HireInput, HireOutput> {
  constructor(
    deps: AgentDependencies,
    private readonly hr: HrPort,
  ) {
    super(deps);
    this.skills.register(new HireEmployeeSkill(this.hr));
  }
  // ... execute hook
}
```

## For the AI Runtime (platform/ai-runtime)

- **Discovery** — read `AgentManifest` + registered capabilities to build
  `AgentDescriptor`s for the Agent Registry (AIR.md §5).
- **Execution** — call `agent.run(input, executionContext)`; treat the returned
  `ExecutionResult` as the completion contract. Never read agent internals.
- **Approvals** — the agent raises approval needs through `shouldRequireApproval` /
  `requestApproval`; the runtime implements `ApprovalResult` by routing to the
  Approval Engine (AIR.md §12).
- **Policies** — implement `PolicyEvaluator` against the Policy Engine (AIR.md §13)
  and inject it; agents never evaluate policies themselves.
- **Observability** — consume `agent.health()` snapshots and `agent.metrics` through
  the injected `MetricsRecorder` (AIR.md §16).

## Runtime injection checklist

| Interface                        | Implementation (platform) | AIR.md |
| -------------------------------- | ------------------------- | ------ |
| `PlanningStrategy`               | Planner (LLM-backed)      | §6     |
| `PolicyEvaluator`                | Policy Engine             | §13    |
| `KnowledgeProvider`              | Knowledge Runtime         | §9     |
| `MemoryProvider` / `MemoryStore` | Memory Manager            | §8     |
| `MetricsRecorder`                | OpenTelemetry exporter    | §16    |
| `Logger`                         | shared structured logger  | —      |

## Contract

- **Never** import `packages/agent-sdk/src/*` internals; use the subpath exports
  (`@nexora/agent-sdk/base`, `@nexora/agent-sdk/skills`, ...) or the barrel.
- **Never** construct `BaseAgent` directly — always extend it.
- Domain-specific types live in the domain's `contracts/`, never in the SDK.
