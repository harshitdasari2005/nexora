# Governed Business Execution

Canonical description of how a business action becomes a real change in Nexora,
and how anyone can later prove what happened (Prompt 9). It states what the
code does today, including the limits. Companion documents: `TRUST_MODEL.md`
(§13 holds the invariants), `APPROVAL.md` (approval mechanics), `SECURITY.md`
(finding ledger), `EXECUTION_PIPELINE.md`.

**Principle.** The AI proposes. Policy allows or denies. Approval authorizes
_only_ what was requested and approved. Execution does only what the backend
authorizes. Verification proves what happened. Lineage explains. Audit
preserves. No step trusts a model, a prompt, a tool argument, a request body
field or a UI claim as authority.

Nothing here adds a framework: every control extends an existing seam
(`ToolExecutor`, `ApprovalEngine`, `PolicyPort`, lineage, runtime observability,
Audit Center).

## 1. The lifecycle

```
REQUEST -> AUTHENTICATION -> SCOPE -> CAPABILITY -> AGENT AUTHORITY -> POLICY
   -> APPROVAL -> APPROVED ARGUMENTS -> EXECUTION -> VERIFICATION
   -> LINEAGE -> AUDIT -> RESPONSE

 AI (advisory)            deterministic backend (authoritative)
 ┌──────────┐   proposes  ┌────────────────────────────────────────────────────┐
 │ planner  │ ──────────► │ authn → scope → RBAC ceiling → agent delegation    │
 │ narrator │             │   → argument guard → policy → approval gate        │
 └──────────┘             │   → exact-argument binding → single-flight claim   │
      ▲                   │   → application service → read-back verification   │
      │ narrates only     │   → append-only lineage → audit / telemetry        │
      └───────────────────┴────────────────────────────────────────────────────┘
```

A failure at any step stops the run: the steps after it never happen, nothing is
mutated by the failed step, and the refusal is audited with a stable reason code.

### 1.1 Step table

"Deterministic" means enforced by backend code from trusted server state; the
model, the prompt and the client cannot influence it. "Advisory" means the AI
proposes and nothing depends on it being right.

| #   | Step               | Control                                                                                                                                                                                                   | Enforced in                                                                                                                                          | Kind                                               | On failure                                                                                                           |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Request            | Utterance is untrusted text. Planner picks capability + user-controlled arguments; the model never defines who acts or where.                                                                             | `platform/ai-runtime` planner, `routes/ai.ts`                                                                                                        | Advisory (AI proposes only)                        | An unusable plan yields a clarification, never an action.                                                            |
| 2   | Authentication     | Session principal from the verified token; identity is never read from body, prompt or arguments.                                                                                                         | `apps/api/src/plugins/auth.ts` (`requireAuth`)                                                                                                       | Deterministic                                      | 401.                                                                                                                 |
| 3   | Scope              | Tenant and workspace resolved from membership (organization + workspace lists), never client claims; foreign or forged ids resolve to 403/404.                                                            | Routes (`routes/ai.ts`, `remediation.ts`, `workflows.ts`); `resolveTrustedScope`                                                                     | Deterministic                                      | 403 `AUTHORIZATION_ERROR` or a plain 404 (no existence leak).                                                        |
| 4   | Capability         | RBAC ceiling: the requester's executable capabilities (`allowedCapabilityIds`). An ABSENT ceiling is explicitly unrestricted (trusted internal callers only); an EMPTY ceiling is no authority (see §9a). | `platform/ai-runtime/src/execution/tool-executor.ts`, `business-context/permissions.ts`                                                              | Deterministic                                      | `CAPABILITY_NOT_PERMITTED` (audited, `ai.security.blocked`).                                                         |
| 5   | Agent authority    | For agent runs: agent active + in scope, capability inside the agent definition, an active unexpired delegation whose grantor still holds it, initiator holds it too.                                     | `apps/api/src/agent/agent-authority.ts`, executor delegation check, `routes/ai.ts` resume ceiling                                                    | Deterministic                                      | `AGENT_*`, `DELEGATION_*`, `CAPABILITY_OUTSIDE_*` reason codes; step fails.                                          |
| 5a  | Argument guard     | Reserved/forged scope, identity and agent keys are rejected at any inspected depth; nesting deeper than `MAX_ARGUMENT_DEPTH` (6) is refused (fail closed); schema check.                                  | `platform/ai-runtime/src/execution/argument-guard.ts` (`checkArgumentTrust`); MCP also screens before tool resolution (`ai/mcp/build-server.ts`)     | Deterministic                                      | `RESERVED_ARGUMENT`, `FORGED_AGENT_CONTEXT`, `ARGUMENT_TOO_DEEP`, `INVALID_ARGUMENTS`; not executed.                 |
| 6   | Policy             | Central `PolicyPort`: ALLOW / DENY / REQUIRE_APPROVAL over trusted facts. DENY is final and never approvable.                                                                                             | `platform/policy` (pure), `apps/api/src/policy/api-policy-port.ts`, executor; REST via `enforceRestPolicy`                                           | Deterministic                                      | DENY: `POLICY_DENIED` (no approval ever opened). Engine error: `POLICY_UNAVAILABLE` (fail closed, HTTP 503).         |
| 7   | Approval           | Consequential/state-changing steps (and any REQUIRE_APPROVAL) open a recorded approval; only a granted server-side decision by an authorized decider lets it proceed.                                     | `platform/ai-runtime/src/approval/engine.ts`, `apps/api/src/ai/pg-approval-engine.ts`, `ai/approval-authorization.ts`, `routes/ai.ts` decision route | Deterministic                                      | Pending: run `blocked`. Rejected/expired: terminal, nothing executes. Wrong role/self-approval: 403, audited.        |
| 8   | Approved arguments | A resumed run may execute only arguments canonically equal to the stored approval input; the named approval must be consumed by exactly one bound step (§5).                                              | `platform/ai-runtime/src/orchestrator/orchestrator.ts` (`stableJson` comparison, `#unboundFailure`)                                                  | Deterministic                                      | `APPROVAL_ARGUMENTS_MISMATCH` (step fails) or `APPROVAL_NOT_BOUND` (run fails); both audited, approval unused.       |
| 9   | Execution          | Single-flight `claim` (`approved -> executing`), then the tool calls the application service under trusted context. Tools never take identity/scope from arguments.                                       | `orchestrator.ts` (`claim`), `tool-executor.ts`, application services in `domains/*`                                                                 | Deterministic                                      | Second claimer loses (no second run). A failed step ends the plan; approval recorded `failed`.                       |
| 10  | Verification       | The tool's declared verification source runs (read-back where the tool genuinely can). `verified` is not just `raw.ok` for read-back tools (§6).                                                          | Tool `execute` + `ExecutionVerifier`, `tool-executor.ts` `verificationOf`                                                                            | Deterministic (strength depends on the source)     | Result is `UNVERIFIED`: reported not done; approval recorded `failed`.                                               |
| 11  | Lineage            | Append-only, tenant-scoped `PLANNED_ACTION`, `EXECUTION`, `VERIFICATION` records with fingerprints, ids, `approvedBy` (descriptive).                                                                      | `platform/lineage`, `apps/api/src/lineage/api-lineage-port.ts`, executor                                                                             | Deterministic (descriptive; never an auth input)   | Lineage is best-effort: a write failure never changes the outcome (or grants authority); it is an observability gap. |
| 12  | Audit              | Approval lifecycle and security decisions are audit events; the Audit Center computes a decision trace from records already written.                                                                      | `apps/api/src/audit/*`, `ai/security-audit.ts`, `ai/approval-lifecycle-events.ts`                                                                    | Deterministic (read model)                         | Missing history is reported as missing; nothing is inferred.                                                         |
| 13  | Response           | The narrator states outcomes from the recorded step results. An unverified or failed step is never narrated as done.                                                                                      | `orchestrator.ts` (`#narrate`), grounding checks                                                                                                     | Advisory wording over deterministic outcome status | The status (`completed` / `blocked` / `failed`) is computed from steps, not from the prose.                          |

