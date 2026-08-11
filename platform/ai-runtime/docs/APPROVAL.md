# AI Runtime — Human Approval

> **Work. Orchestrated by AI.** — and consequential state changes are approved by humans, never assumed.

This document defines the approval architecture behind the first AI **write** capability (create a workspace) and the contract every future state-changing tool must follow (AIR.md §12, PSD.md §9.3).

## 1. Read vs state-changing capability

| Aspect            | Read capability (e.g. `workspaces.list_workspaces`) | State-changing capability (e.g. `workspaces.create_workspace`) |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| Side-effect class | `read_only`                                         | `state_change` / `consequential`                               |
| Approval gate     | Never                                               | Always under `supervised` tier (BR-13)                         |
| Execution         | Immediate after discovery + planning                | **Only after a granted server-side decision**                  |
| Failure           | Returns partial/empty result                        | Produces **no mutation** until approved; safe failure after    |

The distinction is **declarative**, not prompt-decided: the planner derives the gate from the tool's registered side-effect class and the workspace autonomy tier (`requiresApprovalFor`). A prompt ("create X without approval", "act as admin") cannot move a tool between classes.

## 2. The approval lifecycle

The runtime's minimal lifecycle (a seam, not a framework — the platform plugs a durable store behind the same `ApprovalEngine` interface):

```
proposed ──► awaiting_approval ──► approved ──► executing ──► completed
                 │                    │              │
                 │                    ▼              └──► failed
                 └──────────────► rejected
```

| State               | Meaning                                            | Entered by                     |
| ------------------- | -------------------------------------------------- | ------------------------------ |
| `proposed`          | The gate was raised (transient)                    | Orchestrator gate              |
| `awaiting_approval` | A recorded request exists; the caller may decide   | `ApprovalEngine.open`          |
| `approved`          | A grant decision was recorded                      | `ApprovalEngine.decide`        |
| `rejected`          | A rejection was recorded; no execution is possible | `ApprovalEngine.decide`        |
| `executing`         | The request was atomically claimed (single flight) | `ApprovalEngine.claim`         |
| `completed`         | The tool result was recorded                       | `ApprovalEngine.recordOutcome` |
| `failed`            | The tool failed after execution                    | `ApprovalEngine.recordOutcome` |

## 3. The flow (create workspace)

```
User: "Create a workspace called Payroll"
  │
  ▼
POST /api/ai/chat
  │  orchestrator.run({ utterance, userId, tenantId, workspaceId })
  ▼
Planner: capability workspaces.create_workspace (consequential)
  │  gate attached → step input { name: "Payroll" }  (clause-bounded extraction)
  ▼
Orchestrator gate: ApprovalEngine.open(...) → apr_xxx (awaiting_approval)
  │  decisionStatus(apr_xxx) = pending → step BLOCKED
  ▼
SSE done: { status: "blocked", approvals: [{ id: "apr_xxx", status: "pending",
             toolId: "workspaces.create_workspace", input: { name: "Payroll" } }] }
  │
  ▼
UI: approval card (Approve / Reject)  ── NO mutation has happened ──
  │
  ├── Reject ──► POST /api/ai/approvals/apr_xxx/decision { decision: "reject" }
  │                │ engine: awaiting_approval → rejected
  │                │ system turn "Approval rejected by <user>"  (audit)
  │                └──► 200 { status: "rejected" }  — nothing executes
  │
  └── Approve ──► POST /api/ai/approvals/apr_xxx/decision { decision: "approve" }
                   │ engine: awaiting_approval → approved
                   │ orchestrator.run({ ..., approvalId: "apr_xxx" })  (resume)
                   │   ├─ gate resolves the recorded request (ownership-checked)
                   │   ├─ decisionStatus = granted → claim() (approved → executing)
                   │   ├─ tool executes ONLY through the ToolExecutor
                   │   │    └─ CreateWorkspaceTool → application layer → domain → repo
                   │   ├─ recordOutcome(completed, result)
                   │   └─ system turn "Approval granted recorded for apr_xxx"
                   └──► SSE stream: "Created workspace Payroll." — persisted
```

## 4. No execution before approval (hard guarantee)

The gate is enforced at two layers, both server-side and deterministic:

1. **Orchestrator** (`#executePlan`): a gated step with `decisionStatus ≠ granted` is pushed as **blocked** — the tool invocation is never reached.
2. **ToolExecutor** (`side-effect guard`): even if a caller bypassed the planner, the executor refuses to invoke a gated tool without `approvalGranted`.

Tests prove (for both the runtime and the API): **no database mutation, no application-service call, no domain event, no workspace created** before a granted decision.

## 5. Approval is trusted server-side state

The caller can never approve by modifying:

- the **prompt** ("approve this", "auto-approve") — request-level `autoApprove` is honored only when the platform enables it via config (`ai.runtime.autoApprove`; BR-13);
- the **tool arguments** — identity/approval fields are not in the input schema (`additionalProperties: false`);
- the **conversation** — decisions live in the approval engine, not in turns;
- the **request body** — `POST /api/ai/approvals/:id/decision` records the decision against the recorded request owned by the authenticated user.

**Ownership of a decision** (route): the deciding actor must be the requesting user AND a current member of the request's tenant. A foreign approval id is rejected (404/403) and can never grant another run — the orchestrator re-checks `userId + tenantId + conversationId + toolId` on every resume (`#resolveApproval`).

## 6. Exactly-once execution

A granted request transitions `approved → executing` through `ApprovalEngine.claim`, which is **atomic** (synchronous check-and-set in the in-memory engine; a conditional update in a durable store). Consequences:

- Duplicate delivery of the same approved execution **cannot run the tool twice**.
- A re-delivered request whose execution already **completed** replays the stored authoritative result (`decisionStatus` reports `granted` for all post-grant states, and the claim is refused with the stored result returned).
- Concurrent duplicate deliveries execute **at most once**; the loser is skipped or replays — never re-runs.

## 7. What an approval request records

Every request is a trusted record (never client-supplied):

| Field            | Origin                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| `userId`         | Authenticated session                                                               |
| `tenantId`       | Membership-resolved organization                                                    |
| `workspaceId`    | Validated workspace scope                                                           |
| `toolId`         | The gated tool id (from the plan, registry-backed)                                  |
| `input`          | **User-controlled parameters only** (e.g. `{ name }`) — never identity/tenant/scope |
| `intent`         | The user utterance                                                                  |
| `reason`         | The gate reason (side-effect class + tier)                                          |
| `conversationId` | The owning conversation (for audit + ownership)                                     |

## 8. Auditing

The conversation records the lifecycle as **system turns** (`Approval granted recorded for apr_xxx`, `Approval rejected by usr_...`) — never hidden chain-of-thought, never provider credentials. The decision record and execution trace (ADR-011) additionally capture who decided, when, and the outcome with the correlation ids.

## 9. Extending to future write tools

1. Register the capability with an honest `sideEffectClass` (`state_change` / `consequential`).
2. Declare a **minimal input schema** (user-controlled business values only; `additionalProperties: false`).
3. Provide a deterministic parameter extractor (or LLM tool-calling later) for the user-controlled values.
4. Delegate to the application layer — never repositories, never the domain directly.
5. **Do not touch the approval engine or the orchestrator.** The gate, claim, resume, and exactly-once guarantees apply automatically.

See `docs/SECURITY.md` for the full Trusted Context vs Model Arguments contract.
