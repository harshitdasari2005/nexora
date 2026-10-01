# @nexora/app-api

The Fastify modular-monolith application container (BACKEND.md §2,
ROADMAP.md §7). Wires `@nexora/persistence` (Drizzle/PostgreSQL), the domain
cores, and the application layers into the onboarding API surface.

## Routes (v1 slice)

| Method | Route                | Auth    | Purpose                                      |
| ------ | -------------------- | ------- | -------------------------------------------- |
| GET    | `/api/health`        | public  | liveness                                     |
| GET    | `/api/auth/login`    | public  | redirect to Keycloak (OIDC)                  |
| GET    | `/api/auth/callback` | public  | code exchange → session cookie               |
| GET    | `/api/auth/logout`   | session | end session + redirect home                  |
| GET    | `/api/me`            | session | current user + organizations                 |
| POST   | `/api/organizations` | session | create + provision an organization           |
| GET    | `/api/organizations` | session | list the user's organizations                |
| POST   | `/api/workspaces`    | session | create + provision a workspace               |
| GET    | `/api/workspaces`    | session | list a member organization's workspaces      |
| GET    | `/api/dashboard`     | session | user + org + workspace + empty apps/activity |

Authentication is the OIDC authorization-code flow against Keycloak; the
browser follows redirects, the session token lives in an `HttpOnly` cookie,
and the SPA never sees tokens.

## Run locally

```bash
# 1. Infra (PostgreSQL, Redis, MinIO, Keycloak with the nexora realm import)
docker compose up -d          # or: pnpm dev:infra

# 2. API
pnpm dev:api                  # tsx watch, loads .env from the repo root
```

Migrations run automatically at boot (`DATABASE_AUTO_MIGRATE=true`); disable
with `DATABASE_AUTO_MIGRATE=false` and run `pnpm --filter @nexora/persistence
exec drizzle-kit migrate` manually.

## Environment

See `.env.example`. The critical values:

- `DATABASE_URL` — PostgreSQL connection string.
- `OIDC_ISSUER_URL` — Keycloak realm issuer (e.g. `http://localhost:8080/realms/nexora`).
- `OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` — must match the Keycloak client
  (`nexora-web` in `infrastructure/keycloak/realm-nexora.json`).
- `WEB_ORIGIN` — the SPA origin; the post-login redirect target.

## Known limitations (v1 slice)

- **Session tokens at rest.** The session token is stored in PostgreSQL as
  issued. Hashing tokens (store only a digest, look up by digest) is the
  hardening for a later milestone — see ROADMAP.md security phase.
- **Command idempotency.** The contracts define idempotency keys
  (`@nexora/contracts/commands`), but the onboarding routes do not enforce
  them yet; retried POSTs can create duplicates. Slug uniqueness returns a
  `CONFLICT` on the retry path, but a full idempotency-key store is future
  work (BKD.md §8.2).

## Testing

`pnpm --filter @nexora/app-api test` — the whole onboarding slice is tested
with `fastify.inject` and in-memory repository fakes (no Docker needed),
including an end-to-end login → organization → workspace → dashboard walk.

## Policy administration and approvals

Policy administration (human-only; `policy.read` / `policy.manage` are
non-delegable and on no AI tool). All routes require authentication,
organization membership, workspace membership and the RBAC capability, with
`organizationId` and `workspaceId` as query parameters (like `/api/audit`).

| Method | Route                                     | Capability      | Purpose                                                                                                                                                            |
| ------ | ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/policy/policies`                    | `policy.read`   | every policy with config, version, enabled, `configurable`                                                                                                         |
| GET    | `/api/policy/policies/:policyId/history`  | `policy.read`   | versions, newest first                                                                                                                                             |
| POST   | `/api/policy/policies/:policyId/versions` | `policy.manage` | new version: body `{ config?, enabled?, reason?, expectedVersion? }` -> 201 `{ version }`                                                                          |
| GET    | `/api/approvals/pending`                  | membership      | pending approvals of the workspace with server-computed `canDecide` / `denyReason`, `expiresAt`, `requiredApproverRoleId`, `separationOfDuties`, policy id/version |
| POST   | `/api/ai/approvals/:approvalId/decision`  | see below       | body only `{ decision: 'approve' \| 'reject', reason? }`                                                                                                           |

Only `POLICY_FINANCE_BUDGET_LIMIT` and `POLICY_APPROVAL_AUTHORITY` accept a
configuration; it is validated against a strict allow-list (data, never code)
before anything is written, and every write is a new immutable version
(`enabled: false` is also a new version). Events: `policy.version_created`,
`policy.enabled`, `policy.disabled`, `policy.admin_denied`.

Error codes (body `{ error: { code, message, requestId } }`):

| Status | Code                                                | When                                                                                            |
| ------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`                                  | malformed body (unknown key, bad `reason`, bad `expectedVersion`, nothing to change)            |
| 403    | `AUTHORIZATION_ERROR`                               | not a member, or missing capability (policy admin denial is audited); approval decision refused |
| 403    | `POLICY_DENIED`                                     | a REST mutation was denied by policy (`policy.policyId/version/reasonCode`)                     |
| 404    | `NOT_FOUND`                                         | unknown policy or approval, or one belonging to another tenant                                  |
| 409    | `POLICY_VERSION_CONFLICT`                           | `expectedVersion` differs from the current version (`currentVersion` returned)                  |
| 409    | `CONFLICT` / `APPROVAL_REQUIRED`                    | approval already decided; a composite REST route needs approval                                 |
| 410    | `APPROVAL_EXPIRED`                                  | the approval expired (repeatable, idempotent)                                                   |
| 422    | `POLICY_NOT_CONFIGURABLE` / `POLICY_CONFIG_INVALID` | platform-managed policy; configuration failed validation (`errors` lists paths)                 |
| 503    | `POLICY_UNAVAILABLE`                                | policy could not be evaluated; the action was not executed (fail closed)                        |