The order of steps 6 and 7 matters: policy runs first, so a DENY never reaches a
human and an approval can never override it.

## 2. State machine

### 2.1 Approval transitions

Defined once in `platform/ai-runtime/src/approval/engine.ts` as
`APPROVAL_TRANSITIONS`, with `canTransition`, `assertTransition` and
`sourcesOf`. The in-memory engine checks `canTransition`; the PostgreSQL engine
derives every conditional update (`UPDATE ... WHERE status IN (sourcesOf(to))`)
from the same table, so the two cannot drift.

| From                | Legal targets                              |
| ------------------- | ------------------------------------------ |
| `proposed`          | `awaiting_approval`, `rejected`, `expired` |
| `awaiting_approval` | `approved`, `rejected`, `expired`          |
| `approved`          | `executing`, `expired`                     |
| `executing`         | `completed`, `failed`                      |
| `rejected`          | none (terminal)                            |
| `expired`           | none (terminal)                            |
| `completed`         | none (terminal)                            |
| `failed`            | none (terminal)                            |

**Invalid transitions** (each is refused, never applied): any edge out of a
terminal state (a rejected/expired/completed/failed approval can never be
reopened, re-decided or re-run); `awaiting_approval -> executing` (must be
approved first); `approved -> completed` (must be claimed first);
`rejected -> approved`; `executing -> expired` (a claimed approval cannot
expire); `approved -> approved` (a second decision is a conflict, HTTP 409).
`assertTransition` throws `InvalidApprovalTransitionError`.

`expired` is only reachable from `proposed`, `awaiting_approval` or `approved`
(`isExpirableStatus`); expiry is `now >= expiresAt` under an injectable clock.

### 2.2 Execution lifecycle mapping

`EXECUTION_LIFECYCLE` (same file) is documentation-as-data mapping the governed
phases onto the approval statuses and plan-step statuses that already exist. No
new persisted state was introduced.

| Phase               | Approval status     | Plan step status | Meaning                                                                |
| ------------------- | ------------------- | ---------------- | ---------------------------------------------------------------------- |
| `PROPOSED`          | none                | `planned`        | Planner output; nothing is authorized.                                 |
| `AUTHORIZED`        | none                | `planned`        | RBAC ceiling, delegation and the argument guard passed.                |
| `POLICY_DENIED`     | none                | `failed`         | Terminal, error `POLICY_DENIED`; no approval is ever opened.           |
| `APPROVAL_REQUIRED` | `proposed`          | `blocked`        | Policy/gate needs a human; an approval opens.                          |
| `APPROVAL_PENDING`  | `awaiting_approval` | `blocked`        | Waiting for an authorized decider.                                     |
| `APPROVED`          | `approved`          | `blocked`        | Decision recorded; nothing has run yet.                                |
| `REJECTED`          | `rejected`          | `blocked`        | Terminal; nothing runs.                                                |
| `EXPIRED`           | `expired`           | `failed`         | Terminal, error `APPROVAL_EXPIRED`.                                    |
| `EXECUTING`         | `executing`         | `running`        | Single-flight claim succeeded.                                         |
| `VERIFIED`          | `completed`         | `succeeded`      | Tool result recorded with `verified: true` (from the declared source). |
| `FAILED`            | `failed`            | `failed`         | Execution or verification failed; also where denied steps end.         |

