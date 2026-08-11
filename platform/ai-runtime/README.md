# @nexora/ai-runtime

**The Enterprise AI Runtime** — the orchestration layer between the Nexora UI and every business capability (AIR.md). This is **not an LLM wrapper**: it is the governed pipeline — intent → context → capability discovery → planning → tool execution → verification → response — that every AI interaction in Nexora traverses.

> Work. Orchestrated by AI.

## What it is

- **Provider-independent.** No OpenAI/Groq/Anthropic/Ollama SDK is imported. Model providers implement the contracts in `src/providers` and are injected through the `ProviderRegistry` (ADR-008). The four vendor adapters are contract placeholders in `src/adapters` — they fail loudly with `ProviderError` until a transport is wired (Phase 2).
- **Domain-free.** The runtime depends only on `@nexora/contracts`, `@nexora/shared`, `@nexora/config`, `@nexora/agent-sdk`, and `@nexora/plugin-sdk`. It contains **zero business logic** — it orchestrates _discovered_ capabilities; it never hardcodes an application (AIR.md §5.3, SAD.md §10).
- **Deterministic orchestration, stochastic generation.** Planning, discovery, and execution are deterministic and auditable; only generation (narration) is stochastic and optional.

## Modules

| Module         | Responsibility                                                                                 | Reference            |
| -------------- | ---------------------------------------------------------------------------------------------- | -------------------- |
| `orchestrator` | **Enterprise AI Orchestrator** — the single coordinator: conversation, plan, outcome narrative | AIR.md §2            |
| `planner`      | Intent → validated execution plan over registered capabilities                                 | AIR.md §6            |
| `discovery`    | Capability matching + resolution (permission-filtered, never hardcoded)                        | AIR.md §5            |
| `registry`     | Platform capability registry read-model + plugin AI-surface registration                       | SAD.md §10           |
| `execution`    | Tool executor gatekeeper: validate → guard → invoke → retry → timeout → verify                 | AIR.md §10           |
| `verification` | Reasoner: verification rules, results, safety checks                                           | AIR.md §7 stage 8    |
| `conversation` | Sessions, bounded history, summarization                                                       | AIR.md §1.2 R13      |
| `memory`       | Scoped memory contracts (interfaces only; no vector store in Phase 1)                          | AIR.md §8            |
| `context`      | Minimal, permission-filtered context assembly                                                  | AIR.md §1.2 R5       |
| `prompting`    | Versioned prompt templates, strict rendering, system-prompt builder                            | AIR.md §1.2 R14      |
| `providers`    | Chat/embedding/streaming provider abstractions + registry                                      | ADR-008              |
| `adapters`     | Vendor adapter placeholders (OpenAI, Groq, Anthropic, Ollama)                                  | ADR-008              |
| `telemetry`    | Decision-time records + sinks (trace, decision, prompt, latency, cost)                         | AIR.md §16           |
| `events`       | Runtime events + canonical-envelope mapping                                                    | SAD.md §11           |
| `reasoning`    | Decision records, evidence, explainability builder                                             | AIR.md §14           |
| `approval`     | Human-approval lifecycle: requests, decisions, single-flight claim (first AI write)            | AIR.md §12           |
| `errors`       | Runtime error hierarchy (stable codes)                                                         | API_CONTRACTS.md §10 |

## The pipeline

```
User prompt
  → Enterprise AI Orchestrator
  → context assembly (permission-filtered)
  → capability discovery (registry, never hardcoded)
  → planner (task graph + approval gates)
  → tool execution (only through the ToolExecutor)
  → result verification (Reasoner)
  → response generation (deterministic; optional provider narration)
  → decision-time records (ADR-011)
```

## Quick start

