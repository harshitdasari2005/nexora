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
- v1 compensation is **recorded, not destructive**: a failed assignment
  leaves the created project intact (manual recovery). See `compensation`.

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