Everything on this path is server-authoritative: no prompt, request field or
model output moves a step along it.

## 3. Actor model

Six roles are kept apart. The approver is descriptive, never authoritative.

| Role                    | Who                                                                                                                                               | Held by                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Requester**           | The authenticated user whose request produced the plan (or the initiator of a REST action).                                                       | `approval.userId`; lineage `actorId` (always the requester); `RuntimeRun.actorId`; `GovernanceActors.requester`.                                                                                                                                                           |
| **Agent**               | The agent principal acting for the requester (agent runs only).                                                                                   | `approval.agentId`; lineage `agentId`; `RuntimeRun.agentId`.                                                                                                                                                                                                               |
| **Delegation**          | The grant that authorized the agent for the capability.                                                                                           | `approval.delegationId`; lineage `delegationId`; `RuntimeRun.delegationId`.                                                                                                                                                                                                |
| **Effective authority** | What actually bounded execution: requester RBAC (`requester_rbac`) or agent delegation (`agent_delegation`). Never the union, never the approver. | `GovernanceActors.executionAuthority`; the run ceiling (§4).                                                                                                                                                                                                               |
| **Approver**            | The human who decided the approval.                                                                                                               | `approval.decidedBy`, `decidedAt`, `requiredApproverRoleId`, `separationOfDuties`; lineage `approvedBy {userId, roleId?, decidedAt?}` on `PLANNED_ACTION`/`EXECUTION` (descriptive); `RuntimeRun.approval.decidedBy`. **Never** the lineage `actorId`, never the executor. |
| **Executor**            | The principal the tool ran as: the requester, or the agent acting for the requester.                                                              | `GovernanceActors.executor {kind: 'user'\|'agent', userId, agentId?}`. `userId` is always the requester.                                                                                                                                                                   |

Rules:

- The approver never becomes `actorId`. Approving decides; it never executes.
  The resumed run executes as the requester (or as the agent, re-authorized).
- An agent is never the requester and never an approver. The agent is recorded
  beside the requester; the requester remains accountable.
- `approvedBy`, `actors` and `governance` are read models. No authorization path
  reads them. The authoritative approver is the approval row (`decidedBy`);
  `approvedBy` on lineage is the immutable historical copy.
- `roleId` on the trace approver comes from the approval's
  `requiredApproverRoleId` (the role the approver had to hold), not from a fresh
  role lookup.
- Who may decide is derived server-side by `authorizeApprovalDecision` (org +
  workspace membership, `approvals.decide`, exact required role, separation of
  duties, expiry). Nothing in the decision body is read.

## 4. Resume ceiling

A resumed approval re-runs the orchestrator with a capability ceiling
(`routes/ai.ts`):

- Human approval: the requester's executable capabilities.
- Agent approval: the requester's executable capabilities **narrowed to what the
  agent principal can exercise now** (agent-effective capabilities), plus the
  gated capability itself. The gated capability stays so that a revoked or
  expired delegation is refused by the executor's execution-time check with its
  specific audited reason (`DELEGATION_REVOKED`, ...) instead of silently
  falling out of the ceiling. An agent with nothing effective gets a sentinel no
  capability matches (an empty ceiling would read as "no restriction").

Before this hardening a resumed agent run received the requester's full ceiling;
that widening (relevant to composite inner steps) is closed.

## 5. Approved-argument integrity

- **Canonical equality.** `stableJson(approval.input) === stableJson(step.input)`
  (keys sorted, canonical). The plan is rebuilt on resume; any divergence fails
  the step `APPROVAL_ARGUMENTS_MISMATCH`. Execution uses the stored/approved
  values, never re-sent ones.
- **The approval must be consumed (`APPROVAL_NOT_BOUND`).** A run that names an
  `approvalId` must consume that approval in exactly one bound step. If the
  rebuilt plan has no matching gated step, if the step is no longer gated (the
  tool/capability matches but nothing requires approval any more), or the
  approval is foreign, the run fails `APPROVAL_NOT_BOUND`: audited as
  `approval.resume`, the approval is **not claimed**, the step never runs, and the
  message tells the user to request the action again. It is never silently
  "completed", and never executed around the approval. A run that already has a
  more specific explanation (a failed step: expired, policy changed, arguments
  mismatch; or a still pending / rejected / expired decision) does not also report
  `APPROVAL_NOT_BOUND`.
- **Changes mean a new approval.** Changed arguments, a changed plan, a changed
  policy fingerprint (`POLICY_CHANGED_AFTER_APPROVAL`) or an expired approval never
  stretch the old approval; the action is requested again and a human decides
  again.
- **Single flight.** `claim` is an atomic conditional transition. A duplicate
  delivery of the same approval cannot run the tool twice; a completed approval
  replays its stored result and its recorded `verified` outcome.
- **Descriptive check for operators.** Executions under an approval expose
  `matchesApproved` (run governance) / `matchesApprovedInput` (trace): the
  execution's input fingerprint equals the sha256 of the stored approval input.

## 6. Verification honesty

