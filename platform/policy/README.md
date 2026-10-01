# @nexora/module-policy

Bounded context: **Policy** (DOMAIN_MODEL.md §1) — the deterministic policy engine.

RBAC and agent delegation decide _who_ may perform a capability. **Policy**
decides _under what conditions_. Approval decides whether a human must say yes
to this exact action. This module is the second of the three: a pure,
versioned, fail-closed evaluation over trusted server-side facts.

```
PolicyRequest (+ trusted facts) → PolicyEngine → PolicyDecision
                                   ALLOW | DENY | REQUIRE_APPROVAL
```

- `src/contracts.ts` — the request / decision / rule contract.
- `src/engine.ts` — `PolicyEngine`: precedence DENY > REQUIRE_APPROVAL >
  ALLOW, ties by policy id, independent of registration order; fails closed;
  never mutates its input; `fingerprint` binds a decision to the rules and
  versions that made it.
- `src/ids.ts` — stable `POLICY_*` ids and `policyIdForReason`.
- `src/rules/` — `POLICY_SIDE_EFFECT_APPROVAL` (the single definition of the
  approval rule), `POLICY_FINANCE_EXPENSE_APPROVAL`, `POLICY_FINANCE_BUDGET_STATE`,
  and the opt-in `POLICY_FINANCE_BUDGET_LIMIT`.
- `src/registry.ts` — `POLICY_REGISTRY`: every policy id with title,
  description, `configurable`, `managedBy` (`platform` | `organization`), static
  `ruleVersion`, `behavior` and `layer`. The read model for policy
  administration; all default engine rule ids are asserted present.
- `src/config-validation.ts` — `validatePolicyConfig`: the strict allow-list every
  write must pass (exact keys and types, enums, id-like strings, 8192-byte and
  depth-4 caps, no executable-looking strings). Configuration is data, never
  code; rejections name paths and rules, never values.
- `src/rules/approval-authority.ts` — `POLICY_APPROVAL_AUTHORITY`: up to 20 rules
  `{ capabilityPrefix, separationOfDuties?, requiredApproverRoleId?, ttlMinutes? }`
  (TTL 1..10080 minutes; longest prefix wins). When it applies to a
  REQUIRE_APPROVAL decision, the `PolicyDecision` carries an `approval`
  requirement (separation of duties, required approver role, TTL, policy id and
  version). It only constrains actions that already require approval.

**Configurable policies (only two):** `POLICY_FINANCE_BUDGET_LIMIT`
(`{ mode: 'deny' | 'require_approval' }`) and `POLICY_APPROVAL_AUTHORITY`.
Configuration is tighten-only, versioned append-only by the API layer, and a
disabled or absent configuration leaves the platform default in force.
Platform-managed rules cannot be edited.

**Engine purity.** The engine and all rules stay pure: no I/O, no clock beyond an
injected one, no persistence. Configuration arrives as trusted facts
(`request.facts.configs`); an unparseable configuration fails closed. Writing
configuration, history, RBAC (`policy.read` / `policy.manage`) and audit live in
`apps/api/src/policy` and `apps/api/src/routes/policy.ts`.

The engine is called through the AI runtime's `PolicyPort`; facts are read by
`apps/api/src/policy/api-policy-port.ts`. It has no I/O, no clock other than an
injected one, and no public endpoint. Design, order, invariants and residual
risks: `platform/ai-runtime/docs/TRUST_MODEL.md` §9 and §12.

## Governed execution (Prompt 9)

Policy is step 6 of the governed lifecycle and runs before approval: a DENY is
final and never opens an approval. REST mutations are classified in
`apps/api/src/policy/rest-mutation-classes.ts` as `rbac`, `policy_enforced`,
`approval_enforced`, `domain_governed` or `exempt` (each with a justification and
a code proof checked by a tripwire test; the Prompt 8 names stay derivable through
`legacyClassOf`). Composite workflows preflight the policy decision of EVERY inner
step; an inner approval requirement the unit approval does not cover refuses
`WORKFLOW_INNER_APPROVAL_UNCOVERED`. A resumed approval still executes only if the
current decision fingerprint equals the one recorded at approval time
(`POLICY_CHANGED_AFTER_APPROVAL`). Policy never grants authority. See
`platform/ai-runtime/docs/GOVERNED_EXECUTION.md`.
