# @nexora/module-lineage

Evidence provenance and data lineage (Prompt 6), extended in Prompt 9.

Append-only, tenant-scoped records of what a run retrieved, planned, executed and
verified: `EVIDENCE`, `PLANNED_ACTION`, `EXECUTION`, `VERIFICATION`. Records carry
ids, versions, statuses and sha256 fingerprints (`fingerprintOf`); never raw
documents, tool outputs, secrets or model reasoning. Lineage is **descriptive**:
it is never read by any authorization decision, and a failed write never changes
an outcome.

## Prompt 9 additions

- **`VerificationData.source`** (`state_readback`, `provider_readback`,
  `response_shape`, `handler_result`, `redetection`) is the verification source the
  tool DECLARED in its manifest; the runtime never records a source the tool did
  not declare. `limitation?` says what that source does not prove. `method` remains
  as a backward-compatible label equal to `source` for new records; records
  written before the field existed are read as `handler_result` with the default
  limitation. `checks?` holds per-rule outcomes.
- **`approvedBy {userId, roleId?, decidedAt?}`** on `PlannedActionData` and
  `ExecutionData`: the human who approved the action the run resumed under. It is
  descriptive. The record's `actorId` stays the REQUESTER; the approver never
  becomes the actor, and nothing authorizes from `approvedBy`. The authoritative
  approver is the approval row.
- Navigation: request -> evidence -> plan -> approval -> execution ->
  verification, joined by `runId`, `approvalId`, `invocationId` and `stepId`. The
  decision trace (`GET /api/audit/events/:id/trace`) and the runtime run
  `governance` block assemble it server-side.

Contracts: `src/contracts.ts`. Design and invariants:
`platform/ai-runtime/docs/TRUST_MODEL.md` §10 and §13;
`platform/ai-runtime/docs/GOVERNED_EXECUTION.md`.