Verification is not `raw.ok`. Each tool manifest may declare
`verification: { source, limitation? }` (`packages/agent-sdk/src/tools`). A tool
that declares none is recorded with `DEFAULT_TOOL_VERIFICATION`
(`handler_result` + "the tool reported success; no independent state
read-back"). The runtime never records a source the tool did not declare.

| Source              | What it proves                                                                             | Limitation                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `state_readback`    | The changed application state was re-read (tenant-scoped) and matches the expected result. | Only as strong as the read model; a lying handler yields `UNVERIFIED`.         |
| `provider_readback` | The external provider was re-queried and confirms the object.                              | Depends on the provider's read consistency.                                    |
| `response_shape`    | The provider response has the expected shape/identifier.                                   | The object was not re-read from the provider.                                  |
| `handler_result`    | Only that the handler reported success.                                                    | **No independent verification.** Declares its limitation text on every record. |
| `redetection`       | The detection that raised the problem was re-run.                                          | Supported by the model and UI; no built-in write tool declares it yet.         |

Verification result flows to `ToolExecutionResult.verification {verified, source, limitation?, checks?}`
and to the lineage `VERIFICATION` record. The trace and the run governance block
show it. Records written before the source field existed read back as
`handler_result` with the default limitation.

Per registered tool. This table is generated from `TOOL_VERIFICATION_TABLE`
(`apps/api/src/ai/tool-verification-table.ts`) and a test
(`apps/api/test/tool-verification-table.test.ts`) fails when it drifts from the
tool manifests. Strength: **independent** = the changed state is re-read by a
path that is not the write handler's own report (a lying handler is
`UNVERIFIED`, the result carries `readBackFailed`); **shape** = only the
response shape is checked; **handler-only** = the handler's report, no
independent verification, limitation always declared. A `handler_result` tool is
never labelled independent.

| Tool                                          | Verification source | Strength     | Limitation                                                                                                                                 |
| --------------------------------------------- | ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `hr.create_employee`                          | `state_readback`    | independent  | employee re-read by id (tenant-scoped); as strong as the HR read model                                                                     |
| `hr.revoke_hire`                              | `state_readback`    | independent  | employee re-read by id and must be persisted `offboarded`; the record is retained                                                          |
| `projects.assign_employee`                    | `state_readback`    | independent  | assignment must appear in the project member list                                                                                          |
| `projects.create_project`                     | `state_readback`    | independent  | project re-read in the trusted tenant                                                                                                      |
| `calendar.create_event`                       | `state_readback`    | independent  | persisted calendar entry re-read from the workspace list                                                                                   |
| `finance.submit_expense`                      | `state_readback`    | independent  | persisted expense re-read from the workspace list                                                                                          |
| `finance.flag_over_budget_items`              | `state_readback`    | independent  | flagged budgets re-read from the workspace budget list; when nothing was flagged there is nothing to read back                             |
| `notifications.mark_all_read`                 | `state_readback`    | independent  | unread count re-read and must be zero                                                                                                      |
| `workspaces.create_workspace`                 | `state_readback`    | independent  | re-read through the creator's membership-scoped workspace list (tenant, name, slug, status), not a raw repository read                     |
| `workflow.hire_and_assign_employee`           | `state_readback`    | independent  | after the instance succeeded: hired employee, project and assignment re-read; the journal and inner-step verification are not re-derived   |
| `workflow.create_project_and_assign_employee` | `state_readback`    | independent  | after the instance succeeded: created project, employee and assignment re-read; the journal and inner-step verification are not re-derived |
| `github.issues.create`                        | `provider_readback` | independent  | depends on the provider's read consistency                                                                                                 |
| `slack.messages.send`                         | `response_shape`    | shape        | the provider response carried a message identifier; the message was not re-read from Slack                                                 |
| `workspaces.list_workspaces`                  | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `projects.find_project`                       | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `projects.list`                               | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `hr.find_employee`                            | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `knowledge.search`                            | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `documents.search`                            | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `notifications.list`                          | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `notifications.what_needs_attention`          | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `github.repositories.list`                    | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `github.repositories.get`                     | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `github.issues.list`                          | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `slack.channels.list`                         | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |
| `slack.messages.recent`                       | `handler_result`    | handler-only | read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)                                      |

Read-back goes through the tenant-scoped application READ handlers (tools never
touch repositories). Composite workflow tools re-read the created employee /
project and the assignment only AFTER the workflow instance reported success:
`instance.status` alone is not accepted.

An unverified result is reported as unverified, never as done: the step fails
with `UNVERIFIED`, the approval is recorded `failed`, and the narration cannot
claim success.

## 7. Lineage navigation and observability correlation

Follow one action end to end with ids only:

```
request (runId, requestId)
  -> evidence   (EVIDENCE records: source id, version, fingerprint)
  -> plan       (PLANNED_ACTION: stepId, capability, tool, inputFingerprint, policy, approvedBy?)
  -> approval   (approval id apr_..., requester, decidedBy, requiredApproverRoleId, expiresAt)
  -> execution  (EXECUTION: invocationId, status, inputFingerprint, outputFingerprint, affectedResource, approvedBy?)
  -> verification (VERIFICATION: of=invocationId, verified, source, limitation?, checks?)
```

The join keys are `runId`, `approvalId`, `invocationId` and `stepId`. Plan and
execution stay separate records: a plan is never evidence that anything ran.

### 7.1 The nine operator questions and where they are answered

