# @nexora/module-workflow

Bounded context: **Workflow** (DOMAIN_MODEL.md §1).

Responsibilities: journaled workflow engine — definitions, step dependency
graph, instance lifecycle, step execution journal, approval integration,
retries, compensation (SAD.md §12). This module orchestrates **capabilities**
— it contains no Projects, HR, or Workspaces logic.

## Architecture (plan vs execution)

Strict separation — each layer answers exactly one question:

| Layer             | Question                      |
| ----------------- | ----------------------------- |
| AI Planner        | "What should happen?"         |
| Workflow Runtime  | "Which step is ready?"        |
| Tool Runtime      | "Execute this capability."    |
| Application layer | "Perform the business op."    |
| Domain            | "Enforce business invariants" |
| Database          | "Persist authoritative state" |

The planner NEVER executes a workflow. It may emit **one** workflow
-orchestrating step whose execution starts a workflow instance; the
Workflow Runtime then evaluates the dependency graph and executes steps
through the {@link WorkflowStepExecutor} port. In the application
composition root that port is wired to the AI Runtime's `ToolExecutor`, so
workflow steps run through the exact same governed pipeline as AI tool
calls — one execution path, no bypass.

## Workflow lifecycle

```
created → planning → ready → running ⇄ awaiting_approval → succeeded
                                                  ↘ failed / cancelled
```

- `awaiting_approval` → `running` only via `resume()` with a granted
  decision (recorded through the shared approval engine).
- A rejected approval fails the workflow with **no further mutation**.
- Terminal states (`succeeded`, `failed`, `cancelled`, `compensated`) have
  no outgoing transitions.

## Step dependency model

Every step declares `dependsOn` (step ids that must SUCCEED first). The
engine evaluates readiness from the journal and never executes a step whose
dependencies are unsatisfied; independent steps are not artificially
serialized. The shipped templates:

```
projects.create_and_assign_employee          hr.hire_and_assign_employee
create_project ─┐                            hire_employee ─┐
find_employee  ─┼──→ assign_employee         find_project  ─┼──→ assign_employee
                ┘                                            ┘
```

In both, `assign_employee` depends on BOTH inputs — the assignment can
never run before the project exists (and, for the hire template, before the
employee is created + activated). `hire_and_assign_employee` resolves an
EXISTING project (the HR flagship: hire + assign to a known project),
while `create_and_assign_employee` creates the project first. Adding a
future template is adding a definition (plus a planner spec in the app) —
never new engine logic.

## Approval integration

