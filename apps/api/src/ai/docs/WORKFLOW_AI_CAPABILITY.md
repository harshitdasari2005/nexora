# Workflow AI Capability — CreateProjectAndAssignWorkflowTool

The first **workflow-orchestrating** AI capability (Workflow vertical
slice). The general security model is in
`platform/ai-runtime/docs/APPROVAL.md` and `platform/ai-runtime/docs/SECURITY.md`.

## Flow

```
User: "Create a project called Mobile Banking and assign Sarah to it."
  → POST /api/ai/chat
  → EnterpriseAIOrchestrator
  → SequentialPlanner
  → WorkflowProposalDetector (deterministic: create + project + assign)
  → ONE workflow step: workflow.create_project_and_assign_employee
  → approval gate (consequential)
  → [Approve] → POST /api/ai/approvals/:id/decision
  → CreateProjectAndAssignWorkflowTool
  → WorkflowApplicationService.start (platform/workflow)
  → WorkflowRuntime drains the dependency graph:
      create_project ─┐
      find_employee  ─┼──→ assign_employee
                      ┘
      (each step executes through the SAME ToolExecutor pipeline)
  → "Mobile Banking was created and Sarah was assigned successfully."
```

## Capability manifest

- **Tool id:** `workflow.create_project_and_assign_employee`
- **Side-effect class:** `consequential` — the whole workflow is a gated
  unit; nothing runs before approval.
- **Input schema:** ONLY the user-controlled business names
  (`projectName`, `employeeName`) with `additionalProperties: false`. The
  model can never supply `userId`, `tenantId`, `organizationId`,
  `workspaceId`, permissions, approval, or autonomy tier — identity and
  scope arrive exclusively through the **trusted execution context**.

## Planner vs runtime (deterministic bridge)

The workflow capability is **not** a token-matched registry entry.
Workflow intents are detected by the deterministic
`WorkflowProposalDetector` (`apps/api/src/ai/workflow-planner.ts`): only an
intent evidencing **create + project + assign** with BOTH business values
extractable produces a workflow proposal — anything less falls through to
per-capability planning ("create a project", "assign Sarah to X", and
read-only intents plan exactly as before).

The planner NEVER executes the workflow. It emits one
workflow-orchestrating step; the Workflow Runtime executes the internal
steps through the governed tool pipeline (see `platform/workflow/README.md`).

## Security contract

- **Prompt injection** ("ignore permissions", "act as administrator")
  changes nothing: the tool is gated, membership of the trusted tenant is
  the authorization rule, and extraction is clause-bounded.
- **Forged tenant** ("… in organization org_alien") is never captured: the
  approval card carries only the business names, and the project/assignment
  land in the trusted tenant.
- **Approval ownership** is enforced server-side: only the requesting user
  can decide, membership is re-checked at decision time, and a decided
  request can never be re-decided (exactly-once).

## Failure behavior

A failed workflow reports failure — never a misleading success. Example:
Sarah does not exist → `assign_employee` fails → the workflow is journaled
`failed`, no assignment is created, and the response does not claim
success. v1 compensation is non-destructive: the created project is left
intact (recorded, manual recovery).

## Idempotency

The workflow tool is non-idempotent by contract; the approval engine's
single-flight `claim` prevents duplicate execution of an approved run. Each
internal step attempt carries a stable `executionKey`
(`workflowId:stepId:attempt`) so duplicate delivery never re-runs a
succeeded step.