| Question                            | Runtime run governance block (`GET /api/ops/runtime/runs/:runId`)                  | Decision trace (`GET /api/audit/events/:id/trace`) | Audit                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| Who initiated it?                   | `governance.actors.requester`                                                      | `actors.requester`, `request.actorId`              | Event actor                              |
| Which agent (and delegation)?       | `governance.actors.agent`                                                          | `actors.agent`, `authorization`                    | Agent execution journal                  |
| Which policy decided?               | `governance.policies`                                                              | `policy`                                           | `ai.security.blocked` / policy events    |
| Was approval required?              | `governance.approval` present, `policies`                                          | `approval`                                         | `approval.*` events                      |
| Who approved (and under what rule)? | `approval.approverId`, `requiredApproverRoleId`, `separationOfDuties`, `decidedAt` | `actors.approver`, `approval.decidedBy`            | `approval.granted` / `approval.rejected` |
| What exactly was approved?          | `approval.approvedInputFingerprint`                                                | `approval.inputFingerprint`                        | Approval record                          |
| What executed?                      | `executions[]` (`inputFingerprint`, `matchesApproved`, `status`)                   | `executions[]`, `matchesApprovedInput`             | EXECUTION lineage                        |
| Was it verified, and how?           | `executions[].verification {verified, source, limitation?}`                        | `executions[].verification`                        | VERIFICATION lineage                     |
| Where did it fail?                  | `run.failure` (stage, code, class); `APPROVAL_NOT_BOUND` etc.                      | `executions[].status`, `policy`, `approval.status` | `ai.security.blocked` reason codes       |

The governance block is a **server-side join**, tenant-scoped on every read,
`audit.read` required, returning only ids, statuses and sha256 fingerprints
(never raw input or output): `{ actors, approval?, policies, executions[], links: { auditEventId: 'apr:<approvalId>' | null } }`.
A foreign-tenant approval id is indistinguishable from a missing one.

### 7.2 Observability filters and metrics

`GET /api/ops/runtime/runs` accepts, besides the earlier filters, `approvalId`
(the run that opened, resumed or executed under an approval) and `invocationId`
(the run that executed a given tool invocation). The summary counts
`approvals.notBound` (runs failed `APPROVAL_NOT_BOUND`) next to opened / resumed /
rejected / expired. A run records `approval.decidedBy` (the approver) as
descriptive telemetry. Telemetry never feeds a decision.

The blocked run and its resumed run are two runtime records joined by the
approval id.

## 8. The ten traced flows

Each row is a real path exercised by the governed lifecycle scenarios
(`packages/evaluation`, "Governed lifecycle scenarios"). Fingerprints and ids
only are recorded.

| #   | Flow                           | Path                                                                                                                                                                          | Result / what the record shows                                                                                                                                                   |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Chat, no approval              | `POST /api/ai/chat` read-only or non-gated tool: ceiling, policy ALLOW, execute, verify.                                                                                      | No approval row; `EXECUTION` + `VERIFICATION` (default `handler_result` for read tools); `actors` requester = executor.                                                          |
| 2   | Chat, needs approval           | Consequential tool: policy REQUIRE_APPROVAL/baseline gate opens an approval; run `blocked`; decision route; resume as requester.                                              | Approval `awaiting_approval -> approved -> executing -> completed`; `approvedBy` on lineage; run governance shows approver distinct from requester when governance requires it.  |
| 3   | Policy denied                  | Policy DENY (e.g. closed budget) on an AI step.                                                                                                                               | `POLICY_DENIED`, terminal; **no approval opened**; `ai.security.blocked` audit; nothing mutated.                                                                                 |
| 4   | Agent-delegated                | Agent run: agent principal + delegation + requester ceiling; approval carries `agentId`/`delegationId`; resume as the agent.                                                  | `executor.kind = 'agent'`, `executionAuthority = agent_delegation`; ceiling narrowed to agent-effective; revoked delegation fails with its specific code at execution.           |
| 5   | Composite workflow             | `hire_and_assign` / `create_project_and_assign`: one unit approval; preflight of every inner step's policy; inner steps run under the stored ceiling.                         | Inner approval governance not covered by the outer approval refuses `WORKFLOW_INNER_APPROVAL_UNCOVERED` before any step; inner DENY refuses `WORKFLOW_INNER_POLICY_DENIED`.      |
| 6   | Finance expense                | `finance.submit_expense` (or `POST /api/finance/expenses`) then `POST .../decide`: submit refuses a currency that differs from the budget; approve refuses a closed budget.   | Domain separation of duties (submitter cannot decide); utilization derives from approved expenses; `state_readback` on submit.                                                   |
| 7   | Remediation, distinct approver | A plan step with `requiredApproverRoleId` opens an approval with that role and separation of duties; another qualified person decides; `advance()` re-checks and claims.      | The plan's opener cannot approve; wrong role `WRONG_APPROVER_ROLE`; plan is a 404 outside its workspace; the run executes as the requester.                                      |
| 8   | MCP                            | Remote MCP write tool through the governed adapter: argument trust screen (`ARGUMENT_TOO_DEEP`), open approval with deterministic `resumeKey`, decide, re-invoke, claim once. | Terminal approval (rejected/expired/failed) from an earlier run allows a fresh approval under an attempt key; execution uses the stored input; replay returns the stored result. |
| 9   | Direct REST                    | A mutating route classified in `REST_MUTATION_CLASSES`; `policy_enforced` routes call `enforceRestPolicy` (origin `rest`).                                                    | DENY 403 `POLICY_DENIED`, engine failure 503; direct human semantics per §10; no AI approval engine unless the route says so.                                                    |
| 10  | Approval resume                | Decision route approves; orchestrator re-runs with `approvalId`; bound step consumes it or the run fails `APPROVAL_NOT_BOUND`; expiry / policy-fingerprint / argument checks. | `APPROVAL_EXPIRED` (410 at decide), `POLICY_CHANGED_AFTER_APPROVAL`, `APPROVAL_ARGUMENTS_MISMATCH`, `APPROVAL_NOT_BOUND`; each audited and none executes.                        |

## 9. Direct-human vs AI semantics