```ts
import { EnterpriseAIOrchestrator } from '@nexora/ai-runtime/orchestrator';
import { CapabilityDiscovery } from '@nexora/ai-runtime/discovery';
import { ToolExecutor } from '@nexora/ai-runtime/execution';
import { ConversationManager, InMemoryConversationStore } from '@nexora/ai-runtime/conversation';
import { RuntimeRegistry, SkillIndex, ExecutableToolRegistry } from '@nexora/ai-runtime/registry';

const registry = new RuntimeRegistry();
const skills = new SkillIndex();
const tools = new ExecutableToolRegistry();
// … register capabilities/skills/tools (from plugins, agents, or tests) …

const orchestrator = new EnterpriseAIOrchestrator({
  discovery: new CapabilityDiscovery(registry, skills),
  executor: new ToolExecutor({ tools }),
  conversations: new ConversationManager(new InMemoryConversationStore()),
});

const response = await orchestrator.run({
  utterance: 'Search projects for mobile banking',
  userId: 'user_1',
  tenantId: 'tenant_1',
  workspaceId: 'ws_1',
});
// response.status: 'completed' | 'clarification' | 'blocked' | 'failed'
```

## Installing a plugin's AI surface

Plugins (via `@nexora/plugin-sdk`) register agents, skills, tools, and capabilities into the runtime with `registerPluginAiSurface` — the registry is the _only_ place the orchestrator learns about new capabilities (AIR.md §5):

```ts
import { registerPluginAiSurface } from '@nexora/ai-runtime/registry';
import type { AgentManifest } from '@nexora/contracts/ai';

await registerPluginAiSurface({
  manifest: pluginManifest, // @nexora/contracts/plugin PluginManifest
  registry,
  skills,
  tools,
  capabilities: [
    {
      id: 'projects.create_project',
      name: 'Create project',
      description: '…',
      skillId: 'projects.create',
      sideEffectClass: 'state_change',
    },
  ],
  toolContributions: [{ kind: 'tool', id: 'tool_create_project', tool: myTool }],
  agentContributions: [{ kind: 'agent', id: 'agt_projects', agent: () => myAgent }],
});
```

## Human control

Consequential actions are always gated (BR-13): the `SequentialPlanner` attaches an approval gate from the tool's side-effect class and the workspace autonomy tier; the `ToolExecutor` refuses to invoke a gated tool without granted approval. With an `ApprovalEngine` wired (the platform does), gates are **real**: a state-changing step opens a recorded approval request and executes **only after a granted server-side decision**. The orchestrator reports blocked steps and pending approvals — never auto-executes them (request-level `autoApprove` is honored only when the platform enables it via `ai.runtime.autoApprove`; a caller can never self-grant).

- **Lifecycle:** `proposed → awaiting_approval → approved/rejected → executing → completed/failed` (`src/approval`).
- **Exactly-once:** `ApprovalEngine.claim` is the single-flight guard — duplicate delivery of the same approved execution never runs the tool twice; completed requests replay their stored result.
- **Read vs write:** read capabilities (`read_only`) execute immediately; state-changing capabilities gate, then execute through the same tool pipeline.

See `docs/APPROVAL.md` for the full lifecycle, the decision endpoint contract, and how future write tools plug in.

## Design notes

- **Unverified ≠ done.** The verifier runs rules deny-wins; a result that fails verification is reported as unverified, never silently accepted (AI-6, TLR-3).
- **Thrown failures retry only for idempotent tools.** Non-idempotent tools never auto-retry — they surface to human decision (FR-13).
- **Decision-time records only.** Every trace, decision, and event is recorded as it happens (ADR-011); observability timelines are rendered from these records.

## Development

```bash
pnpm --filter @nexora/ai-runtime build
pnpm --filter @nexora/ai-runtime typecheck
pnpm --filter @nexora/ai-runtime lint
pnpm --filter @nexora/ai-runtime test
```

See `docs/ARCHITECTURE.md` for the component design, `docs/ORCHESTRATION.md` for the orchestrator, `docs/EXECUTION_PIPELINE.md` for the pipeline, `docs/SECURITY.md` for the **security contract (Trusted Context vs Model Arguments)**, `docs/APPROVAL.md` for the **human-approval contract (read vs state-changing)**, and `docs/EXTENDING_THE_RUNTIME.md` for how domains, plugins, and agents extend the runtime.
