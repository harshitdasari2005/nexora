# AI Runtime — Trust Model and Trust Boundaries

> **AI proposes. Deterministic application code authorizes. Policy decides
> whether an action is allowed or needs approval. A human approves sensitive
> operations. Governed services mutate. Verification confirms. Audit records
> what actually happened.**
>
> The model is never an authorization authority.

This document is the runtime's trust model: what is trusted, what is not, and
where each deterministic check sits on every path that can change state. It
complements the security contract in [`SECURITY.md`](./SECURITY.md) and the
approval lifecycle in [`APPROVAL.md`](./APPROVAL.md).

It does **not** claim prompt injection is solved, that agents are "fully
secure", or that authorization cannot be bypassed. It states which boundaries
are enforced by deterministic code, which attack classes are tested, and what
residual risk remains (§7, §8.9).

## 1. Classification

Trust is assigned by **where a value comes from**, never by what it says. No
component asks a model whether something is trusted.

| Trusted — server-side, deterministic                                                        | Untrusted — data only, never authority                                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Authenticated identity (session → `requireAuth`)                                            | Anything a model outputs (narration text, future tool calls)                                |
| Organization membership (`listOrganizations`)                                               | Tool arguments — extracted from user text, model-generated, or sent by an MCP client        |
| Workspace membership (`listMyWorkspaces`, MCP `X-Nexora-Workspace` validation)              | Retrieved knowledge articles and documents                                                  |
| The resolved business role and its capability set (`buildAIBusinessContext`)                | Project, employee, and other entity text (names, descriptions)                              |
| Policy decisions (side-effect class × autonomy tier, `evaluateSideEffect`)                  | External tool / connector responses (GitHub, Slack) and MCP tool results                    |
| Approval state (`ApprovalEngine` records and decisions)                                     | Webhook and inbound payload _contents_ (the signature authenticates the sender, not intent) |
| Persisted application state read through application services                               | Imported text, conversation history, and the user's own message                             |
| Tool results **as verified facts about what ran** (status, the entity the service returned) | Tool results **as instructions** — text inside them never directs the runtime               |

Two consequences:

- A value in the untrusted column can change **what the user sees** (it is
  quoted, cited, summarized) but never **what the runtime is allowed to do**.
- Trusted scope (`userId`, `tenantId`, `workspaceId`, role, capabilities,
  approval state) enters a run **only** through `OrchestratorRequest` /
  `ToolInvocation` fields that routes fill from the session. It is never read
  from arguments, text, or tool output.

## 2. The execution boundary, stage by stage

```
User ─► route ─► AI Runtime ─► intent ─► retrieval ─► tool selection ─► tool arguments
      ─► trusted scope ─► authorization ─► policy ─► approval ─► execution ─► verification ─► audit
```

| Stage          | What happens                                                                                                                                                                   | Deterministic enforcement (code)                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Route          | Authenticate; resolve organization and workspace **by membership**; 403 otherwise                                                                                              | `apps/api/src/routes/ai.ts` (`/api/ai/chat`), `routes/mcp.ts`                                                                            |
| Trusted scope  | Build the business context (role → capability set) from membership + catalog                                                                                                   | `buildAIBusinessContext`; passed as `businessContext` + `allowedCapabilityIds`                                                           |
| Intent         | Classify information / recommendation / action; a question can never match a state-changing capability                                                                         | `discovery/intent-classifier.ts`, `capability-matcher.ts`                                                                                |
| Retrieval      | Permission-filtered, tenant- and workspace-scoped search; results are **evidence**                                                                                             | Knowledge application service (scope from trusted context)                                                                               |
| Tool selection | Registry-backed discovery filtered by the role's capability set; unknown intents clarify                                                                                       | `CapabilityDiscovery#filterByPermissions`, `KnowledgeFallbackMatcher`                                                                    |
| Tool arguments | Extracted deterministically from the user's text; **checked** before anything else happens                                                                                     | `apps/api/src/ai/parameters.ts`; `execution/argument-guard.ts` (reserved scope/authority keys + JSON schema)                             |
| Authorization  | Capability must be inside the caller's trusted ceiling; tools re-check membership; services re-check resource ownership                                                        | `ToolExecutor` ceiling check; each tool's membership check; application services (e.g. `#requireVisibleBudget`)                          |
| Policy         | Side-effect class × autonomy tier decides whether approval is required (consequential always)                                                                                  | `execution/side-effect-guard.ts`; planner gates                                                                                          |
| Approval       | A recorded request; execution only after a granted, **authorized** decision; exactly-once claim; **argument binding**                                                          | `ApprovalEngine`; `ai/approval-authorization.ts` (every decision channel); orchestrator binding check (approved input == executed input) |
| Execution      | Only through `ToolExecutor` → tool → application service                                                                                                                       | ADR-001 single execution path                                                                                                            |
| Verification   | The service result is authoritative; tools verify tenant/entity; the executor reports unverified results as not done                                                           | `DefaultExecutionVerifier`; per-tool verification                                                                                        |
| Narration      | Deterministic composer by default. A model narrates only **after** execution, sees untrusted text inside fenced data blocks, and a disclosure of its instructions is discarded | `orchestrator/narration.ts`; `prompting/narration-prompt.ts` (v4 trust boundary); `prompting/untrusted-content.ts`                       |
| Audit          | Approvals, workflow steps, activity; **every security block** as `ai.security.blocked`                                                                                         | `apps/api/src/ai/security-audit.ts` → notification policy → activity feed → Audit Center (`status: blocked`)                             |

**The model never selects, authorizes, or executes anything in this pipeline.**
In v1 the only model call is narration, which runs after execution has
finished and whose output is text shown to the user.

## 3. Where authority is checked, per mutation path

Every path below reaches the deterministic checks **before** a mutation. No
path mutates on a model's say-so.

| Mutation path                                | Authority checks before the mutation                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat → gated tool                            | route membership → discovery ceiling → **argument guard (before any approval opens)** → approval opened → decision authorized (§4) → **approved-argument binding** → executor ceiling + argument guard + side-effect guard → tool membership → service |
| Chat → workflow (hire/assign, create/assign) | as above for the workflow tool (one approval for the unit); inner steps run through the same `ToolExecutor` (argument guard) under the workflow approval; compensation only reverses this workflow's own steps                                         |
| Business agent run                           | `orchestrator.run` with the agent intent's `allowedCapabilityIds` → same pipeline                                                                                                                                                                      |
| Remediation plan step                        | `orchestrator.run` with the plan's capability ceiling and recorded approval → same pipeline                                                                                                                                                            |
| MCP read tool                                | session auth + membership → capability-filtered tool list → **argument policy (reserved keys, audited)** → strict schema → executor ceiling (bound to the advertised capability) + argument guard                                                      |
| MCP governed write                           | as MCP read → executor returns APPROVAL_REQUIRED → recorded approval → decision (§4) → execution uses the approval's **stored** input                                                                                                                  |
| Approval decision (REST)                     | `authorizeApprovalDecision`: requester, membership, `approvals.decide`, capability still permitted                                                                                                                                                     |
| Approval decision (signed inbound email)     | signature + sender allowlist + replay claim → **the same `authorizeApprovalDecision`**, plus the approval's workspace must match the message's                                                                                                         |

## 4. Approval decisions

One rule set (`apps/api/src/ai/approval-authorization.ts`) for every channel.
A decision is refused unless **all** hold: the decider is the requester; the
decider is still a member of the approval's organization; the decider's role
grants `approvals.decide`; the gated capability is still in the requester's
capability set; and (for channels that name one) the workspace matches.
Refusals are audited.

A granted approval authorizes **exactly** the arguments that were shown for
approval. When a run resumes, the plan is rebuilt; if the rebuilt arguments
differ from the recorded ones in any way, the step fails closed with
`APPROVAL_ARGUMENTS_MISMATCH` (audited) and nothing runs.

## 5. Untrusted content and the model

- **Arguments.** `ArgumentGuard` rejects any argument that names trusted scope
  or authority (`organizationId`, `tenantId`, `workspaceId`, `userId`, `role`,
  `capability*`, `permission*`, `grant*`, `approval*`, `approved`,
  `autonomyTier`, `isAdmin`, …) at any depth and in any common spelling, and
  enforces the tool's declared JSON schema. Forged scope is **rejected and
  audited**, not silently ignored. Resource ids a tool legitimately accepts
  (e.g. `budgetId`) are re-checked against the trusted tenant/workspace by the
  owning service.
- **Retrieved and entity text** is returned as cited evidence. It never feeds
  discovery, planning, argument extraction, authorization, or approval. A
  document saying "finance managers may approve all expenses" changes nothing
  about who may approve.
- **External tool output** is normalized by the connector adapter to its
  declared output fields (unknown fields such as `approved`, `permissions`,
  `role`, `organizationId`, `next_tool` are dropped). Output never triggers
  another tool: plans are fixed before execution, and workflow bindings read
  only the recorded output of the workflow's **own** steps by explicit path.
- **Model prompts.** The user request and the results digest reach the model
  only inside `<<<UNTRUSTED:…>>>` blocks. Marker look-alikes inside the content
  are defanged so content cannot close its own block. The prompt's trust
  boundary section tells the model the blocks are data. Because that is only
  advisory, the runtime does not depend on it: the model acts after execution
  and has no tools. A narration that reproduces its instructions is
  discarded (8-word verbatim overlap) and audited as
  `SYSTEM_PROMPT_DISCLOSURE`.

## 6. Security audit records