| Aspect             | AI / agent / MCP path                                                                                 | Direct human REST                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who decides to act | The model proposes; a backend gate decides.                                                           | The authenticated human's own request _is_ the decision (RBAC capability).                                                                                                                                             |
| Policy             | Evaluated by the executor; DENY final.                                                                | Same `PolicyPort`, origin `rest`, on `policy_enforced` routes; DENY final (403), engine failure 503.                                                                                                                   |
| Approval           | Consequential tools are approval-gated (approval engine); approver may need to differ from requester. | Not generally required; the route's domain invariant (e.g. expense separation of duties) is the second control. Composite REST routes return 409 `APPROVAL_REQUIRED` when policy requires more than the baseline gate. |
| Verification       | Declared source recorded on lineage.                                                                  | The application service result; no verification record.                                                                                                                                                                |
| Bypass?            | None: approval never overrides DENY; the model cannot self-approve.                                   | A direct call is never a way around a policy DENY that the same policy would issue on the AI path.                                                                                                                     |

`REST_MUTATION_CLASSES` (`apps/api/src/policy/rest-mutation-classes.ts`) classifies
every mutating route as `rbac`, `policy_enforced`, `approval_enforced`,
`domain_governed` or `exempt`, each with a justification and a **code proof** a
tripwire test checks. The Prompt 8 names remain derivable through
`legacyClassOf`. Documented residuals travel with the entries.

## 9a. Capability ceiling modes and every call site

`allowedCapabilityIds` has three explicit modes (`ToolInvocation`, orchestrator
request, discovery):

| Value       | Meaning                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `undefined` | **No ceiling.** Explicitly unrestricted; only for trusted internal callers with no RBAC role. |
| `[]`        | **Empty ceiling = no authority.** Nothing is permitted (it used to mean "unrestricted").      |
| non-empty   | Only the listed capability ids are permitted.                                                 |

Decision per call site (empty = no authority unless stated):

