# AI Runtime — Execution Pipeline

Detailed walkthrough of the four mechanical stages between intent and result.

## 1. Discovery (`discovery/`, `registry/`)

1. `RuntimeRegistry.registerAgent` / `registerPlugin` ingest capabilities,
   skills, and tools from agents and plugins.
2. `CapabilityDiscovery.discover(intent, context)` asks the matcher to score
   every capability against the intent (token overlap + keyword weights).
3. Results are filtered by permission context and returned sorted by score.
4. `CapabilityResolver.resolve(capabilityId)` returns the **executable tool**
   (or throws `CapabilityNotFoundError`).

Scoring model (`CapabilityScore`):

- `score` — normalized 0..1
- `matches` — matched keywords
- `confidence` — how much of the intent was covered

The matcher deliberately **ignores capability ids** when scoring so shared
tokens (`projects`, `create`) do not pollute the ranking.

## 2. Planning (`planner/`)

- `SequentialPlanner.plan({ intent, capabilities, context })` selects the
  best-matching capability above the confidence threshold.
- Produces an `ExecutionPlan`:

```
plan id, intent
 └─ steps[]: stepId, capabilityId, toolId, input, requiresApproval
```

- A plan may be empty (no match above threshold) → orchestrator responds
  with a clarification request.
- `PlanningStrategy` is the extension point for parallel/LLM planners.

## 3. Execution (`execution/`, `approval/`)

### 3.1 The approval gate (state-changing steps)

Before any step executes, the orchestrator resolves its gate:

1. The planner attaches a gate from the tool's **side-effect class** and the
   workspace **autonomy tier** (`requiresApprovalFor`): `consequential`
   always; `state_change` under `supervised`; never for `read_only`.
2. With an `ApprovalEngine` wired, a gated step calls `open(...)` and the
   request is recorded (`awaiting_approval`) with the trusted identity,
   the user-controlled input (clause-bounded), and the owning conversation.
3. `decisionStatus(id) === 'pending'` → the step is **blocked** and the
   pending approval surfaces in the response (`approvals[]`) with its id.
   **The tool is never invoked.**
4. After a server-side decision (`decide`: grant/reject by the owning user),
   the run resumes with `approvalId`; the orchestrator re-validates
   ownership (user + tenant + conversation + tool) before trusting it.
5. Granted → `claim(id)` (atomic single flight) → execute →
   `recordOutcome(completed|failed, result)`. Rejected → blocked forever;
   a completed request re-delivered **replays its stored result** (idempotent
   re-delivery — the tool can never run twice for one approval).

Read-only steps skip the gate entirely and execute immediately.

See `docs/APPROVAL.md` for the full lifecycle and flow.

### 3.2 `ToolExecutor.execute(step, context)`

1. **Side-effect guard** — if the tool is destructive and the step requires
   approval, execution refuses until approved (`SideEffectGuard`) — a
   second, executor-level guarantee beneath the orchestrator gate.
2. **Timeout** — each invocation is bounded by `TimeoutPolicy`.
3. **Retry** — failures are retried per `RetryPolicy` when the tool is
   idempotent and the failure is retryable; non-idempotent tools are never
   retried after a partial write.
4. **Result capture** — `ExecutionResult` carries `ok`, `value`/`error`,
   `durationMs`, and `retries`.

### Trusted execution context (security contract)

Every invocation carries a **trusted execution context** — `userId`,
`tenantId`, `workspaceId`, `executionId` — assembled by the orchestrator
**only** from the authenticated run inputs, and forwarded verbatim into the
`ToolExecutionContext` every tool receives. The utterance, tool arguments,
and model output are untrusted and can never override these fields; tools
must derive identity and scope exclusively from the context and delegate
authorization to the application layer. See `docs/SECURITY.md` for the full
contract, threat model, and tool checklist.

Failure taxonomy:

| Failure               | Retryable (idempotent tool) | Outcome             |
| --------------------- | --------------------------- | ------------------- |
| `INVALID_INPUT`       | no                          | step fails          |
| `UNAUTHORIZED`        | no                          | step fails          |
| `INTERNAL_ERROR`      | yes (bounded)               | retried, then fails |
| `UNAVAILABLE`         | yes (bounded)               | retried, then fails |
| `TIMEOUT`             | yes (bounded)               | retried, then fails |
| `VERIFICATION_FAILED` | no                          | step fails          |

## 4. Verification (`verification/`)

`ExecutionVerifier.verify(step, result)`:

- Runs every registered `VerificationRule` for the capability.
- Rules may assert result shape, required fields, invariants, or policy.
- Produces `VerificationResult` with `passed`, `issues[]`, and a
  `ConfidenceScore`.
- `SafetyCheck` flags results that must not be surfaced raw (e.g. secrets,
  PII) so narration can redact them.

## 5. Narration and response

The orchestrator renders a human response from the executed steps:

- successes → summarized outcome
- failures → plain-language explanation with the failed step id
- clarifications → what the AI needs to proceed