**Approval decision semantics.** The decider is the authenticated session user;
nothing in the body (`role`, `approver`, ...) is read. Allowed only when the
decider is a member of the approval's organization and workspace, holds
`approvals.decide`, the approval is not expired, holds the required approver
role when the approval names one (`WRONG_APPROVER_ROLE`), is not the requester
when separation of duties applies (`SELF_APPROVAL_FORBIDDEN`), and (legacy
approvals with neither) is the requester (`NOT_REQUESTER`). Refusals are 403
audited as `ai.security.blocked` with the reason code. The resumed action runs
as the requester. Approving never overrides a policy DENY.

`GET /api/approvals/pending` (Prompt 9) runs a lazy expiry sweep first and lists
only `awaiting_approval` approvals of the workspace; each carries the server
computed `canDecide` / `denyReason` from the same `authorizeApprovalDecision` the
decision route uses. An approve resumes the run as the requester (an agent
approval resumes as the agent, under the requester's ceiling narrowed to the
agent's effective capabilities). A resumed run must consume its approval or it
fails `APPROVAL_NOT_BOUND`; an argument change fails
`APPROVAL_ARGUMENTS_MISMATCH`. See
`platform/ai-runtime/docs/GOVERNED_EXECUTION.md`.

## Direct human vs AI execution

The AI is never authority, and a direct human REST call is never a way around
a policy DENY. Every mutating route is classified in one exported table,
`REST_MUTATION_CLASSES` (`src/policy/rest-mutation-classes.ts`), with a
justification AND a **code proof** (source facts that must stay true);
`test/rest-mutation-classes.test.ts` fails when a mutating route is added
without an entry, when a `policy_enforced` route does not call
`enforceRestPolicy`, or when any proof is no longer true of the source. The
Prompt 8 names (`rbac+policy`, `rbac+policy+approval`, `sod`) stay derivable via
`legacyClassOf`.

| class               | controls                                                                                                                      | routes                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rbac`              | membership + RBAC capability (no policy DENY rule governs the capability); self-scoped and ownership-scoped actions           | calendar, documents, knowledge, webhooks, marketplace, projects, employees, workspaces, agents admin, policy admin, notifications, problems scan / plans, workflow cancel |
| `policy_enforced`   | + the central PolicyPort with origin `rest` (`enforceRestPolicy`)                                                             | `POST /api/finance/expenses`, `POST /api/workflows`                                                                                                                       |
| `approval_enforced` | the governed AI / agent / MCP / plan path (approval engine), and the approval decision itself (decider authority server-side) | chat, agent execute, plan advance, approval decision                                                                                                                      |
| `domain_governed`   | RBAC + an invariant the DOMAIN enforces regardless of caller (separation of duties, budget lifecycle)                         | budgets create / revise / close / clear-review / flag, expense decide                                                                                                     |
| `exempt`            | no session by design; the alternative control is named and proven                                                             | `POST /api/integrations/email/inbound` (HMAC-signed; only `approval.decide` is routable)                                                                                  |

Documented residuals (each carried in the table as `residual`): budgets have
**single-actor loosening** (the same `budgets.manage` holder can raise a limit —
no second-person review); knowledge (`knowledge.publish`) and documents
(`documents.upload`) each use one **coarse capability** for create / edit /
archive; `POST /api/problems/scan` is a mutation (it persists problem records —
idempotent, no business state) available to every `problems.read` holder;
expense **reject asymmetry** — approval re-checks the budget (closed → refused,
currency must match at submit) but a rejection moves no money and is not
re-checked. `POST /api/workflows/:id/cancel` is ownership-scoped: the caller
must be the initiator or a member of the instance's workspace (otherwise 404).
Remediation plan operations are workspace-scoped: a plan of workspace A is a 404
under workspace B; with no workspace named, the plan's own workspace is derived
and membership-checked.

`enforceRestPolicy(deps, request)` (`src/policy/rest-policy.ts`) evaluates the
SAME policy over the same trusted facts as the AI surfaces: DENY -> 403
`POLICY_DENIED` (error carries `policy.policyId/version/reasonCode`, audited as
`ai.security.blocked` with origin `rest`, nothing persisted);
REQUIRE_APPROVAL -> returned to the route (expenses proceed under the domain's
own pending -> decided flow and the decision is returned in the `policy`
field; workflows return 409 `APPROVAL_REQUIRED` unless only the baseline
side-effect gate applies); engine failure -> 503 `POLICY_UNAVAILABLE`. An
unresolvable budget stays a plain 404 from the domain (no oracle).

Composite workflows are bounded by the initiator's RBAC ceiling and cannot be
started without holding every inner capability (see
`platform/workflow/README.md`).

## Audit Center

`GET /api/audit/events` is a computed read view over four journals (agent
executions, approvals, workflow steps, activity). `GET
/api/audit/events/:eventId/trace` (Prompt 6) returns the **decision trace** of
an approval / agent-execution / workflow-step event: request, evidence (derived
findings marked), authorization, policy, approval, planned vs executed,
verification and lineage — assembled from the append-only `lineage_records` and
existing rows, with ids/versions/fingerprints only (never raw content or model
reasoning). Both endpoints require organization + workspace membership and
`audit.read`; ids from another tenant are indistinguishable from missing ones.

The trace (Prompt 9) also carries an `actors` block: `requester`, `agent` (with
`delegationId`), `approver` (`userId`, `decidedAt`, and the required role when the
approval named one), `executor` (`kind: 'user' | 'agent'`; its `userId` is always
the requester) and `executionAuthority` (`requester_rbac` | `agent_delegation`).
The approver is descriptive: never the actor or executor, never read by
authorization. Each execution exposes `verification {verified, source,
limitation?, checks?}` (the DECLARED verification source, `handler_result` when the
tool has no read-back) and, under an approval, `matchesApprovedInput`.

## Runtime observability

Audit says _what happened_, lineage says _what data was connected_,
observability says _how the runtime performed_. `GET /api/ops/runtime/runs`
(list: time, status, duration, actor, agent, model, tool calls, approvals,
failure stage), `GET /api/ops/runtime/runs/:runId` (timeline
REQUEST → PLANNING → RETRIEVAL → AUTHORIZATION → POLICY → APPROVAL → EXECUTION →
VERIFICATION → NARRATION, with ids and safe metadata, plus the bottleneck
computed from that run's own timings) and `GET /api/ops/runtime/metrics`
(requests, success / failure rate, avg / p50 / p95 / p99 latency, tool / model
failure rates, policy denials, approval wait, tokens, cost — for an explicit
`from`/`to` window and tenant scope; `truncated` is set when the 5,000-run
sample cap is hit). Same authorization as the Audit Center (organization +
workspace membership + `audit.read`); a run id from another tenant is
indistinguishable from a missing one. Records hold ids, codes, counts,
durations and fingerprints only. Model pricing is optional trusted
configuration (`NEXORA_MODEL_PRICING`, JSON `{version, currency, models:
{"provider/model": {promptPer1k, completionPer1k}}}`); without it cost is
`null`. See `platform/ai-runtime/docs/TRUST_MODEL.md` §11.

**Run governance block (Prompt 9).** `GET /api/ops/runtime/runs/:runId` also
returns `governance`, joined server-side and tenant-scoped from the run, the
approval row and the run's lineage: `actors`, `approval` (id, status, requester,
approver, `requiredApproverRoleId`, `separationOfDuties`, `decidedAt`, `expiresAt`,
`approvedInputFingerprint`), `policies`, `executions[]` (invocation id, tool,
status, `inputFingerprint`, `matchesApproved`, `verification`) and
`links.auditEventId` (`apr:<approvalId>`, or null). Only ids, statuses and sha256
fingerprints, never raw input or output. The list route filters additionally by
`approvalId` and `invocationId`, and the metrics count `approvals.notBound`. See
`platform/ai-runtime/docs/GOVERNED_EXECUTION.md` §7 for the nine operator
questions and where each is answered.
