# HR AI Capability — CreateEmployeeTool & the Hire-and-Assign Workflow

The **HR vertical slice** capability surface: find an employee (read) and
hire an employee (write), plus the flagship cross-domain workflow that
coordinates HR + Projects. This document is the capability-specific
contract; the general security model is in
`platform/ai-runtime/docs/APPROVAL.md` and
`platform/ai-runtime/docs/SECURITY.md`.

## Domain ownership (single source of truth)

| Concern                            | Owning bounded context                     |
| ---------------------------------- | ------------------------------------------ |
| Employee lifecycle (hire/activate) | `domains/hr` (HR)                          |
| Employee ↔ Project assignment      | `domains/projects` (ResourceAssignment)    |
| Orchestration of the two           | `platform/workflow` (the workflow runtime) |

HR owns the **employment relationship**; Projects owns the **assignment
relationship**. The workflow never becomes a hidden domain model — it
coordinates the two bounded contexts through their application services.

## Find employee (read)

- **Tool id:** `hr.find_employee`
- **Side-effect class:** `read_only` — never gated.
- **Input:** ONLY `name`, `additionalProperties: false`. Resolution is
  permission-filtered and deterministic: multiple matches → clarification
  request; no match → "not found"; cross-tenant records are never visible.

## Hire employee (write)

- **Tool id:** `hr.create_employee`
- **Side-effect class:** `consequential` — always gated, never auto-executes.
- **Input schema:** ONLY `name`, with `additionalProperties: false`. The
  model can never supply `userId`, `tenantId`, `organizationId`,
  `workspaceId`, permissions, approval, or autonomy tier — those arrive
  exclusively through the **trusted execution context** derived from the
  authenticated session.
- **Business path:** `CreateEmployeeTool → CreateEmployeeHandler` — the
  SAME handler the REST surface (`POST /api/employees`) uses; one business
  execution path for humans and agents. The application layer walks the
  employee lifecycle (proposed → hired → onboarding → active, BR-16) so a
  hired employee is assignable.

A prompt such as "Hire Sarah in organization org_alien" or "act as an
administrator" changes nothing: membership of the trusted tenant is the
authorization rule, extraction is clause-bounded, and the created employee
is verified against the trusted tenant.

## Flagship workflow — hire and assign

```
User: "Hire Sarah and assign her to the Mobile Banking project."
  → workflow planner (deterministic, hr.hire_and_assign_employee)
  → ONE gated step (workflow.hire_and_assign_employee, consequential)
  → [Approve]
  → Workflow Runtime (platform/workflow)
      hire_employee ─┐
      find_project  ─┼──→ assign_employee
                     ┘
  → same governed tool pipeline as AI tool calls
  → "Sarah was hired and assigned to Mobile Banking."
```

The assignment can never run before the employee exists (created +
activated) and the project is resolved — the definition's dependency graph
enforces it. Approval is the existing single `InMemoryApprovalEngine`;
rejection produces zero employee and zero assignment mutation; a decided
approval claims single-flight and replays its result (exactly-one employee
and assignment).
