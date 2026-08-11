# AI Runtime — Orchestration

This document specifies how `EnterpriseAIOrchestrator` turns a user prompt
into an executed, verified, explainable run.

## 1. Request lifecycle

```
createRun(prompt, context)
        │
        ▼
load session + history ────────────► conversation/
        │
        ▼
discover capabilities ─────────────► discovery/ + registry/
        │
        ▼
plan(prompt, capabilities) ─────────► planner/
        │                          (SequentialPlanner)
        ▼
for each step:
   resolve capability ─────────────► discovery/ (resolver)
   execute tool ───────────────────► execution/ (ToolExecutor)
   verify result ──────────────────► verification/ (ExecutionVerifier)
        │
        ▼
collect results ───────────────────► reasoning/ (evidence)
        │
        ▼
narrate response ──────────────────► orchestrator/narration
        │
        ▼
record decision + trace ───────────► reasoning/ + telemetry/
        │
        ▼
emit ResponseGenerated ────────────► events/
```

## 2. Run status model

| Status              | Meaning                                        |
| ------------------- | ---------------------------------------------- |
| `planned`           | Plan produced; nothing executed.               |
| `running`           | At least one step executing.                   |
| `awaiting_approval` | A step requires human approval (paused).       |
| `completed`         | All steps succeeded and verified.              |
| `failed`            | A step failed permanently or planning failed.  |
| `partial`           | Some steps succeeded, then a failure occurred. |
| `cancelled`         | Run cancelled by the caller.                   |

## 3. What the orchestrator never does

- ❌ Never calls a business service / domain directly.
- ❌ Never executes a tool it did not discover and resolve.
- ❌ Never skips the side-effect guard for destructive actions.
- ❌ Never invents capabilities — unmatched intent produces a **clarifying**
  response, never a fabricated action.

## 4. Decisions recorded per run (explainability)

`DecisionRecord` captures (AIR.md §14):

- intent and confidence
- planning narrative
- every capability/tool used with evidence
- policies consulted
- approvals required/obtained
- verification results
- final outcome and confidence
- the full `ExecutionTrace` (ordered events + timing)

## 5. Conversation integration

- `ConversationManager` loads the session, appends the user turn, and stores
  the assistant response after the run.
- A `ConversationSummarizer` seam exists so long sessions can be compacted
  before they exceed provider limits; no summarizer ships in Phase 1.

## 6. Concurrency and isolation

- Every run is isolated: `createRun` takes an explicit `OrchestrationRequest`
  carrying tenant/workspace/user; the registry lookups are scoped to that
  context.
- The orchestrator is stateless between runs; all state lives in the run
  object and the conversation store.
