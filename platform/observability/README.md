# @nexora/module-observability

AI runtime observability + execution telemetry (Prompt 7).

- **Audit** = what happened. **Lineage** = what data / results were connected.
  **Observability** (this module) = how the runtime _performed_.
- Pure and dependency-free: the `RuntimeRun` model, stages, failure taxonomy
  (`classifyFailure`), redaction detectors (`findSecrets`, `findForbiddenKeys`,
  `safeCode`), trusted-config pricing (`parsePricing`, `estimateCost`),
  aggregation (`summarize`, `percentile`, `bottleneckOf`), the `RunCollector` /
  `RunTelemetryHub` and an in-memory append-only repository.
- **Descriptive only** — never an input to RBAC, delegation, policy or approval.
  Records hold ids, codes, counts, durations and fingerprints; never prompts,
  arguments, documents, secrets or reasoning. Unknown facts stay unknown
  (`usageAvailable=false`, cost `null`, unused stages absent).

The seams live elsewhere: `platform/ai-runtime` (`ToolExecutor`, orchestrator),
`apps/api` (`runtime_runs` Postgres repository, `/api/ops/runtime/*`),
`apps/web` (Runtime Runs page). Design and invariants:
`platform/ai-runtime/docs/TRUST_MODEL.md` §11.

## Governance correlation (Prompt 9)

- **Join, not storage.** `GET /api/ops/runtime/runs/:runId` returns a
  server-joined `governance` block (`apps/api/src/observability/run-governance.ts`):
  `actors` (requester, agent, approver, executor, execution authority), `approval`
  (id, status, requester, approver, required approver role, separation of duties,
  `decidedAt`, `expiresAt`, sha256 of the approved input), `policies`,
  `executions[]` (invocation id, tool, status, input fingerprint, `matchesApproved`,
  `verification {verified, source, limitation?}`) and `links.auditEventId`
  (`apr:<approvalId>`). Tenant-scoped on every read, `audit.read` required; only
  ids, statuses and fingerprints, never raw input or output.
- **Filters.** `GET /api/ops/runtime/runs` also filters by `approvalId` (the run
  that opened, resumed or executed under an approval) and `invocationId` (the run
  that executed a given tool invocation).
- **Approver on the run.** The run's approval timing record carries `decidedBy`
  (descriptive). The human wait stays separate from model, tool and execution
  latency.
- **`notBound`.** `APPROVAL_NOT_BOUND` is a failure-taxonomy code (approval stage);
  the summary counts `approvals.notBound` beside opened / resumed / rejected /
  expired.
- Still descriptive only: nothing here is an input to RBAC, delegation, policy or
  approval. Invariants: `platform/ai-runtime/docs/TRUST_MODEL.md` §13; the nine
  operator questions and where each is answered:
  `platform/ai-runtime/docs/GOVERNED_EXECUTION.md` §7.