| Call site                                                                                                    | Before                                                                                                                  | Now                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform/ai-runtime` `tool-executor.ts` ceiling check                                                       | `length > 0` guard: `[]` executed anything                                                                              | `[]` refused (`FORBIDDEN`, audited `CAPABILITY_NOT_PERMITTED`); `undefined` stays unrestricted.                                                                              |
| `discovery/capability-discovery.ts`, `planner/sequential-planner.ts`                                         | `[]` already discovered nothing                                                                                         | Unchanged (already fail closed). The role **affinity** filter (`businessContext.capabilityIds` empty) stays a soft focus, never a grant: the ceiling is what authorizes.     |
| `routes/ai.ts` chat                                                                                          | `businessContext?.capabilityIds` (unresolved role = no ceiling)                                                         | `businessContext?.capabilityIds ?? []`: a role with no executable capability, or no resolvable role, has no authority. Human execution with a real role is unchanged.        |
| `routes/ai.ts` approval resume                                                                               | human: requester ceiling as computed; agent: sentinel when empty                                                        | Unchanged for agents (sentinel); the requester ceiling is now checked by `authorizeApprovalDecision`, which no longer treats an EMPTY set as "unrestricted".                 |
| `ai/approval-authorization.ts` (rule 7)                                                                      | `executableCapabilityIds.length > 0 &&` skipped the check when the requester had lost every capability                  | The gated capability must be in the requester's CURRENT set, empty included: refused `CAPABILITY_NOT_PERMITTED` (403).                                                       |
| `ai/workflow-initiator.ts`                                                                                   | `[]` run ceiling treated as "no run ceiling" and widened to the initiator's full RBAC                                   | `[]` run ceiling = none; only an ABSENT one defers to RBAC.                                                                                                                  |
| `ai/workflow-executor.ts`, `routes/workflows.ts`                                                             | Fail closed (`NO_CAPABILITY_PERMITTED`)                                                                                 | Unchanged.                                                                                                                                                                   |
| MCP (`ai/mcp/build-server.ts`, `nexora-mcp-tools.ts`, `governed-write-adapter.ts`, `platform/mcp` discovery) | Tool visibility/callability already required the capability; the executor treated `[]` as unrestricted as a second line | MCP layer unchanged (empty = no tools); the executor second line now fails closed too. An MCP agent session's ceiling is the agent's effective capabilities, `[]` when none. |
| `platform/agents` `BusinessAgentApplicationService.execute`                                                  | A caller whose permissions could not be resolved fell back to the raw definition set                                    | Execution fails closed: unresolvable permissions bind an EMPTY ceiling. Display-only surfaces keep the pre-S34 fallback.                                                     |
| `apps/api/src/agent/execution-port.ts`                                                                       | passes the intent's required ceiling                                                                                    | Unchanged: the ceiling is a required field, `[]` is no authority.                                                                                                            |
| `remediation` (`platform/remediation`, `remediation/build.ts`)                                               | ceiling is `[snapshot.capabilityId]` (never empty)                                                                      | Unchanged.                                                                                                                                                                   |
| `business-context/permissions.ts` route guards                                                               | Empty/unresolvable = no permission                                                                                      | Unchanged.                                                                                                                                                                   |

Legitimate unrestricted path: only an **absent** ceiling. No human chat, agent,
MCP or workflow path passes one. Agent invocations are additionally bounded by
the execution-time delegation check regardless of the ceiling.

## 9b. Agent hiring capability

Before this change no agent definition contained `hr.create_employee` (or the
composite's inner capabilities), so an agent could never hire: a delegation cannot
exceed its definition ceiling, and the Manager definition's
`workflow.hire_and_assign_employee` could not run its inner steps
(`agent.composite-ceiling.test.ts`, NXS-147). That was **missing configuration**,
not a deliberate prohibition. The `hr` definition (`platform/agents` seed,
bound to `people.hr`) is the only ceiling that holds `hr.find_employee`,
`hr.create_employee`, `projects.find_project`, `projects.assign_employee` and
`workflow.hire_and_assign_employee`. It grants nothing by itself:

- A human with `agents.manage` who currently holds the capability must delegate each
  capability (agents and other agents can never delegate; `agents.manage`,
  `agents.delegate` and `approvals.decide` are non-delegable).
- The requester must hold the capability (`employees.manage` for the hire,
  `workflows.execute` + `projects.assign` for the composite); the agent is
  `definition ∩ delegations ∩ requester`.
- Hiring is Consequential: policy first, then a recorded approval. With an
  organization rule (`{capabilityPrefix: 'hr.', separationOfDuties: true}` and
  `workflow.`) a different human must decide; the agent can never approve.
- The composite is one unit approval; its inner steps run under the resume ceiling
  (agent effective capabilities ∩ requester), so the inner capabilities must also be
  delegated.
- The `people.hr` role itself is unchanged (`agent.use` only): delegating and
  running the HR agent stays with roles that hold `agents.manage` +
  `agent.execute` (the CEO today).

Residual: inner composite steps do not carry `approvedBy` on their own
EXECUTION lineage records (only the outer unit does), so the `actor_continuity`
check cannot yet be applied to a composite; the approval row and the outer record
carry the approver.

## 9c. Exact trusted state re-evaluated at resume

`POST /api/ai/approvals/:id/decision` (approve) -> `authorizeApprovalDecision` ->
`orchestrator.run({approvalId, agent})` -> executor. Re-read from server state at
that moment; nothing from the approval record grants authority:

1. Decider: membership, `approvals.decide`, required approver role, separation of
   duties, expiry.
2. Requester: the gated capability in the requester's CURRENT executable set
   (role change or lost membership -> 403 `CAPABILITY_NOT_PERMITTED`; empty set
   included).
3. Agent principal (from the approval's `agentId`, reloaded): existence, tenant,
   workspace, `active` status (suspended / revoked refused).
4. Agent effective capabilities now (definition ∩ unexpired, unrevoked
   delegations whose grantor still holds them ∩ requester) narrow the resume
   ceiling; the gated capability itself stays so the executor refuses with its
   specific code.
5. Executor, per invocation: agent authority (`evaluateAgentAuthority`: agent
   status, scope, non-delegable, definition ceiling, initiator capability, an
   active delegation not revoked/expired at the evaluation instant, grantor still
   holds it, resource scope), then policy fingerprint, then the single-flight claim.
6. Orchestrator: the rebuilt plan must bind the approval (`APPROVAL_NOT_BOUND`)
   with canonically equal arguments.

A revoked delegation is refused `DELEGATION_REVOKED`; an expired delegation, a
suspended or revoked agent, or a demoted requester leave no bound step for the
gated composite, so the run fails closed as `APPROVAL_NOT_BOUND` (audited, approval
not consumed). None executes. Tests: `agent-hiring.test.ts`,
`agent-identity.execution.test.ts`; scenarios NXS-163..174.

## 9d. Workflow decision traces: state, compensation and composite authority

The decision trace of a `wfs:` step, or of a composite (`workflow.*`) unit approval, carries two extra READ-MODEL sections (nothing is written or rewritten; both are derived from the journal, the approval row and lineage):

- `workflow` — `{instanceId, state, rollbackSummary, steps[], note}`. `state` is the SAME derivation as the workflow read model (`planned … verified / completed_unverified / compensated / partial`). Each step keeps its OWN recorded status: a step that executed stays `succeeded`; a later rollback is shown as `laterState` (`compensated` + `compensatedBy`, `compensation_failed`, or `not_rolled_back`) — an executed step is never re-labelled failed. The `note` is deterministic text (`Create employee executed; Assign employee failed; compensation executed for Create employee. Final workflow state: COMPENSATED.`). Only ids, statuses and error codes appear — never step inputs or outputs.
- `attribution` — `{approvalScope: 'composite_workflow', approvedBy, innerExecutionAuthority: 'workflow_instance_under_requester_ceiling', approverExecutedSteps, innerExecutionCount, statement}`. The unit approval authorized the composite as a whole; its inner steps ran under the workflow instance within the requester's capability ceiling. `approverExecutedSteps` is computed from lineage (true only if a record shows the distinct approver as an executing actor). Each inner execution row references the unit approval as `compositeApproval` with role `authorized_the_composite` — never as an executor. An inner step's input differs from the approved (outer) input by design, so `matchesApprovedInput` is reported for the outer execution only.

The `actors` block is unchanged: requester, approver (descriptive), executor = the requester (or the agent acting for them) and the execution authority.

## 10. Class-specific facts worth knowing

- **Finance.** Submit refuses an expense currency that differs from the budget's
  (`The expense currency must match the budget currency`). Approving an expense
  re-checks the budget: a budget closed after submission refuses approval
  (`Cannot approve an expense against a closed budget`). Rejecting moves no money
  and is not re-checked. Approver and submitter must differ (domain invariant).
- **Remediation.** Plan operations are workspace-scoped: a plan of another
  workspace is a 404 (with no workspace named, the plan's own workspace is derived
  and membership-checked). `requiredApproverRoleId` is enforced at decision time
  and stored on the approval; `advance()` does not re-validate the approver's role
  at execution (the role was enforced at decide). The step executes as the
  requester.
- **Workflows.** `POST /api/workflows/:id/cancel` requires `workflows.execute`
  and that the caller is the initiator or a member of the instance's workspace;
  anything else is a 404. Composite tools preflight every inner step (§8 row 5).
- **MCP.** Arguments nested deeper than 6 levels are refused
  (`ARGUMENT_TOO_DEEP`). The resume key is derived from trusted identity + tool +
  validated arguments; up to 50 attempt keys (`<key>`, `<key>:2`, ...) are walked.

## 11. Accepted tradeoffs and residual risks

Stated plainly; none is hidden by the controls above.

1. **Lazy expiry.** Expiry is persisted when something touches the approval
   (read, decide, claim, list). Reads and every consumer treat an expired approval
   as expired, but the `approval.expired` audit event may lag until a sweep.
2. **A stuck `executing` approval is recovered, never retried.** A process that
   dies between `claim` and `recordOutcome` leaves the approval `executing`
   (it cannot be re-claimed: exactly-once). After the lease
   (`EXECUTING_LEASE_MS`, 15 min from `executedAt`, on the approval clock)
   `recoverStale()` - swept lazily beside the expiry sweep (pending list,
   decision route) - moves ONLY `executing -> failed` with error
   `RECOVERY_REQUIRED: execution outcome unknown; verify state before
