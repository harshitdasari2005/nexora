# AI Runtime — Extending the Runtime

The runtime is designed so that every future module (Projects, HR, CRM,
Finance, Documents, Knowledge, Workflows) integrates **without modifying the
runtime**. This guide explains the extension points.

## 1. Registering an agent's capabilities

Use `RuntimeRegistry.registerAgent(agent, context)`:

```ts
import { RuntimeRegistry, type RuntimeRegistryContext } from '@nexora/ai-runtime';
import { MyAgent } from './my-agent'; // extends BaseAgent from @nexora/agent-sdk

const registry = new RuntimeRegistry();
await registry.registerAgent(new MyAgent(), { tenantId, workspaceId });
```

The registry ingests the agent's **capabilities**, **skills**, and **tools**
from its manifest — no runtime change needed. The AI discovers them on the
next run.

## 2. Registering a plugin

Plugins built with `@nexora/plugin-sdk` expose contributions. The runtime
adapts them via `PluginRegistry`:

```ts
import { PluginRegistry } from '@nexora/ai-runtime';

const pluginRegistry = new PluginRegistry();
await pluginRegistry.registerPlugin(plugin, context);
// agent/skill/tool contributions are indexed into RuntimeRegistry
```

Re-registration is idempotent: capabilities are keyed by
`agentId:capabilityId` and skill/tool dedupe by `agentId:name`.

## 3. Adding a chat provider

Implement the `ChatProvider` contract and register it:

```ts
import { ChatProvider, ProviderRegistry } from '@nexora/ai-runtime';

class MyLLM implements ChatProvider {
  readonly id = 'my-llm';
  async chat(request) {
    /* ... */
  }
}

const providers = new ProviderRegistry();
providers.register(new MyLLM());
```

The provider abstractions (`ChatProvider`, `EmbeddingProvider`,
`StreamingProvider`, `ModelProvider`) are the only seam the orchestrator uses
for generation — the runtime never imports a vendor SDK. See
`src/adapters/*` for the placeholder contracts (OpenAI, Groq, Anthropic,
Ollama) to fill in.

## 4. Replacing the planner

Implement `PlanningStrategy` and construct the orchestrator with it:

```ts
import { PlanningStrategy, SequentialPlanner } from '@nexora/ai-runtime';

class ParallelPlanner implements PlanningStrategy {
  /* ... */
}

const orchestrator = new EnterpriseAIOrchestrator({ planner: new ParallelPlanner() /* ... */ });
```

## 5. Adding verification rules

```ts
import { VerificationRule, VerificationContext } from '@nexora/ai-runtime';

const noEmptyResult: VerificationRule = {
  id: 'result-not-empty',
  check: async (step, result, ctx) =>
    result.ok && result.value !== undefined
      ? { passed: true }
      : { passed: false, issues: [{ code: 'EMPTY_RESULT', message: '...' }] },
};
```

Register rules via the orchestrator options (`verificationRules`).

## 6. Adding memory providers

`MemoryProvider` / `MemoryStore` are interfaces only. A vector-backed
implementation can be provided later without touching the runtime:

```ts
import type { MemoryProvider, MemorySnapshot } from '@nexora/ai-runtime';

class VectorMemory implements MemoryProvider {
  async save(snapshot: MemorySnapshot): Promise<void> { /* ... */ }
  async recall(...) { /* ... */ }
}
```

## 7. Subscribing to runtime events

Runtime events (`PlanCreated`, `PlanExecuted`, `ToolInvoked`,
`ToolSucceeded`, `ToolFailed`, `ResponseGenerated`) can be forwarded to the
platform event bus using `toEventEnvelope` — see `src/events/`.

## 8. What you must never do

- ❌ Import a business domain into the runtime.
- ❌ Call an agent/tool that was not registered and discovered.
- ❌ Bypass `ToolExecutor` (retry/timeout/side-effect guarantees).
- ❌ Embed a vendor LLM SDK call outside an adapter.