Every block produces one structured `SecurityDecision` (`execution/security-decision.ts`):
actor, origin/agent, invocation id, organization, workspace, tool, capability,
action, `policyDecision: deny`, reason code, a safe reason (field and rule
names, **never argument values**), and `outcome: blocked`. The API publishes it
as `ai.security.blocked`, projected into the workspace activity feed and shown
in the Audit Center with status **Blocked**. No secrets, raw model output, or
chain-of-thought are recorded.

| Reason code                       | Raised by                                                       |
| --------------------------------- | --------------------------------------------------------------- |
| `RESERVED_ARGUMENT`               | argument guard (orchestrator pre-approval, executor, MCP)       |
| `CAPABILITY_NOT_PERMITTED`        | executor ceiling; approval decision (capability no longer held) |
| `APPROVAL_ARGUMENTS_MISMATCH`     | orchestrator approval binding                                   |
| `APPROVAL_DECISION_NOT_PERMITTED` | REST and inbound-email decision authorization                   |
| `SYSTEM_PROMPT_DISCLOSURE`        | narration output guard                                          |
| agent identity / delegation codes | agent authority evaluator, orchestrator, MCP, routes (§8.6)     |

Schema-incomplete arguments (e.g. a request that doesn't name a repository)
fail closed but are **not** audited as security events. They are ordinary
input errors.

## 7. Tested attack classes, residual risks, assumptions

**Tested** (unit + API tests and evaluation scenarios NXS-008–011, 016–018, 020–031):
instruction override ("ignore previous instructions", "you are now the system
administrator"); hostile knowledge article, project description, employee
document, deployment runbook; hostile external tool output (GitHub) through
chat and through MCP; fake approval / fake capability claims in the request and
in retrieved text; forged workspace id in the message; forged organization id
in MCP tool arguments; forged scope/authority in model-shaped arguments;
approval of different arguments than were reviewed; approval decided by a
non-requester (email channel); system-prompt extraction; cross-tenant
retrieval; cross-workspace and cross-organization requests.

**Residual risks and limitations**

- **Narration can still be misled in wording.** With a model narrator
  configured, hostile retrieved text can still influence _how_ results are
  phrased (for example, summarizing a document's false claim). It cannot change
  what ran, and the grounding rules and deterministic fallback limit this, but
  natural-language manipulation of a model is not eliminated. The default
  deterministic composer quotes retrieved snippets verbatim and attributed, so
  a document's own false statements appear as quotes.
- **Disclosure detection is lexical.** Paraphrased or translated disclosure of
  the instructions is not detected. The instructions contain no secrets.
- **Fail-open capability ceiling for unmapped roles.** An empty trusted
  capability set means "not yet RBAC-restricted" (a documented S34 default).
  Membership checks, the side-effect guard, and approvals still apply.
- **Workflow inner steps** execute under the workflow unit's approval and are
  not each re-checked against the caller's capability ceiling. The workflow
  capability itself is ceiling-checked, and each inner tool still checks
  membership.
- **Deterministic intent/argument extraction is English-pattern based.** An
  unusual phrasing may clarify or fail closed. It never escalates.
- **Future model-driven tool calling** is not implemented. When it is, its
  proposals must enter at the argument-guard/approval stage of §2 and never
  bypass it; the guard and binding checks are placed to make that true.
- **Audit best-effort.** A failure to persist a security record never
  un-blocks the action, but the record can be lost if the event pipeline is down.

**Assumptions**

- Session authentication, OIDC, and membership data are correct.
- The inbound-email signing secret is secret; the email provider's `from`
  attribution is trustworthy once the signature verifies.
- Connector providers authenticate with the organization's own credentials;
  their **content** is untrusted, their transport identity is not in scope.

## 8. Agent identity and delegated capabilities (Prompt 4)

> **An agent is a principal that the server persists, not a label a request
> supplies. It holds no authority of its own: it may only do what a human
> delegated, only while that delegation is live, only inside the resource it
> names, and never more than the human — and the approval policy — allow.**

**Can an AI agent obtain authority simply by claiming it has authority?
No.** Every input that could carry a claim (an agent id in a path, header or
argument; a capability name; a delegation id; an approval id; an "I am
pre-approved" sentence in retrieved text) is treated as untrusted data. The
only way to act as an agent is to pass, **at execution time**, the
deterministic check in §8.3, whose inputs are all read server-side from
persisted state.

### 8.1 The model

| Concept    | Definition                                                                                                                                                                                                                         | Where                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Agent      | `AgentPrincipal`: id, organization, workspace, **definition** (the capability ceiling: `executive`, `manager`, `developer`, `finance`), name, description, status (`active` / `suspended` / `revoked`), owner, creator, timestamps | `platform/agents/src/identity`; table `agents`                   |
| Owner      | The user accountable for the agent. **Ownership is not authority**: an owner's agent still has no capability until a delegation says so, and the owner's own authority never flows to it implicitly.                               | `agents.owner_user_id`                                           |
| Delegation | `AgentDelegation`: agent, org, workspace, `grantedByUserId`, **one** capability, optional `resourceScope` (`{kind: project \| budget, id}`), `status` (`active` / `revoked`), `createdAt`, `expiresAt`, `revokedAt`, metadata      | table `agent_delegations` (FK to `agents`, `ON DELETE RESTRICT`) |
| Expiry     | **Derived, never stored.** `delegationEffectiveStatus(delegation, now)` returns `expired` when `expiresAt <= now`; the clock is the server's. A delegation can last at most 90 days.                                               | `identity/authority.ts`                                          |
| Run        | An agent run records the **initiating user** (who asked), the **agent**, the **delegation** that authorized each step, the organization, workspace, origin (`agent`, `mcp`, `rest`, `orchestrator`) and, when gated, the approval. | `agent_executions`, `approval_requests`, `workflow_instances`    |

### 8.2 Effective authority

For a step run as an agent, the effective authority is the **intersection** of:

1. an **active, unexpired delegation** for exactly that capability;
2. the **agent definition's** capability ceiling;
3. the **initiating user's** current capabilities (membership → role → catalog);
4. the **grantor's** current capabilities (a delegation is void if its
   grantor lost the capability — authority cannot outlive its source);
5. the agent's own **organization and workspace** (== the run's);
6. the **resource scope** of the delegation vs. the resources the step touches
   (resolved from trusted repositories, never from the model);
7. the **policy / approval** requirement of the capability's side-effect class
   (a delegation never replaces an approval).

Capabilities `approvals.decide`, `agents.manage`, `agents.delegate` and
`audit.read` are **non-delegable**: an agent can never approve, manage or
delegate, and can never widen another agent (see §8.8).

### 8.3 The single evaluation

`evaluateAgentAuthority` (`platform/agents/src/identity/authority.ts`) is a
pure function; there is **one** implementation, used for enforcement, for
delegation validation and for the inspect view. First refusal wins:

`AGENT_NOT_FOUND` → `AGENT_SUSPENDED` / `AGENT_REVOKED` → `AGENT_OUT_OF_SCOPE`
(organization or workspace) → `CAPABILITY_NOT_DELEGABLE` →
`CAPABILITY_OUTSIDE_AGENT_DEFINITION` → `INITIATOR_LACKS_CAPABILITY` →
`DELEGATION_MISSING` / `CAPABILITY_OUTSIDE_DELEGATION` → `DELEGATION_REVOKED` →
`DELEGATION_EXPIRED` → `DELEGATION_GRANTOR_LACKS_CAPABILITY` →
`DELEGATION_RESOURCE_OUT_OF_SCOPE`. A scoped grant requires the step to touch
at least one resource of its kind and **all** such resources to match;
resources that cannot be resolved fail closed.

### 8.4 Where it is enforced

| Point                                                             | Check                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/agents/:id/execute` and `/proposals/:id/execute`       | membership (org **and** workspace, strict) → `agent.execute` → principal resolved in the caller's organization (a foreign id is a 404) → workspace match → status                                                                                                                                                                                                                  |
| Orchestrator (pre-check)                                          | before any approval opens, the planned step is checked; a human is never asked to approve what the agent could not run                                                                                                                                                                                                                                                             |
| `ToolExecutor` (**every** invocation with an agent, at execution) | the `AgentAuthorityPort` (`apps/api/src/agent/agent-authority.ts`) re-loads the agent and its delegations, re-derives both humans' authority and re-resolves resources **at the moment of execution**. If the port is missing or throws, the call **fails closed** (`AGENT_AUTHORITY_UNAVAILABLE`).                                                                                |
| Approval resume (`POST /api/ai/approvals/:id/decision`)           | an approval opened by an agent resumes **as that agent** (never under the human's full ceiling); the resume must match the agent and capability (`AGENT_APPROVAL_MISMATCH`), and the delegation is re-checked, so revocation, expiry or suspension after approval blocks the run                                                                                                   |
| Argument guard                                                    | agent/principal/delegation/owner keys in arguments (`agentId`, `delegationId`, `onBehalfOf`, `actingAs`, `ownerUserId`, …) are `FORGED_AGENT_CONTEXT`                                                                                                                                                                                                                              |
| MCP (`/api/mcp`)                                                  | the `X-Nexora-Agent` header is a **claim**: it must name an agent of the caller's organization and (required) workspace, `active`, and the caller needs `agent.execute`; the session's tool list is narrowed to the agent's effective capabilities; execution is re-checked per call; stdio requires `NEXORA_MCP_AGENT_ID` and verifies membership + workspace ∈ tenant at startup |
| Workflows                                                         | the workflow instance and its steps record origin, agent, delegation and approval; inner steps run through the same executor                                                                                                                                                                                                                                                       |

### 8.5 Delegation management

`POST /api/agents/:id/delegations` is authorized server-side (`agents.manage`,
strict org + workspace membership) and **fails closed**: a request that
exceeds what it may grant is refused with the specific reason, **never
silently reduced** to something smaller. Refusals: capability not delegable,
outside the agent's definition, exceeds the grantor's own authority, resource
scope unsupported / not found in the tenant, invalid expiry, agent not active.
Revocation (`…/revoke`) and agent suspend / reactivate / revoke are authorized,
tenant + workspace scoped, audited, **idempotent** and **never delete**
records; a revoked agent is terminal. Every change publishes an `agent.*`
event, projected into the Audit Center.

### 8.6 Security decisions (audited as `ai.security.blocked`)

| Reason code                                                                    | Meaning                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `DELEGATION_MISSING` / `CAPABILITY_OUTSIDE_DELEGATION`                         | no delegation at all / delegations exist, none for this capability |
| `DELEGATION_EXPIRED` / `DELEGATION_REVOKED`                                    | the matching delegation is no longer live                          |
| `DELEGATION_RESOURCE_OUT_OF_SCOPE`                                             | the step touches a resource the delegation does not cover          |
| `DELEGATION_GRANTOR_LACKS_CAPABILITY` / `INITIATOR_LACKS_CAPABILITY`           | the authority behind the grant or the run no longer exists         |
| `DELEGATION_EXCEEDS_USER_AUTHORITY`                                            | grant attempt beyond the grantor's authority                       |
| `CAPABILITY_NOT_DELEGABLE` / `CAPABILITY_OUTSIDE_AGENT_DEFINITION`             | grant or use beyond what an agent may ever hold                    |
| `AGENT_NOT_FOUND` / `AGENT_OUT_OF_SCOPE` / `AGENT_SUSPENDED` / `AGENT_REVOKED` | identity problems (fabricated, foreign, workspace, status)         |
| `FORGED_AGENT_CONTEXT`                                                         | agent context supplied in arguments, or not matching the identity  |
| `AGENT_APPROVAL_MISMATCH`                                                      | an approval presented by a different principal / capability        |
| `AGENT_AUTHORITY_UNAVAILABLE`                                                  | the authority port is missing or failed (fail closed)              |
| `AGENT_TO_AGENT_NOT_SUPPORTED`                                                 | reserved for a future agent-to-agent path (none exists)            |

Records carry actor, agent id, delegation id (when known), organization,
workspace, tool/capability, action, decision, reason — **never** argument
values, secrets, credentials or model reasoning.

### 8.7 What the Audit Center answers

For an agent action the Audit Center (`GET /api/audit/events`, filterable by
`agentId`) shows: **who initiated** (actor), **which agent** (id, name,
definition), **which delegation(s)**, the **capability** and **object**, the
**workspace**, the **origin**, whether an **approval** was required and **who
approved** it, the **policy decision** (blocked events), **what executed**
(status) and whether it was **verified**; agent lifecycle events
(created / suspended / reactivated / revoked / delegation granted / revoked)
appear as activity. Scenario NXS-049 asserts this.

### 8.8 Agent-to-agent: not supported

There is **no** agent-to-agent path. An agent cannot call, spawn, message or
delegate to another agent; an agent cannot grant, manage or approve. The
capabilities that would make it possible (`agents.manage`, `agents.delegate`,
`approvals.decide`) are non-delegable. An approval opened by one agent cannot
be resumed by another agent, a human run, or another workspace
(`AGENT_APPROVAL_MISMATCH`). NXS-050 pins the boundary. If agent-to-agent is
ever added it must intersect authorities (never union them) and pass through
this same evaluator.

### 8.9 Residual risks and not supported (agents)

- **Not supported:** agent-to-agent delegation or calls; agents with their own
  credentials or sessions (an agent run always has a human initiator);
  time-of-day or rate-limit delegation conditions; delegation to resource
  kinds other than `project` and `budget`; sub-delegation; bulk import of
  delegations; delegation approval workflows (a grant is immediate).
- **Human cookie ⇒ human authority.** An MCP client that holds a human's
  session cookie can decide that human's own approvals through the REST
  decision route: cookie authentication is inherent to the session model.
  Agents have no credentials of their own, and an agent-bound run can never
  decide an approval, but a compromised human session is a compromised human.
- **The MCP session context is cached** without a TTL. Agent tool calls are
  re-checked on every call (revocation is immediate), but a cached
  capability _listing_ can be stale until the session reconnects.
- **Approvals do not expire.** Agent approvals are bounded by the delegation's
  expiry at execution time; human-run approvals keep their prior behaviour.
- **Composite workflow capabilities** (e.g. `workflow.hire_and_assign_employee`)
  authorize their inner steps as one unit: delegating the workflow capability
  delegates its fixed, code-declared steps. This is intentional (see §9.7);
  inner steps do pass through the policy engine. Resource scope for the
  workflow is the project it names.
- **Resource scope is limited** to `project` and `budget` and to capabilities
  that name one; a scoped grant on a capability that touches no such resource
  cannot be created.
- **The executor ceiling still fails open for an empty capability set** (the
  documented S34 default for unmapped roles). Agent runs are unaffected: they
  always require a matching delegation.
- **Remediation** is human-driven (not an agent principal) and is not bound to
  its creator; `requiredApproverRoleId` is not enforced there.
- **REST workflow start** has no approval gate or idempotency key (operator
  path; input keys are now restricted to those the definition declares).
- **The `developer` and `manager` roles lack `approvals.decide`**, so approvals
  opened by their agents cannot be decided by those users.
- **stdio MCP** is operator-trust: whoever launches the process chooses the
  identity, which is validated but not authenticated.
- The deterministic checks do not make a model trustworthy; they bound what a
  model-shaped request can cause. Prompt injection is mitigated by never
  granting authority from text — it is **not solved**.

**Enforcement invariants** (each has a test; the numbering is used in the
final review):

1. Agent identity comes only from a persisted, tenant-scoped record.
2. No request field, argument, header or model output supplies authority.
3. No agent runs without an active agent record in the run's workspace.
4. No step runs without a live, in-scope delegation for that capability.
5. Delegation ⊆ agent definition ⊆ grantor authority; refusals never shrink silently.
6. Effective authority also requires the initiator's current capability.
7. Expiry, revocation, suspension and grantor change apply at execution time.
8. Resource scope binds to trusted-resolved resources and fails closed.
9. A delegation never replaces an approval; consequential steps still gate.
10. No agent can decide, manage or delegate (non-delegable).
11. An approval executes only the approved arguments, for the same agent and capability.
12. Cross-workspace and cross-tenant agent ids resolve to nothing.
13. Every refusal is an audited security decision without secrets.
14. Revocation and suspension preserve history; nothing is deleted.
15. Runs, approvals and workflows record initiator, agent, delegation and origin.

## 9. Central policy engine (Prompt 5)

> **RBAC and agent delegation answer _who_. Policy answers _under what
> conditions_. Approval answers _whether a human must say yes to this exact
> action_. They are three different questions and three different layers;
> none of them can stand in for another.**

```
Identity → Scope → RBAC → Agent delegation → Resource scope
        → POLICY → Approval → Exact approved arguments
        → Execution → Verification → Audit
```

A concrete walk-through — a CEO delegates `finance.submit_expense` to the
Finance agent, which is asked to file a ₹75,000 expense against an open
budget:

| Step | Layer                            | Decision                                                                                                        |
| ---- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1    | Identity / scope                 | session user, organization, workspace — trusted server state                                                    |
| 2    | RBAC                             | the initiating user holds the capability → allow                                                                |
| 3    | Agent delegation                 | live delegation for exactly this capability, grantor still holds it → allow                                     |
| 4    | Policy                           | `POLICY_FINANCE_BUDGET_STATE` (open → not applicable); `POLICY_FINANCE_EXPENSE_APPROVAL` → REQUIRE_APPROVAL     |
| 5    | Approval                         | a gate opens **recording that policy decision**; a human decides through the approval surface                   |
| 6    | Exact approved arguments         | the same amount, currency, budget and description — anything else fails closed                                  |
| 7    | Re-check at execution            | user, agent, delegation, RBAC **and policy** are evaluated again                                                |
| 8    | Execution → Verification → Audit | the application layer mutates; the result is verified; the audit shows agent, delegation, policy id and version |

### 9.1 What existed before, and what is new

Policy was **not** centralized. The audit found: the approval-required rule
written twice (planner and executor, identical logic); a closed-budget rule
enforced only _after_ approval, at execution; segregation of duties inside the
expense aggregate; a hard-coded 90 % budget flag threshold copied into two
modules; per-route RBAC; and delegation checks. It also found that **no amount
threshold exists anywhere in code** — the "₹50,000 requires CFO approval"
sentence is text in a sample knowledge article (and a documented-but-
unimplemented product-spec idea), so this phase did not invent one.

New: one pure engine (`platform/policy`), one PolicyPort seam in the AI
runtime, and one fact-resolving API port shared by every surface. The old
approval rule now lives in exactly one function
(`sideEffectRequiresApproval`) that the planner, the executor and the engine
all call.

### 9.2 The decision contract

`PolicyRequest` — organization, workspace, initiating user, agent (if any),
capability, tool, action, side-effect class, autonomy tier, origin, the
approved arguments (operands only) and **trusted facts** resolved by the
server. `PolicyDecision` — `outcome` (`ALLOW` | `DENY` | `REQUIRE_APPROVAL`),
deciding `policyId` and `version`, `reasonCode`, a safe `reason`,
`matchedRules` (every rule that spoke), `approvalRequirement`, `constraints`,
`fingerprint` and `evaluatedAt`. The fingerprint is a stable digest of _which
rules at which versions decided what_: the same trusted state and request
always give the same fingerprint, and a resumed run compares it (§9.6).

### 9.3 Policies that exist

| Policy id                                                                                                        | Version | What it does                                                                                                                                                            | Source / status               |
| ---------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `POLICY_SIDE_EFFECT_APPROVAL`                                                                                    | 1       | side-effect class × autonomy tier: consequential always, state change unless autonomous, read-only never (BR-13, AC-3)                                                  | existed (twice); consolidated |
| `POLICY_FINANCE_EXPENSE_APPROVAL`                                                                                | 1       | money movement always needs human approval, whatever the amount (BR-19). **No threshold exists.**                                                                       | existed implicitly; now named |
| `POLICY_FINANCE_BUDGET_STATE`                                                                                    | 1       | expense against a closed or unresolvable budget → DENY (before any approval); budget under review → approval                                                            | domain rule moved earlier     |
| `POLICY_FINANCE_BUDGET_LIMIT`                                                                                    | 1+cfg   | **opt-in per organization**: an expense that would overrun the budget's allocation is denied (or needs approval). Absent config → not applicable; invalid config → DENY | new, default off              |
| `POLICY_AGENT_DELEGATION_SCOPE` / `_EXPIRY` / `_REQUIRED`, `POLICY_AGENT_IDENTITY`, `POLICY_AGENT_NON_DELEGABLE` | 1       | stable ids for the Prompt 4 agent authority denials (the evaluator is unchanged and still runs first)                                                                   | mapped, not re-implemented    |
| `POLICY_APPROVAL_SEPARATION`, `POLICY_WORKSPACE_SCOPE`, `POLICY_TENANT_ISOLATION`, `POLICY_ARGUMENT_TRUST`       | 1       | stable ids naming the approval-authorization, scope and argument-guard denials in the audit trail                                                                       | mapped                        |

Two things are deliberately **not** in the engine: domain state machines
(expense/budget transitions, segregation of duties on `decide`) stay in the
aggregates — they are invariants of the data, and no path can skip them — and
direct human REST actions (a person clicking "Submit expense") stay governed
by RBAC and the domain, exactly as before. The engine governs the **AI /
agent / MCP / workflow execution paths**, which is where a model can be
in the loop.

### 9.4 Order, precedence and conflicts

Order: RBAC ceiling → argument guard → agent authority (delegation, scope,
expiry) → **policy** → approval → approved-argument binding → execution.
A later layer never overrides an earlier denial: RBAC DENY, delegation DENY
and scope DENY short-circuit before policy is asked; policy DENY is final (an
approval can not override it, and a human is never asked to approve what
policy refuses); policy REQUIRE_APPROVAL opens the gate; policy ALLOW only
means "no policy objects" — RBAC, delegation, scope and approval still apply.

Conflicts between rules are resolved deterministically and independently of
registration, database or iteration order: **DENY beats REQUIRE_APPROVAL
beats ALLOW; among equal outcomes the lexicographically smallest policy id
decides.** Every matched rule is reported in that order.

### 9.5 Fail closed

- a rule that throws → DENY (`POLICY_EVALUATION_FAILED`);
- no rule applies → DENY (`POLICY_MISSING`);
- an incomplete request → DENY (`POLICY_CONTEXT_INCOMPLETE`);
- a budget that cannot be resolved in the trusted workspace (missing,
  foreign, other workspace — indistinguishable, so no oracle) → DENY;
- an organization configuration that cannot be understood → DENY
  (`POLICY_CONFIGURATION_INVALID`) — a broken policy never becomes "no policy";
- the policy port throwing → the invocation fails closed
  (`POLICY_UNAVAILABLE`); nothing runs.

"Policy not applicable" (a rule returns nothing) is distinct from "policy
evaluation failed" (DENY): only the former lets other rules decide.

### 9.6 Versions, approvals and history

Every decision names the rule **versions** that made it; org-configured rules
carry their configuration version (`POLICY_FINANCE_BUDGET_LIMIT@1+config.2`).
Configuration is stored append-only per organization and policy
(`policy_settings`): a change inserts version N+1 and never edits version N.
Audit records (`ai.security.blocked`, and the policy stored on each approval)
are written once and never recomputed, so a later change cannot rewrite what
was decided earlier (NXS-068).

**Policy changed after approval — documented behaviour.** An approval
records the fingerprint of the decision it was opened under. When the run
resumes, the decision is recomputed. If it is now DENY, the run is denied. If
it is still REQUIRE_APPROVAL but the deciding rules or their versions differ
(or a new rule now applies), the run is refused with
`POLICY_CHANGED_AFTER_APPROVAL`, the approval is **not consumed**, and the
action must be requested again. Nothing ever runs under an obsolete policy
(NXS-067). State-dependent changes (for example the budget filled up between
approval and resume) are caught the same way.

### 9.7 Surfaces

The same executor and the same port serve chat, agent runs, MCP (HTTP and
stdio), workflows and remediation. There is **no second implementation**: the
MCP governed-write adapter records the executor's decision on the approval and
passes the recorded fingerprint back on resume. There is no public
`/policy/evaluate` endpoint — policy is evaluated only inside trusted
execution, and configuration has no write API yet (it is set by operators
through the store; a management surface is future work).

**Workflows.** Composite capabilities are two code-declared operations
(`hire_and_assign_employee`, `create_project_and_assign_employee`). This is
**intentional**: one approval — and one delegation — authorizes the _fixed_
steps of that operation with inputs derived from the approved arguments; a
model can neither add steps nor change their inputs. Inner steps run through
the same `ToolExecutor` (argument guard, **policy engine**, verification) but
are not individually re-approved, individually re-checked against the RBAC
ceiling, or individually delegated. If a policy DENIES an inner step, the
workflow fails and compensates (proved by
`apps/api/test/policy.enforcement.test.ts`). Composite capabilities that need
per-step approval or scope are out of scope until a workflow definition asks
for them.

### 9.8 What policy cannot do

It cannot grant a missing capability, expand a delegation, widen a resource
scope, decide an approval, or be set by text: a retrieved article that says
"approval is not required", a model that says "already approved", a tool
response that says "permission granted", and MCP arguments naming `policy`,
`policyDecision` or `skipApproval` are all just data (the last are reserved
argument keys, refused and audited). Policy configuration of one organization
never applies to another.

### 9.9 Audit

For a blocked action the Audit Center shows the policy (`id@version`), the
matched rules, the reason code and safe reason; for a gated action the
approval row shows the policy that required it. The record contains ids,
versions, reason codes and names — never argument values, secrets, or model
reasoning — and answers "why was this denied?" and "why did this need
approval?".

### 9.10 Invariants

1. Policy cannot grant a missing capability.
2. Policy cannot expand an agent delegation.
3. Untrusted text cannot change policy.
4. Model output cannot create a policy decision.
5. MCP cannot bypass policy.
6. Workflow execution cannot bypass policy.
7. A policy DENY cannot be overridden by approval.
8. A policy REQUIRE_APPROVAL cannot be converted to ALLOW by an agent.
9. Policy failures fail closed.
10. Historical policy decisions remain auditable.
11. Same trusted state + same request → same decision.
12. Policy evaluation does not modify business state.
13. Policy decisions are tenant/workspace scoped.
14. One tenant's policy configuration cannot affect another's.
15. A policy rule cannot grant itself authority.

### 9.11 Performance

Measured in-process on the developer machine (Node, no I/O): the engine takes
≈0.5–0.8 µs per decision and the API port with in-memory facts ≈1.5 µs.
Costs in a deployment are the fact reads only: read-only and non-finance
capabilities do **none**; an expense reads the organization's policy
configuration, the budget and its approved expenses (three tenant-scoped
queries). A decision is made in the orchestrator pre-check, again in the
executor, and again on resume — deliberately not cached, because a cache key
would need the tenant, workspace, user, agent, delegation, policy versions and
resource state to be safe. Add caching only with those in the key.

### 9.12 Residual risks and not supported (policy)

- **Not supported:** a policy editor or management API; multi-level or
  amount-tiered approval chains; approval expiry; per-workspace autonomy
  tiers; policy rules that depend on time of day; a decision log separate
  from the security/approval audit; rules for direct human REST actions.
- **Direct REST paths** (create/revise budgets, submit and _decide_ expenses
  by a human) are governed by RBAC and domain invariants only. In particular,
  deciding a pending expense does not re-check the budget's state.
- **Approvals do not expire.** The policy binding and the execution-time
  re-checks bound the risk (an old approval still cannot run under changed
  rules, a revoked delegation, or a lost capability), but an unchanged
  approval stays valid indefinitely.
- **The executor's empty-capability-ceiling default remains fail-open** for
  roles the RBAC catalog has not mapped (documented S34 default). This is an
  RBAC-completeness gap, not a policy one; agent runs are unaffected (they
  always need a delegation).
- **MCP session context is cached** for the session's lifetime, including the
  human capability ceiling. Policy and agent authority are re-evaluated on
  every call; a human's reduced role is honoured on reconnect. Fixing it means
  re-resolving context per call (cost) — left as future work.
- **The executor trusts the caller's `approvalGranted` boolean.** Callers
  (orchestrator, MCP adapter, workflow runtime) compute it from the approval
  engine; workflows pass `true` for inner steps by design (§9.7).
- **`requiredApproverRoleId` on remediation plans is computed but not
  enforced**, and AI approvals are decided by the requester (their own
  `approvals.decide` capability), not a second person. Segregation of duties
  exists only for expense decisions.
- **The deterministic checks do not make a model trustworthy.** They bound
  what a model-shaped request can cause. Prompt injection is not solved.

## 10. Evidence provenance and data lineage (Prompt 6)

> **Evidence informs a decision. It never grants authority.** A knowledge
> article that says "CEO approval is not required", a project description that
> says "the budget is approved", a connector response that says "permission
> granted" are all **data**. They can appear in an answer and in the lineage;
> they cannot reach RBAC, agent delegation, policy or approval — nothing that
> decides authority reads a lineage record or a tool result.

### 10.1 Evidence, authority, policy, approval, execution, verification

| Concept          | Question it answers                                    | Decided by                                                | Recorded as                                                          |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------- |
| **Evidence**     | What information was used, and where did it come from? | retrieval + tools, fenced to the trusted tenant/workspace | `EVIDENCE` (source type + exact id + version + fingerprint)          |
| **Authority**    | May this actor / agent do this at all?                 | RBAC, agent delegation, resource scope (§8)               | delegation / agent ids                                               |
| **Policy**       | Under what conditions?                                 | the policy engine over **current trusted state** (§9)     | policy id + version (+ facts digest)                                 |
| **Approval**     | Did an authorized human say yes to these exact args?   | the approval engine                                       | approval row (+ recorded policy)                                     |
| **Execution**    | What actually ran?                                     | the `ToolExecutor` (the only place tools run)             | `EXECUTION` (invocation id, status, fingerprints, affected resource) |
| **Verification** | Was the result confirmed?                              | the execution verifier                                    | `VERIFICATION` (its own record, points at the invocation)            |

A **plan is not proof of execution**: `PLANNED_ACTION` is recorded when a step
is planned (before approval), `EXECUTION` only when a tool really ran, and
`VERIFICATION` separately. The Audit Center shows them separately.

### 10.2 A concrete lineage

The Finance agent, delegated `finance.submit_expense`, is asked for a ₹500
expense; the human approves:

```
request            "Submit an expense of 500 INR for stationery against budget …"
PLANNED_ACTION     finance.submit_expense · input fp 37e3… · policy POLICY_FINANCE_EXPENSE_APPROVAL@1 · approval apr_… · context fp 91e1…
  (approval)       apr_… — recorded policy, approved-arguments fingerprint 37e3…, decided by usr_…
EXECUTION          inv_… · succeeded · input fp 37e3… (== approved) · affected expense exp_… · approval apr_… · delegation dlg_…
VERIFICATION       of inv_… · verified: true
```

For an investigation-driven remediation the chain begins earlier: primary
`EVIDENCE` (runbook article `art_…`@version, detection facts) → a **derived**
`FINDING` that references those evidence ids → `LINK` step↔approval and
step↔run → the approval → the execution and its verification.

### 10.3 The record

One append-only, tenant-scoped table (`lineage_records`, migration 0021; no
foreign keys, matching the repository convention). Kinds: `EVIDENCE`,
`PLANNED_ACTION`, `EXECUTION`, `VERIFICATION`, `LINK`, `FINDING`. Each row
carries a run id, actor / agent / delegation / approval / invocation ids where
they exist, a subject (source type + exact source id, or tool id), a sha256
**fingerprint** of its canonical structured facts, and a compact `data` object.
It stores **ids, versions, timestamps and fingerprints — not raw documents,
tool outputs, snippets, secrets, or model reasoning** (a test checks that a
snippet and a secret-looking output field never appear in stored records).

- **Source identity.** `sourceType` (only kinds that exist: knowledge article,
  document, project, employee, budget, external connector, investigation,
  inbound message, tool/workflow result) plus the exact `sourceId`, the
  source's `version` / `updatedAt` when it has one, and the retrieval time.
- **Trust class** (`SYSTEM_STATE`, `PERSISTED_BUSINESS_RECORD`,
  `VERIFIED_TOOL_RESULT`, `KNOWLEDGE_CONTENT`, `EXTERNAL_CONTENT`,
  `USER_PROVIDED_CONTENT`) is **descriptive only**. `VERIFIED_TOOL_RESULT` means
  "a record of what a tool returned", not permission for anything.
- **Immutability.** Records are inserted, never updated (the repository has no
  update or delete; an id collision fails). A source that changes later does
  not rewrite history: a version-1 record stays version 1 with its fingerprint,
  and a later retrieval appends a version-2 record (NXS-083). Sources that
  cannot be versioned still carry the retrieval time and a fingerprint of the
  facts retrieved.
- **Fencing.** Retrieval is tenant- and workspace-scoped before any evidence
  exists. As defence in depth, evidence naming a workspace other than the run's
  trusted workspace is dropped (counted, never recorded); a forbidden source
  leaves no record of its existence, title, id or snippet (NXS-072, NXS-073).

### 10.4 Where lineage is written

Every path — chat, agent runs, MCP (HTTP and stdio), workflows, remediation —
runs tools through the `ToolExecutor`, which is the single chokepoint: it mints
an invocation id and reports one execution event per invocation that **really
ran** (attempts > 0; refusals before execution are security decisions, audited
separately). The API turns that into `EXECUTION` + `VERIFICATION` + one
`EVIDENCE` record per provenance item the result carried (knowledge and
document references, found projects/employees, connector items — external
content is `EXTERNAL_CONTENT`). The orchestrator reports `PLANNED_ACTION`
after approval resolution. Workflow inner steps carry their step id and
whether they are a forward step or a **compensation**, so a partial failure
reads as it happened: step 1 executed, step 2 failed, step 1 compensated
(NXS-077, 087, 088). Remediation records its basis at plan creation and replan
(primary evidence, and a **derived** `FINDING` that references it), and links
each step to its approval and to the run that executed it. A signed inbound
email records one `INBOUND_MESSAGE` evidence record **after** signature
verification (message id, sender fingerprint — never the address, action,
outcome); an "approved" in a payload is not an approval, only the verified
processing through the shared authorization can decide one.

Lineage is one-way and best-effort: a failing sink is swallowed, so lineage can
never change what runs or is refused, and no authorization path reads it.

### 10.5 The decision trace

`GET /api/audit/events/:eventId/trace` (same authorization as the event list:
organization and workspace membership plus `audit.read`) assembles, for an
approval / agent-execution / workflow-step event: the **request**, the
**evidence** (derived findings marked as derived), **authorization** (agent,
delegations, origin), the **policy** (recorded on the approval, or on the
lineage), the **approval** (who, when, fingerprint of the exact approved
arguments), **planned vs executed** (each execution says whether it ran
exactly the approved arguments), **verification**, and the ordered **lineage**.
It is a read model over existing records — it decides nothing, stores nothing,
and an id from another tenant is indistinguishable from a missing one (404).
There is no model reasoning anywhere in it.

The narration also reports which retrieved sources its results contained
(`sources` on the run response and the chat `done` event: ids, kinds, versions,
titles). That is a description of what was available to the answer, **not** a
claim-to-source proof: the claim-level grounding check remains lexical and
runs in the evaluation, not on live responses. Important execution-facing
claims are bounded by results that really ran and were verified; hallucination
is not eliminated.

### 10.6 Staleness

Evidence is explanatory context; **authority and policy always read current
trusted state**. Budget evidence gathered while a budget was active does not
authorize an expense after the budget closes: the resumed run's policy reads the
budget fresh and denies (NXS-084). A policy that changed after approval refuses
the approval (§9.6). Each policy decision records a digest of the facts it was
made over (`contextFingerprint`), so lineage shows a decision was made over
that state and a later one over different state.

### 10.7 Invariants

1. Evidence cannot grant authority.
2. Evidence cannot override RBAC.
3. Evidence cannot override agent delegation.
4. Evidence cannot override policy.
5. Evidence cannot create approval.
6. External connector responses cannot create approval.
7. Evidence is tenant scoped.
8. Evidence is workspace scoped.
9. Historical evidence cannot be silently rewritten.
10. Actual execution is distinct from planned execution.
11. Verification is distinct from execution.
12. Audit can trace sensitive execution to its source evidence.
13. AI-generated findings are distinguishable from primary source evidence.
14. Stale evidence cannot bypass current authorization/policy state.
15. Lineage does not expose secrets or chain-of-thought.

### 10.8 Residual risks and not supported (lineage)

- **Best-effort recording.** A failing lineage store loses records rather than
  blocking an action (by design: lineage must never affect authorization). A
  missing record is therefore possible; an invented one is not.
- **Reads before this phase have no lineage**; older approvals show a trace
  from what they recorded (policy, input fingerprint) without evidence.
- **Evidence is captured for the tools that exist** (knowledge/document search,
  project/employee lookup, GitHub/Slack). Other tool results are recorded as
  executions (with output fingerprints) but yield no evidence items.
- **Detection facts are not stored.** Investigation evidence is recomputed on
  read; the historical evidence of a remediation is the basis recorded at plan
  creation, not a reconstruction. The facts that made a _signal_ fire
  (`SignalDetection.facts`) are still dropped.
- **Claim-level provenance** (which sentence rests on which source) is not
  recorded; `sources` lists what the results contained.
- **Snippets are fingerprinted, not stored**, so "the exact text the model saw"
  can be verified against a re-derived snippet but not displayed from lineage.
- **Connector provenance is partial**: connector results carry no provider
  fetch time, etag, or connection id; the record uses the execution time and
  the item identity the provider returned.
- **Inbound webhooks:** only verified email/webhook messages are recorded (the
  tenant of an unsigned request is unknown); the shared-secret model and the
  claim-before-route ordering are unchanged (Prompt 5 residual).
- **Trace reads are bounded**: agent-execution and workflow-step events are
  resolved within the audit query window (up to 500 recent records).
- Workflow approvals of composite capabilities remain unit approvals (§9.7).

## 11. Runtime observability and execution telemetry (Prompt 7)

Three systems answer three different questions and are never blurred:

| System            | Question                                                                       | Store                           | Read by a decision? |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------- | ------------------- |
| **Audit**         | What happened? (who, what, when, outcome)                                      | activity / approvals / journals | No                  |
| **Lineage**       | What data / evidence / results were connected to it?                           | `lineage_records`               | No                  |
| **Observability** | How did the runtime **perform**? Where did the time go, and where did it fail? | `runtime_runs`                  | **No**              |

Observability never grants, denies, retries or re-routes anything. It is a
descriptive, append-only record of one orchestrated run (or one MCP tool call)
and is never an input to RBAC, agent delegation, policy or approval.

### 11.1 The run record

One immutable `runtime_runs` row per run: run id (the same id approvals,
lineage and audit use), HTTP request id, tenant / workspace, actor, agent,
origin (`chat` | `agent` | `mcp` | `remediation`), start / end / duration,
status (`completed` | `failed` | `blocked` | `clarification`), the failure
(stage, code, class) when it failed, per-stage timing, the model calls, the
tool calls, retrievals, policy references, the approval facts, token usage and
cost. **Only ids, codes, counts, durations and fingerprints are recorded** —
never prompts, tool arguments, documents, secrets, tokens, authorization
headers or model reasoning.

### 11.2 Stages

`REQUEST` (session + context), `PLANNING` (discovery + planner), `RETRIEVAL`,
`AUTHORIZATION` (agent authority), `POLICY`, `APPROVAL`, `EXECUTION`,
`VERIFICATION`, `NARRATION`; `TOTAL` is the run duration. A stage that did not
run is **absent**, never zero. The `ToolExecutor` — the single chokepoint every
path shares — reports its own segments (authorization, policy, execution,
verification) so time is attributed once, without double counting.

### 11.3 Correlation

`requestId` (Fastify) → `runId` → workflow `stepId` → `invocationId` (`inv_…`,
the same id lineage records) → `approvalId` → lineage record ids. Nothing new is
invented: the record references the ids other systems already own. An MCP
session shares one correlation id across many calls, so each MCP tool call is
its own observed run (filed under a per-call key); approvals and lineage keep
using the session id.

### 11.4 Model telemetry

Provider, model, **local vs cloud** execution (a fact declared by the adapter:
Ollama-compatible = `local`, Groq = `cloud`), start offset and duration,
success / failure, the failure code (`MODEL_TIMEOUT` vs `MODEL_ERROR`), the
narration source (`model` / `fallback`) with the fallback reason, the narration
prompt template id and version, and sha256 **fingerprints** of the input and the
output. Token counts are recorded **only when the provider reported them**;
otherwise `usageAvailable=false` and no token fields exist (never an estimate).
Cost is computed only from trusted, versioned pricing configuration
(`NEXORA_MODEL_PRICING`) and only when usage was reported; otherwise it is
`null`. Nexora ships no prices.

### 11.5 Tool, retrieval, policy, approval telemetry

- **Tool calls** (only tools that actually ran): invocation id, tool, origin,
  start offset, duration, status (`succeeded` / `failed` / `unverified`), error
  code, attempts and per-attempt retry records, verified flag and verification
  time, the policy reference, delegation id, approval id, workflow step.
- **Retrievals** (`knowledge.search`, `documents.search`): retrieval id, source
  type, result count, duration, status — never contents.
- **Policy**: policy id, version, decision and evaluation time — a reference
  only; policy remains authoritative and is read from its own records.
- **Approval**: `opened` (gate created) and `resumed` (executed after a
  decision) with `createdAt`, `decidedAt`, `decision` and `waitMs`. The human
  wait is recorded as approval time and is **never** part of the resumed run's
  own latency (`durationMs < waitMs` is asserted by NXS-095). The approval
  stage's own handling time is separate from the human wait.

### 11.6 Failure taxonomy

`failure = {stage, code, class}` answers "where did it fail?". Classes: `DENIED`
(RBAC, agent authority, policy, argument guard — working as designed),
`APPROVAL`, `INPUT`, `EXECUTION`, `VERIFICATION`, `INFRASTRUCTURE`, `TIMEOUT`,
`INTERNAL`. Codes (each derived from a real failure path): `RBAC_DENIED`,
`AGENT_DENIED`, `ARGUMENT_TRUST_VIOLATION`, `POLICY_DENIED`, `POLICY_UNAVAILABLE`,
`POLICY_CHANGED_AFTER_APPROVAL`, `APPROVAL_MISMATCH`, `TOOL_ARGUMENT_INVALID`,
`TOOL_EXECUTION_FAILED`, `TOOL_TIMEOUT`, `RETRIEVAL_FAILED`, `WORKFLOW_FAILED`,
`CONNECTOR_UNAVAILABLE`, `VERIFICATION_FAILED`, `MODEL_ERROR`, `MODEL_TIMEOUT`,
`REQUEST_INVALID`, `INTERNAL_ERROR`. A security block is therefore never
confused with an infrastructure failure (NXS-109), and `INTERNAL_ERROR` is only
used for genuinely unclassified errors. Only the code — never a message or a
stack — reaches the record or the operator.

### 11.7 Retries and timeouts (what is and is not wired)

Retries are recorded per attempt (attempt, error code, backoff, reason
`TRANSIENT_INFRASTRUCTURE`). Retries apply only to idempotent tools with a
retryable transient error, and **never** to an authorization, delegation,
policy, approval or argument refusal (those return before any attempt).
**No retry policy is configured in production today**, so every recorded tool
call reports `attempts = 1` and no retries (NXS-097 asserts this: no hidden
retries); retry recording is unit-tested with a configured policy. The model
transport enforces a 60 s timeout and reports it as `MODEL_TIMEOUT`. **Tool,
connector, workflow and MCP timeouts are not enforced** (no timeout policy is
configured); a configured `TimeoutPolicy` already classifies as `TOOL_TIMEOUT`.

### 11.8 Storage, isolation, operator view

Append-only `runtime_runs` (migration `0022`, additive) with indexes on tenant,
tenant + workspace + time, status, failure stage, provider + model, agent and
request id; there is no update or delete path. Reads are tenant-scoped; a run id
from another tenant is indistinguishable from a missing one (404). Operator
endpoints reuse the Audit Center authorization (organization + workspace
membership + `audit.read`): `GET /api/ops/runtime/runs`, `/runs/:runId`
(timeline + bottleneck computed from that run's own timings, not averages) and
`/metrics` (requests, success / failure, avg / p50 / p95 / p99, tool / model
failure rates, policy denials, approval wait, tokens, cost — over an explicit
window and tenant scope; a truncated sample is flagged). Model statistics
compare; they never rank. There is no alerting platform (see 11.10).

### 11.9 Invariants

1. Observability cannot change authorization, policy, approval or execution.
2. Telemetry is never an authority source; no decision path reads it.
3. Telemetry cannot expose secrets, prompts, arguments, documents or reasoning.
4. A failing telemetry sink cannot fail or alter a run (best-effort).
5. Unknown facts stay unknown: usage `false`, cost `null`, unused stages absent.
6. Telemetry is tenant scoped; a foreign run is indistinguishable from a missing one.
7. Human approval wait is not execution or model latency.
8. Policy denials and security blocks are never retried.
9. Runs are immutable once recorded.

### 11.10 Residual risks and not supported (observability)

- **Best-effort recording**: a failing store loses a run record rather than
  blocking a request; an invented record is not possible.
- **No production retry or tool-timeout policy** (see 11.7).
- **The blocked run and its resumed run are two records** joined by the approval
  id (the approval record is the join key); there is no single run spanning the
  human wait.
- **Expiry (added in Prompt 8):** an `expired` approval state now exists and is recorded; see §12.5.
- **Remediation verification** (problem still present after a successful step)
  lives on the remediation plan; the run records the step as succeeded. A run is
  classified `VERIFICATION_FAILED` only when the executor's verifier rejects a
  reported success (a custom verifier), which the default verifier does not do.
- **Only narration uses a model today**, so a run has at most one model call.
- **Metrics are computed on read** over at most 5,000 recent runs of the window
  (flagged `truncated`); there is no pre-aggregation, retention job or alerting.
- **Deterministic narration** (no provider configured) records no model call.
- **In-flight runs are not visible** until they finish; a crashed process loses
  its in-flight collectors.

## 12. Policy administration and approval governance (Prompt 8)

Prompt 8 closes two gaps that the earlier phases documented as residual: policy
configuration had no administrative surface (a single hard-coded configurable
policy, no write route), and approval decisions had a single model — the
requester approves their own request. The guiding rules:

- **The AI is not authority.** No AI tool, MCP tool, agent capability or chat
  path can read or change policy.
- **Policy does not grant authority.** A policy can only constrain. RBAC,
  delegation and membership still decide who may act.
- **Approval never overrides a policy DENY.** DENY is final, before and after
  approval.
- **The backend is the final authority.** Every input below is trusted
  server-side state, never a request body field, header, model claim or UI flag.

No parallel authorization system was added: administration reuses RBAC
(`authorizePermission`), the `PolicyPort`, the `ApprovalEngine`, the Audit
Center activity feed, lineage and observability.

### 12.1 The administration model

- **Registry.** `POLICY_REGISTRY` (`platform/policy/src/registry.ts`) lists every
  policy id with title, description, `configurable`, `managedBy`
  (`platform` | `organization`), static `ruleVersion`, `behavior` and `layer`
  (`engine` | `enforcement`). Sorted by policy id; the engine's default rule ids
  are asserted to all be present.
- **Only two policies are configurable**: `POLICY_FINANCE_BUDGET_LIMIT`
  (`{ mode: 'deny' | 'require_approval' }`) and `POLICY_APPROVAL_AUTHORITY`
  (12.4). Every other policy is platform-managed and shown read-only; a write
  attempt is refused with `POLICY_NOT_CONFIGURABLE`.
- **Capabilities.** `policy.read` and `policy.manage` (platform/domains seed).
  `policy.manage`: `executive.ceo`, `legal.general_counsel`. `policy.read`: those
  two plus `legal.compliance_manager` and `finance.cfo`. Both are in
  `NON_DELEGABLE_CAPABILITIES` (`platform/agents/src/identity/authority.ts`) and
  appear on no AI tool, so an agent delegation can never carry them.
- **Routes** (`apps/api/src/routes/policy.ts`, `/api/policy/*`): list, history,
  create-version. Each requires authentication, organization membership,
  workspace membership, then the RBAC capability — the same model as the Audit
  Center. A caller lacking the capability gets 403 and the attempt is audited
  (`policy.admin_denied`), written only after scope membership was verified so a
  forged scope cannot write into another tenant's feed.
- **Service.** `PolicyAdminService` (`apps/api/src/policy/policy-admin-service.ts`)
  is the ONLY writer of organization policy configuration.

### 12.2 Versioning, history and immutability

`policy_settings` is append-only (migration `0023` adds `enabled`, `reason`,
`config_hash`, `change_type`). The repository has no update or delete. Every
change is a new version:

- `change_type`: `created` (first version), `version` (config change), `enabled`,
  `disabled`. Enabling or disabling is a new version that copies the previous
  configuration; nothing is edited in place.
- `config_hash` is the sha256 of the canonical configuration JSON, so a version
  can be identified without reading values.
- `expectedVersion` gives optimistic concurrency: a mismatch is 409
  `POLICY_VERSION_CONFLICT`. The store retries only on a unique-violation.
- A disabled configuration means "the rule does not apply". This is safe because
  configuration only tightens (12.3); the platform default remains.
- **Historical decisions keep their original version.** Decisions, approvals,
  lineage and audit records store the `policyId` and `policyVersion` (and the
  context fingerprint) they were made under. A new version never rewrites them;
  history (`GET .../history`) is newest first.

### 12.3 Configuration validation and tighten-only

Configuration is data, never code. `validatePolicyConfig`
(`platform/policy/src/config-validation.ts`) is a strict allow-list run before
anything is written:

- exact keys only (unknown keys rejected), exact types, enums, integers within
  bounds, and id-like strings (`^[a-z][a-z0-9_.:-]{0,79}$`);
- size cap of 8192 bytes of JSON and nesting depth of 4; only plain data (no
  functions, non-finite numbers, or prototype tricks such as `__proto__`);
- any string or key with executable-looking content (`${`, `{{`, backtick,
  `<script`, `;`, `--`, `$(`, newline) is rejected;
- rejections are 422 `POLICY_CONFIG_INVALID` and list JSON paths and the rule
  broken, never the offending value.

The persisted configuration is parsed again by the reader with the same strict
shape; anything it cannot understand fails closed rather than being guessed at.

**Tighten-only.** A configuration can make an action stricter (deny instead of
approve; require a role; require separation of duties; shorten a TTL). It has no
field that can allow something a platform rule denies, remove an approval the
platform requires, or widen anyone's capabilities. There is no per-policy ABAC
or free-form rule editor (12.10).

### 12.4 Approval authority

Approval authority answers: who may decide this approval, and for how long is it
valid? It is the configurable `POLICY_APPROVAL_AUTHORITY`:

```
{ rules: [{ capabilityPrefix, separationOfDuties?, requiredApproverRoleId?, ttlMinutes? }] }
```

Up to 20 rules, unique prefixes, `ttlMinutes` 1..10080. When enabled and a
decision would REQUIRE_APPROVAL, the longest matching `capabilityPrefix` wins and
the `PolicyDecision` carries an `approval` requirement
(`separationOfDuties`, `requiredApproverRoleId?`, `ttlMinutes?`,
`policyId`, `policyVersion`). It applies only to actions that already require
approval; it cannot make a read-only action require one, and it cannot allow
what is denied. Its version is recorded as `<rule version>+config.<n>`.

The requirement is copied onto the approval record when it opens
(`requiredApproverRoleId`, `separationOfDuties`, `expiresAt`), so a later policy
edit does not silently change an open approval (see 12.6).

Three things are kept distinct and each is independently verified:

| Role in the flow       | Meaning                                              | Where it comes from                   |
| ---------------------- | ---------------------------------------------------- | ------------------------------------- |
| Requester              | Whose authority the action runs under                | The approval record (`userId`)        |
| Required approver role | The role a decider must hold in the approval's space | The policy requirement, on the record |
| Actual approver        | The authenticated user making the decision           | The session, never the body           |

`authorizeApprovalDecision` (`apps/api/src/ai/approval-authorization.ts`) is the
single rule set shared by the REST decision route, the signed inbound-email
decision path and the pending list's `canDecide`. A decision (approve or reject)
is allowed only when ALL hold:

1. the decider is an authenticated member of the approval's organization and
   workspace (and the channel's workspace, if it names one, is the approval's);
2. the decider's trusted role grants `approvals.decide` in that workspace;
3. the approval is not expired;
4. if the approval has a required approver role, the decider's RESOLVED role in
   that workspace equals it (`WRONG_APPROVER_ROLE`) — a requester with another
   role is not valid, and neither is an arbitrary `approvals.decide` holder;
5. if the approval has separation of duties, decider !== requester
   (`SELF_APPROVAL_FORBIDDEN`);
6. legacy approvals (neither 4 nor 5): the decider must be the requester
   (`NOT_REQUESTER`), unchanged from before;
7. the gated capability is still within the REQUESTER's effective capability set
   (`CAPABILITY_NOT_PERMITTED`).

The resumed run executes AS the requester, never as the approver: an approver
grants, they do not lend authority. Refusals are audited as `ai.security.blocked`
(action `approval.decide`, with the reason code) — the record of an unauthorized
approval attempt. Any `role`, `approver` or `authority` value in the request body
is ignored (the body schema is `{ decision, reason? }`).

Remediation: a plan step's `requiredApproverRoleId` (platform/remediation
approval routing) is now passed to `approvals.open` and enforced with separation
of duties on, so it is no longer decorative.

### 12.5 Expiry semantics

- **TTL.** Default 24 hours (`APPROVAL_DEFAULT_TTL_MS`), overridable per
  requirement (`ttlMinutes`). `expiresAt` is stored on the approval
  (`approval_requests.expires_at`).
- **Deterministic.** The engine takes an injectable clock; an approval is expired
  when `now >= expiresAt` and its status can still expire
  (`awaiting_approval`, `proposed`, `approved`). A claimed, completed, failed or
  rejected approval cannot expire.
- **Idempotent.** `expire(id)`, the lazy read check, `decide` and `expireDue()`
  flip a due approval to `expired` exactly once; only the call that persisted the
  transition reports `transitioned` and publishes `approval.expired`. A second
  sweep returns nothing.
- **Never authorizes.** decide returns `expired` (HTTP 410); `claim` refuses;
  `decisionStatus` reports `expired`; a resume fails the step `APPROVAL_EXPIRED`.
  An approved-but-unexecuted approval past `expiresAt` is not claimable.
- **Sweeps are lazy.** The pending list, decision route and resume paths sweep
  or check on use; there is no background scheduler (12.10).
- **Resume revalidates everything** before execution: tenant, workspace, the
  requester/session, agent and delegation (still active and unexpired), the
  policy fingerprint, the approved arguments, the approval state and expiry, and
  the decider authority stored at decision time. Any failure blocks the action.
- **Policy changed after approval.** A new policy version that changes the
  decision fingerprint makes the resume fail `POLICY_CHANGED_AFTER_APPROVAL`
  (audited, approval not consumed). A tightening that turns the action into a
  DENY is final at resume. Approvals do not silently adopt or ignore the change.

### 12.6 Workflow (composite) semantics

A workflow capability is authorized and approved as ONE unit. Approval of the
composite is a decision to run the whole declared workflow, so inner steps are
not asked again; but each inner step is additionally:

- validated against its schema and the argument guard;
- bounded by the initiator's RBAC ceiling: the ceiling
  (`workflow_instances.allowed_capability_ids`, migration `0024`) is computed at
  start from the initiator's trusted capabilities (intersected with the run's own
  ceiling for an agent), the initiator must hold every inner capability, and the
  ceiling is threaded into every inner invocation and compensation. An instance
  with no ceiling permits nothing;
- scoped to the trusted tenant and workspace;
- evaluated by the central policy with origin `workflow` — DENY is final and
  fails the workflow; an inner REQUIRE_APPROVAL is deliberately satisfied by the
  workflow-level approval;
- attributed: inner steps carry the initiating actor, agent and approval ids into
  lineage, and compensations obey the same bounds.

**Why composite approval is safe.** The approval cannot widen authority (the
ceiling bounds every step by what the initiator could do directly), cannot
override a DENY, and covers only the declared, fingerprinted workflow. The
approver sees the composite as one action; the residual risk is that they are
not asked about each inner step (12.10).

### 12.7 Direct human vs AI execution

A direct human REST call is never a way around a policy DENY. Every mutating
route is classified in `REST_MUTATION_CLASSES` and a tripwire test fails when a
new one is unclassified.

| Class                  | Routes                                                | Controls                                                            |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `rbac`                 | reads, self-service, low-risk content, administration | membership + RBAC capability                                        |
| `rbac+policy`          | finance expense POST, workflow start                  | + `PolicyPort` with origin `rest` (`enforceRestPolicy`)             |
| `rbac+policy+approval` | AI chat, agent execute, MCP, workflow (AI path)       | + approval engine for consequential tools                           |
| `sod`                  | approval decision, expense decide                     | decider authority derived server-side (`authorizeApprovalDecision`) |

On REST, DENY is 403 `POLICY_DENIED` (audited, origin `rest`); engine failure is
503 `POLICY_UNAVAILABLE` (fail closed); REQUIRE_APPROVAL is returned to the route.
Expenses have their own submitted-then-decided flow, which is the approval; a
composite route (workflow) refuses with 409 `APPROVAL_REQUIRED` unless only the
baseline side-effect gate applies (which a direct human action satisfies).

### 12.8 Tenant and workspace isolation

Every policy and approval read or write is scoped by the membership-verified
organization and workspace. `policy_settings` and `approval_requests` are
tenant-keyed; an id from another tenant is indistinguishable from a missing one
(404). Policy configuration is per organization: one tenant's configuration never
enters another's facts. The pending list only shows the caller's workspace, and
`canDecide` is computed for the caller by the same server function as the
decision.

### 12.9 Audit, lineage and observability

- **Audit** (activity feed): `policy.version_created`, `policy.enabled`,
  `policy.disabled`, `policy.admin_denied`, `approval.granted`,
  `approval.rejected`, `approval.expired` (each published once per transition),
  plus the existing `approval_requests` rows and `ai.security.blocked`. Bodies
  carry ids, versions, change type, hashes and actor — never configuration
  values.
- **Lineage**: approval and execution records keep the policy id and version and
  the approval id; historical records are never rewritten.
- **Observability**: `ApprovalTiming.state` gains `expired`; the failure code
  `APPROVAL_EXPIRED` (stage APPROVAL, class APPROVAL); the summary adds
  approvals opened / resumed / rejected / expired and counts by failure code.
  Correlate by run id, approval id and invocation id. No prompts or payloads.
- **Boundary.** Audit says what happened, lineage what was connected,
  observability how the runtime performed. None is an authority source: no
  decision reads telemetry.

### 12.10 Invariants

1. The AI cannot administer policy unless an explicit authorized capability
   exists — none does (`policy.read` / `policy.manage` are non-delegable and on
   no AI tool).
2. Policy cannot grant authority; it can only constrain.
3. An approval cannot override a policy DENY, before or after approval.
4. Approval authority is independently verified server-side from trusted state;
   nothing in a request body, header or model output is read.
5. Expired approvals never authorize (decide, claim or resume).
6. Historical decisions retain their original policy version; versions are
   append-only.
7. Telemetry is never an authority source.
8. Policy configuration is data: allow-list validated, tighten-only, tenant
   scoped, and fails closed when unparseable.

### 12.11 Residual risks and not supported (policy administration)

- **Legacy approvals** created before migration `0023` have no `expires_at`; they
  read as `created_at` + 24h (the default TTL), so an old open approval may expire
  sooner than a reader expects.
- **Remediation SoD consequence.** A remediation step with a required approver
  role has separation of duties on: the person who opened the plan cannot decide
  it, even if they hold the role. Operators need a second qualified person.
- **REQUIRE_APPROVAL on REST expenses is the domain's own decide flow**, not the
  AI approval engine; the two are related, not merged.
- **Only two policies are configurable.** Everything else is platform-managed and
  changes only with a code release; NON-configurable rules cannot be edited or
  disabled from the admin surface.
- **No per-policy ABAC editor** or arbitrary rule authoring, by design.
- **Sweeps are lazy, not scheduled.** An expired approval is persisted as
  `expired` when something touches it (read, decide, claim, list); until then it
  is reported as expired on read but the audit event is not yet published.
- **Composite approval is one decision.** Approvers do not approve inner steps
  individually; the ceiling and policy bound them but a workflow is trusted as
  declared.
- **Approver role is an exact role id match**; there is no role hierarchy or
  group of approvers, and no quorum (multi-approver) rule.
- **No delegation of policy administration** and no change-approval workflow for
  policy edits (two-person control of the policy itself); history and audit are
  the control.

## 13. Governed business execution (Prompt 9)

The full lifecycle, state machine, actor model, verification table, traced flows
and residual risks are in [`GOVERNED_EXECUTION.md`](./GOVERNED_EXECUTION.md).
This section states the invariants and the boundaries.

### 13.1 Invariants

1. **The approver never becomes the executor.** The person who decides an
   approval is recorded descriptively (`approval.decidedBy`, lineage `approvedBy`,
   `RuntimeRun.approval.decidedBy`). Lineage `actorId` stays the requester and the
   resumed run executes as the requester (or as the agent acting for them). No
   authorization path reads `approvedBy`.
2. **An agent is never the requester.** The requester is the human principal; the
   agent and delegation are recorded beside them. A resumed agent approval runs
   under the requester's ceiling **narrowed** to the agent's effective
   capabilities (plus the gated capability, so a revoked delegation is refused
   with its specific reason at execution time).
3. **Approved arguments are exact.** Execution requires canonical equality
   between the stored approval input and the step input. Any change (arguments,
   plan, policy fingerprint, expiry) means a new approval, never a stretched one.
4. **An approval named by a run must be consumed.** If no bound step consumes it,
   the run fails `APPROVAL_NOT_BOUND` (audited, approval left unclaimed); it is
   never silently completed and never executed around.
5. **The approval state machine is one table.** `APPROVAL_TRANSITIONS` governs
   the in-memory engine and derives the durable engine's conditional updates;
   terminal states have no outgoing edge.
6. **Verification is honest.** A tool declares how it verifies
   (`state_readback`, `provider_readback`, `response_shape`, `handler_result`,
   `redetection`) and what that does not prove; the runtime records only the
   declared source. A read-back tool whose handler lies is `UNVERIFIED`. Tools
   without a read-back say `handler_result` with a limitation.
7. **Composite approval does not launder inner governance.** If organization
   approval governance targets an inner step and the unit approval does not
   cover it (same or stricter role, separation of duties, no longer lifetime), the
   composite is refused (`WORKFLOW_INNER_APPROVAL_UNCOVERED`) before any step
   runs; an inner DENY refuses too.
8. **Arguments are inspected to a bounded depth or refused.** Nesting deeper than
   `MAX_ARGUMENT_DEPTH` fails closed (`ARGUMENT_TOO_DEEP`); a reserved key cannot
   hide below the inspected depth.
9. **Lineage, audit and observability are read models.** They carry ids,
   statuses, fingerprints and declared verification only; they are joined
   server-side, tenant-scoped (run governance block, decision trace `actors`),
   and are never an authorization input. A write failure is a gap, not a grant.
10. **Direct human is not a bypass.** Every REST mutation is classified
    (`rbac`, `policy_enforced`, `approval_enforced`, `domain_governed`, `exempt`)
    with a code proof; a policy DENY that applies on the AI path applies on
    `policy_enforced` REST routes.

### 13.2 Boundaries

| Concern       | Authoritative for                      | Not authoritative for                                    |
| ------------- | -------------------------------------- | -------------------------------------------------------- |
| Approval row  | Who decided, what was approved, status | What later ran (that is lineage)                         |
| Lineage       | What was planned, executed, verified   | Who may do it (never read by authorization)              |
| Audit / trace | Preservation and explanation           | Any decision                                             |
| Observability | How the runtime performed, correlation | Any decision; it holds fingerprints, never raw arguments |

### 13.3 Residual risks

See `GOVERNED_EXECUTION.md` §11: lazy expiry, a stuck `executing` approval has no
reaper, `handler_result` tools lack independent verification, the budget approve
check covers "closed" only and has a check/write window, MCP terminal
re-request is scoped to later runs, workflow inner steps are not individually
delegated (composite inner steps also lack their own `approvedBy`),
remediation has no compensation, and inbound email approval relies on one shared
HMAC secret.

## Demo mode (`NEXORA_DEMO_MODE`)

Demo mode adds **no trust**. It seeds one deterministic organization and lets a
presenter sign in as one of four seeded accounts through `POST /api/demo/login`,
which accepts only a persona key from a server-side allowlist and mints a real
session through the same identity service as OIDC. From that point on the
request is indistinguishable from any other authenticated request: membership,
capability ceiling, central policy, approval authority (separation of duties and
required approver role), verification, lineage and audit all apply unchanged.
The Guided Demo UI is a read model over persisted state: it never marks a step
complete because a button was pressed. `POST /api/demo/reset` targets only the
seeded organization, refuses any client-named target, and is unavailable
(501) without PostgreSQL. With the flag off, the endpoints do not exist.