re-requesting` (Pg: one conditional `UPDATE ... WHERE status='executing' AND
executed_at <= now - lease`), publishes `approval.recovery_required` once
   (audit activity, status "Recovery required"), and lists it under
   `recoveryRequired` in `GET /api/approvals/pending`. It never re-executes
   (the side effect may or may not have happened), is idempotent, never touches
   completed / failed / rejected / expired / approved records, and an
   `executing` approval past `expiresAt` still ends `failed`, not `expired`.
   A late `recordOutcome` from the presumed-dead process is ignored (terminal).
   Operator reconciliation: check the business state directly (for a composite
   tool read the workflow instance status and its step journal, including
   `compensate:*` steps and the rollback ledger - recovery marks only the
   approval and never touches the instance or runs compensation), then request
   a NEW approval if the action is still wanted. Residual risk: a live but slow
   execution longer than the lease is failed on paper although it may still
   complete.
3. **Weaker verification sources.** Read-only tools and non-GitHub/Slack
   connector writes record `handler_result`; Slack is `response_shape`. See the
   table in section 6. Every write tool built in (including workspace creation,
   hire revocation and both composites) now re-reads persisted state.
4. **Budget approve check is closed-only, and racy.** Approval refuses a closed
   budget, but there is a time-of-check/time-of-use window between that check and
   the approval write; only the "closed" state is re-checked (not a fresh limit
   check).
5. **MCP terminal re-request is scoped to later runs.** A rejected/expired/failed
   approval opened by the _same_ run is reported to that run; a fresh approval
   opens only for a _later_ run (bounded at 50 attempts).
6. **Workflow inner steps are not individually delegated or approved.** One
   approval (and, for an agent, one delegation) authorizes the composite. Inner
   steps are bounded by the stored ceiling and policy-evaluated, and inner approval
   governance the outer approval does not cover now refuses the composite before
   any step runs. Per-step delegation is not re-run.
7. **Only an ABSENT ceiling is unrestricted.** An empty `allowedCapabilityIds`
   is no authority everywhere (§9a). A trusted internal caller that omits the
   ceiling altogether is unrestricted; every human, agent, MCP and workflow
   composition site passes one.
8. **Remediation has no compensation.** A failed or wrong remediation step is not
   automatically undone; the plan stops and a human replans or cancels.
9. **Inbound email approval uses a shared HMAC.** `POST /api/integrations/email/inbound`
   is exempt from a session; it relies on one shared signing secret and a sender
   allow-list. The only routable action is `approval.decide`, which re-enters the
   same decider rules, but a leaked secret plus an allow-listed sender address is
   the trust boundary.
10. **Single-actor budget loosening.** One `budgets.manage` holder can create and
    later raise a limit; policy reads the persisted budget.
11. **Coarse capabilities.** Documents and knowledge use one capability for create,
    edit and archive; `POST /api/problems/scan` is a mutation available to every
    `problems.read` holder.
12. **Composite approval is one decision.** Approvers do not approve inner steps
    individually.
13. **Descriptive records can be incomplete.** Lineage, telemetry and traces are
    read models; a failed write leaves a gap, never a broader authority.

## 12. Where to look

| Need                                        | File                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Approval state machine, lifecycle map       | `platform/ai-runtime/src/approval/engine.ts`                                           |
| Orchestrator binding / `APPROVAL_NOT_BOUND` | `platform/ai-runtime/src/orchestrator/orchestrator.ts`                                 |
| Argument guard, depth                       | `platform/ai-runtime/src/execution/argument-guard.ts`                                  |
| Tool verification metadata                  | `packages/agent-sdk/src/tools/index.ts`                                                |
| Lineage contracts                           | `platform/lineage/src/contracts.ts`                                                    |
| Actors and decision trace                   | `apps/api/src/audit/governance-actors.ts`, `apps/api/src/audit/decision-trace.ts`      |
| Run governance join                         | `apps/api/src/observability/run-governance.ts`, `apps/api/src/routes/runtime-ops.ts`   |
| Approval decision, resume ceiling           | `apps/api/src/routes/ai.ts`                                                            |
| Composite preflight                         | `apps/api/src/ai/workflow-preflight.ts`                                                |
| MCP write governance                        | `apps/api/src/ai/mcp/governed-write-adapter.ts`, `apps/api/src/ai/mcp/build-server.ts` |
| Durable approvals                           | `apps/api/src/ai/pg-approval-engine.ts`                                                |
| REST classification                         | `apps/api/src/policy/rest-mutation-classes.ts`                                         |