There is ONE approval engine (the AI Runtime's). The workflow runtime uses
the {@link WorkflowApprovalPort} — the same `InMemoryApprovalEngine` that
gates AI tool calls. In v1, workflow-level approval happens at the
AI-orchestration level: the whole workflow is a gated unit (its tool is
`consequential`), and internal steps execute under the granted decision.
Step-level approval points (`approvalPoints`) are supported by the engine
and pause the instance until a granted `resume()` (the granted decision is
claimed single-flight before any step re-runs — exactly-once replay).

### Governance model (AI path vs operator path)

Approval is an **AI-orchestration-path control**. AI-initiated workflows are
gated as a unit: the workflow tool is `consequential`, so nothing runs
before a granted decision. REST starts (`POST /api/workflows`) are the
authenticated **operator path** — membership of the trusted organization is
the authorization rule — consistent with the existing consequential REST
surfaces (`POST /api/projects`, `POST /api/workspaces`). Both paths execute
steps through the exact same governed tool pipeline; the difference is where
human approval sits in the flow.

## Failure behavior

- A failed step fails the workflow — never a misleading success.
- Retries are budgeted per step (`retryPolicy`). Only **idempotent** tools
  (by canonical manifest) may be auto-retried — a retry must never duplicate
  a business mutation.
- **Compensation (saga rollback).** When a workflow fails, every _completed,
  state-changing_ step is undone in reverse order through the compensating
  capability its definition declares (`compensation[]`) — never guessed.
  Read-only steps (`mutatesState: false`, e.g. lookups) are never undone.
  Each compensation is journaled as its own step (`compensate:<stepId>`) and
  emits the usual step events, so it appears in the audit trail.
- The outcome is an explicit **rollback ledger** on the instance
  (`instance.compensation`), never an implied rollback:
  - `compensated` — everything was undone; the instance ends `compensated`
    (both `workflow.failed` and `workflow.compensated` are published).
  - `partial` — a completed step has no safe compensation (or its
    compensation needs its own approval, which is never run unattended): the
    workflow ends `failed` and **partially completed**, and `outstanding`
    lists what a human must recover.
  - `failed` — a compensation was attempted and failed; the workflow stays
    `failed` and `WorkflowRuntime.recover` retries it (idempotent,
    single-flight, tenant-scoped; `failed → compensated` is the only move
    out of a terminal state).
- Shipped definitions:
  - `hr.hire_and_assign_employee` compensates `hire_employee` with
    `hr.revoke_hire`, which **offboards** the employee this workflow created
    (bound from the hire step's recorded output; record retained for audit,
    never deleted). The rollback runs under the workflow-level approval.
    `hr.revoke_hire` is workflow-internal: executable, but not a
    discoverable capability and not on the MCP surface.
  - `projects.create_and_assign_employee` declares **no** compensation:
    projects have no safe undo, so a failed assignment reports the workflow
    as partially completed with `create_project` outstanding.

## Idempotency

Every step execution has a stable identity (`executionKey` =
`workflowId:stepId:attempt`). A duplicate delivery of the same attempt can
never create a second mutation — succeeded attempts are never re-run, and
approved steps execute exactly once (the shared approval engine's
single-flight `claim`).

## Tenant isolation

Every workflow query and execution is tenant-scoped. A workflow id resolves
to NOT FOUND outside its owning tenant — the journal is never readable,
resumable, cancellable, or controllable across tenants. Identity and tenant
always arrive via the trusted run context, never from the LLM or input.

## Testing

`pnpm test` — domain (lifecycle, invalid transitions, dependency DAG),
runtime (dependency resolution, approval wait/resume, duplicate delivery,
retry, failure, completion), application handlers, and tenant isolation.

## Policy and composite capabilities (Prompt 5)

Workflow steps execute through the same `ToolExecutor` as AI tool calls, so
every step passes the argument guard and the **central policy engine**
(origin `workflow`); a policy DENY on an inner step fails the workflow and
compensates. Approval is a **unit** gate: the two composite capabilities
(`hire_and_assign_employee`, `create_project_and_assign_employee`) are
code-declared operations, and one approval (and, for an agent, one delegation)
intentionally authorizes their fixed steps, whose inputs derive from the
approved arguments. Inner steps are not individually re-approved or re-delegated, but the unit is
**bounded** (Prompt 8):

- **RBAC ceiling.** The initiating run's `allowedCapabilityIds` is bound to the
  workflow instance (`workflow_instances.allowed_capability_ids`, survives
  resume) and applied to EVERY inner step and compensation. An inner
  capability outside it fails closed `FORBIDDEN` (audited
  `CAPABILITY_NOT_PERMITTED`, origin `workflow`), the step fails, completed
  steps are compensated. An instance with no/empty ceiling permits nothing. A
  compensation runs only when the forward capability it undoes was permitted
  (`compensatesCapabilityId`).
- **Initiator authority.** `workflows.execute` alone grants none of the inner
  capabilities. The composite tools and `POST /api/workflows` derive the
  initiator's executable capabilities from trusted RBAC (intersected with the
  invoking run's own ceiling) and refuse to start unless ALL inner
  capabilities are held.
- **Trusted scope.** Tenant/workspace/actor come from the instance; undeclared
  or reserved keys in input are rejected (forged workspace/tenant/user cannot
  reach a step).
- **Policy.** DENY on an inner step is final. Policy-required approval is
  satisfied only by an approval-engine approval (`approvalBasis:
'approval_engine'`). A direct REST start (`direct_human`) satisfies only the
  baseline side-effect gate: `POST /api/workflows` returns 409
  `APPROVAL_REQUIRED` when policy (finance rules, approval-authority
  governance) requires more, and the executor independently refuses at step
  time.
- **Attribution, not re-authorization.** Inner invocations carry the
  initiating actor plus agent / delegation / approval ids for lineage; per-step
  delegation checks are deliberately NOT re-run.

See `platform/ai-runtime/docs/TRUST_MODEL.md` §9.7.

## Governed inner approval and cancel scope (Prompt 9)

- **Inner approval preflight.** The unit approval of a composite was opened under
  the OUTER capability's requirement only. Before any inner step runs, the
  composite tools evaluate every inner step's policy decision
  (`apps/api/src/ai/workflow-preflight.ts`). An inner DENY or a policy failure
  refuses `WORKFLOW_INNER_POLICY_DENIED`; an inner approval requirement
  (POLICY_APPROVAL_AUTHORITY: separation of duties, required approver role, TTL)
  that the stored outer approval does not cover (same or stricter role, separation
  of duties recorded, lifetime not longer than the TTL), or no recorded approval at
  all, refuses `WORKFLOW_INNER_APPROVAL_UNCOVERED`. Fail closed, audited, nothing
  mutated. The baseline side-effect approval is satisfied by the unit approval. A
  direct REST start returns the 409 `APPROVAL_REQUIRED` equivalent.
- **Agent resume ceiling.** A resumed agent approval runs under the requester's
  ceiling narrowed to the agent's effective capabilities, so the ceiling bound to
  the instance cannot exceed the agent's authority.
- **Still not per-step.** Inner steps are not individually approved or delegated;
  they are bounded by the ceiling and policy-evaluated, and journaled and
  verified on their own.
- **Cancel scope.** `POST /api/workflows/:id/cancel` requires `workflows.execute`
  and that the caller is the initiator or a member of the instance's workspace;
  anything else is a 404.

See `platform/ai-runtime/docs/GOVERNED_EXECUTION.md`.

## Composite workflow state vocabulary (read model)

`GET /api/workflows` and `GET /api/workflows/:id` expose ONE truthful `state`
per composite, derived (never stored) from the instance, its rollback ledger,
the unit approval and the append-only lineage
(`apps/api/src/routes/workflow-read-model.ts`). The UI renders `state`, never
the raw engine status. Step inputs/outputs are never returned; steps carry
`purpose` (`step` | `compensation`), `errorCode` (from the step's EXECUTION
lineage), `approvalId` and a `verification` summary.

| `state`                | When                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planned`              | instance `created/planning/ready` (or a proposed approval)                                                                                                          |
| `waiting_for_approval` | the unit approval is pending (NO instance exists yet) or instance `awaiting_approval`                                                                               |
| `approved`             | approved, execution not started                                                                                                                                     |
| `executing`            | instance `running`                                                                                                                                                  |
| `failed`               | `failed`, ledger `not_required`/absent (nothing state-changing had completed)                                                                                       |
| `compensated`          | ledger `compensated` (instance `compensated`)                                                                                                                       |
| `partial`              | ledger `partial` or `failed`: rollback INCOMPLETE, manual recovery / retry needed                                                                                   |
| `verified`             | `succeeded` AND every state-changing inner step has a VERIFICATION with `verified` and an independent source (`state_readback`, `provider_readback`, `redetection`) |
| `completed_unverified` | `succeeded` but a counted step is self-reported (`handler_result`), failed verification, or has no lineage record; the limitation is stated                         |
| `rejected` / `expired` | the unit approval was refused / lapsed: the workflow never ran                                                                                                      |
| `cancelled`            | an operator cancelled the instance                                                                                                                                  |

Rules: a failed, compensated or partial workflow is NEVER reported as
completed or verified; only `verified` may render as success. Read-only steps
are not counted for verification. Pending / rejected / expired units appear
in `composites` on the list response (capability `workflow.*` approvals with
no instance), scoped to the caller's own approvals and workspaces.
