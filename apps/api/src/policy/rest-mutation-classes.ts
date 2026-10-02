/**
 * @nexora/app-api — the classification of every REST mutation (Prompt 8, extended in Prompt 9).
 *
 * "Direct human vs AI execution": the AI is never authority, and a direct
 * human REST call is never a way around a policy DENY. Every mutating route
 * (`POST`/`PUT`/`PATCH`/`DELETE`) is classified here with the controls that
 * gate it, and a tripwire test (`rest-mutation-classes.test.ts`) fails when a
 * new mutating route is added without an entry, when a `policy_enforced` route
 * does not call `enforceRestPolicy`, or when any entry's CODE PROOF (below) is
 * no longer true of the source.
 *
 * | class               | meaning |
 * | ------------------- | ------- |
 * | `rbac`              | membership + the RBAC capability. No policy rule governs the capability (no DENY rule exists for it), and the direct authenticated human action is the decision. Includes self-scoped actions and ownership-scoped ones. |
 * | `policy_enforced`   | + the central PolicyPort with origin `rest` (`enforceRestPolicy`): a policy DENY is final for a human too. |
 * | `approval_enforced` | the governed AI/agent/MCP/plan path (consequential tools are gated by the approval engine; approval never overrides a DENY) — or the approval decision itself, whose decider authority is derived server-side. |
 * | `domain_governed`   | RBAC + an invariant the DOMAIN aggregate enforces regardless of caller (separation of duties on expenses, budget lifecycle). Single-actor loosening, where it exists, is documented in `residual`. |
 * | `exempt`            | deliberately outside RBAC (no session), with the alternative control named and proven (a signed inbound webhook). |
 *
 * `legacyClassOf` keeps the Prompt 8 vocabulary (`rbac` | `rbac+policy` |
 * `rbac+policy+approval` | `sod`) derivable, so consumers of the old names and
 * the original tripwire semantics stay meaningful.
 */

/** The control class of a mutating route. */
export type RestMutationClass =
  'rbac' | 'policy_enforced' | 'approval_enforced' | 'domain_governed' | 'exempt';

/** The Prompt 8 class vocabulary (kept derivable, see {@link legacyClassOf}). */
export type LegacyRestMutationClass = 'rbac' | 'rbac+policy' | 'rbac+policy+approval' | 'sod';

/**
 * A fact about the source that must stay true for the classification to hold.
 * `in: 'route'` checks the route's own handler source; any other value is a
 * path relative to the repository root.
 */
export interface RestMutationProof {
  in: 'route' | string;
  contains: string;
}

/** One classified route. */
export interface RestMutationEntry {
  class: RestMutationClass;
  /** Why this class is the right (and sufficient) one. */
  justification: string;
  /** Source facts that back the justification (verified by the tripwire test). */
  proof: readonly RestMutationProof[];
  /** A documented residual risk / known limitation, when the control is weaker than it may look. */
  residual?: string;
}

/** Maps the extended class onto the Prompt 8 vocabulary. */
export function legacyClassOf(entry: RestMutationEntry): LegacyRestMutationClass {
  switch (entry.class) {
    case 'policy_enforced':
      return 'rbac+policy';
    case 'approval_enforced':
      return 'rbac+policy+approval';
    case 'domain_governed':
      return 'sod';
    default:
      return 'rbac';
  }
}

const cap = (capability: string): RestMutationProof => ({
  in: 'route',
  contains: `'${capability}'`,
});

const RBAC_LOW_RISK =
  'Direct authenticated human action on low-risk business content; membership + RBAC capability; no policy rule governs this capability.';

/** Route pattern (`METHOD /path`) -> classification. */
export const REST_MUTATION_CLASSES: Readonly<Record<string, RestMutationEntry>> = {
  // --- AI / agent execution: the governed pipeline (policy + approval) -----------------------
  'POST /api/ai/chat': {
    class: 'approval_enforced',
    justification:
      'Runs the governed AI pipeline: RBAC ceiling, argument guard, central policy, approval gate for consequential tools.',
    proof: [{ in: 'route', contains: 'orchestrator.run(' }],
  },
  'POST /api/ai/approvals/:approvalId/decision': {
    class: 'approval_enforced',
    justification:
      'Approval decisions: decider authority (membership, approvals.decide, required role, separation of duties) is derived server-side; an agent approval resumes under agent ceiling ∩ requester ceiling.',
    proof: [
      { in: 'route', contains: 'authorizeApprovalDecision(' },
      { in: 'route', contains: 'resolveAgentEffectiveCapabilities' },
      { in: 'apps/api/src/ai/approval-authorization.ts', contains: 'SELF_APPROVAL_FORBIDDEN' },
    ],
  },
  'POST /api/agent/execute': {
    class: 'approval_enforced',
    justification:
      'Agent run: delegation + RBAC ceiling + policy + approval through the ToolExecutor.',
    proof: [cap('agent.execute')],
  },
  'POST /api/agent/proposals/:proposalId/execute': {
    class: 'approval_enforced',
    justification: 'Agent proposal execution through the governed pipeline.',
    proof: [cap('agent.execute')],
  },
  'POST /api/agents/:agentId/execute': {
    class: 'approval_enforced',
    justification: 'Agent run under a persisted agent identity: delegation + policy + approval.',
    proof: [cap('agent.execute')],
  },
  'POST /api/agents/:agentId/proposals/:proposalId/execute': {
    class: 'approval_enforced',
    justification: 'Agent proposal execution under a persisted agent identity.',
    proof: [cap('agent.execute')],
  },
  // --- Agent identity administration ------------------------------------------------------------
  'POST /api/agents': {
    class: 'rbac',
    justification:
      'Administrative identity management (agents.manage, non-delegable); audited; grants nothing by itself.',
    proof: [cap('agents.manage')],
  },
  'POST /api/agents/:agentId/${path}': {
    class: 'rbac',
    justification:
      'Agent lifecycle transitions (suspend/activate/revoke): agents.manage, audited; they only reduce authority or restore a previously granted one.',
    proof: [cap('agents.manage')],
  },
  'POST /api/agents/:agentId/delegations': {
    class: 'rbac',
    justification:
      'Delegation grant: agents.manage + grantor must hold the capability; non-delegable capabilities refused; enforced again at every execution.',
    proof: [
      cap('agents.manage'),
      {
        in: 'platform/agents/src/identity/agent-identity-service.ts',
        contains: 'DELEGATION_EXCEEDS_USER_AUTHORITY',
      },
    ],
  },
  'POST /api/agents/:agentId/delegations/:delegationId/revoke': {
    class: 'rbac',
    justification: 'Revocation only reduces authority.',
    proof: [cap('agents.manage')],
  },
  // --- Calendar / documents / knowledge / webhooks / marketplace --------------------------------
  'POST /api/calendar/events': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('calendar.create')],
  },
  'PATCH /api/calendar/events/:id': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('calendar.create')],
  },
  'POST /api/calendar/events/:id/cancel': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('calendar.create')],
  },
  'POST /api/documents': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('documents.upload')],
    residual:
      'One coarse capability (documents.upload) covers create / archive / version / restore / templates: no separate archive or restore authority.',
  },
  'POST /api/documents/:id/archive': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('documents.upload')],
    residual: 'Archiving shares the coarse documents.upload capability (see POST /api/documents).',
  },
  'POST /api/documents/:id/versions': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('documents.upload')],
  },
  'POST /api/documents/:id/versions/:version/restore': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('documents.upload')],
    residual: 'Restoring an old version shares the coarse documents.upload capability.',
  },
  'POST /api/documents/templates': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('documents.upload')],
  },
  'POST /api/documents/templates/:id/archive': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('documents.upload')],
  },
  'POST /api/documents/from-template': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('documents.upload')],
  },
  'POST /api/knowledge/articles': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('knowledge.publish')],
    residual:
      'One coarse capability (knowledge.publish) covers draft, edit, publish, archive and categories: an author cannot be separated from a publisher.',
  },
  'PUT /api/knowledge/articles/:id': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('knowledge.publish')],
    residual:
      'Edits share the coarse knowledge.publish capability (see POST /api/knowledge/articles).',
  },
  'POST /api/knowledge/articles/:id/publish': {
    class: 'rbac',
    justification: `${RBAC_LOW_RISK} Publishing needs knowledge.publish; published text is evidence for the AI, never authority.`,
    proof: [cap('knowledge.publish')],
  },
  'POST /api/knowledge/articles/:id/archive': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('knowledge.publish')],
  },
  'POST /api/knowledge/categories': {
    class: 'rbac',
    justification: RBAC_LOW_RISK,
    proof: [cap('knowledge.publish')],
  },
  'POST /api/integrations/webhooks': {
    class: 'rbac',
    justification:
      'integrations.manage; endpoint URLs are validated (SSRF-safe); no policy-governed capability.',
    proof: [cap('integrations.manage')],
  },
  'PATCH /api/integrations/webhooks/:endpointId': {
    class: 'rbac',
    justification: 'integrations.manage; same validation as creation.',
    proof: [cap('integrations.manage')],
  },
  'POST /api/integrations/webhooks/:endpointId/enable': {
    class: 'rbac',
    justification: 'integrations.manage; re-enabling revalidates the endpoint URL.',
    proof: [cap('integrations.manage')],
  },
  'DELETE /api/integrations/webhooks/:endpointId': {
    class: 'rbac',
    justification: 'integrations.manage; removes an outbound endpoint (reduces exposure).',
    proof: [cap('integrations.manage')],
  },
  'POST /api/integrations/email/inbound': {
    class: 'exempt',
    justification:
      'No session by design (a webhook-in): an HMAC signature over the raw body is verified before anything is read, and the sender must be on the allowlist. The ONLY routable action is approval.decide, which re-enters the SAME decision rules (decider role, separation of duties, expiry). Email text is evidence, never authority.',
    proof: [
      { in: 'route', contains: 'verifySignature(' },
      { in: 'route', contains: 'public: true' },
      { in: 'apps/api/src/app.ts', contains: "action !== 'approval.decide'" },
    ],
  },
  'POST /api/marketplace/apps/:appId/install': {
    class: 'rbac',
    justification: 'marketplace.manage; installs a catalog app the platform already vets.',
    proof: [cap('marketplace.manage')],
  },
  'POST /api/marketplace/apps/:appId/update': {
    class: 'rbac',
    justification: 'marketplace.manage; updates a vetted catalog app.',
    proof: [cap('marketplace.manage')],
  },
  'POST /api/marketplace/apps/:appId/uninstall': {
    class: 'rbac',
    justification: 'marketplace.manage; removal reduces surface.',
    proof: [cap('marketplace.manage')],
  },
  // --- Self-scoped / bootstrap -----------------------------------------------------------------
  'POST /api/notifications/:id/read': {
    class: 'rbac',
    justification: "Self-scoped to the caller's own notification; no role grants or denies it.",
    proof: [{ in: 'route', contains: 'auth.userId' }],
  },
  'POST /api/notifications/read-all': {
    class: 'rbac',
    justification: "Self-scoped to the caller's own notifications.",
    proof: [{ in: 'route', contains: 'auth.userId' }],
  },
  'PUT /api/notifications/preferences': {
    class: 'rbac',
    justification: "Self-scoped to the caller's own preferences.",
    proof: [{ in: 'route', contains: 'auth.userId' }],
  },
  'POST /api/organizations': {
    class: 'rbac',
    justification:
      'Bootstrap: you create your OWN organization; no membership exists yet to resolve a role against.',
    proof: [{ in: 'route', contains: 'auth.userId' }],
  },
  // --- Projects / employees / workspaces ---------------------------------------------------------
  'POST /api/projects': {
    class: 'rbac',
    justification:
      'projects.create; direct human action. The AI create-project tool is consequential (approval), but no policy DENY rule governs the capability for a human.',
    proof: [cap('projects.create')],
  },
  'POST /api/employees': {
    class: 'rbac',
    justification:
      'employees.manage; direct human HR action. The AI hire tool is consequential (approval); no policy DENY rule governs the capability.',
    proof: [cap('employees.manage')],
  },
  // --- Hiring requisitions (the office hiring chain) --------------------------------------------------
  'POST /api/hiring/requisitions': {
    class: 'rbac',
    justification:
      'requisitions.create; raising a request changes nothing but the request itself — it then has to pass the executive and finance decisions.',
    proof: [cap('requisitions.create')],
  },
  'POST /api/hiring/requisitions/:requisitionId/decision': {
    class: 'domain_governed',
    justification:
      'The stage is derived from the request (never the body) and the caller must hold THAT stage’s capability; the aggregate then refuses a decision on one’s own request, a second stage by the same person, and any stage the request is not waiting at.',
    proof: [
      cap('requisitions.approve_executive'),
      cap('requisitions.approve_finance'),
      {
        in: 'domains/hr/src/entities/hiring-requisition.ts',
        contains: 'You cannot decide your own hiring request',
      },
      {
        in: 'domains/hr/src/entities/hiring-requisition.ts',
        contains: 'You already decided an earlier stage of this hiring request',
      },
    ],
  },
  'PUT /api/hiring/requisitions/:requisitionId': {
    class: 'domain_governed',
    justification:
      'requisitions.create + requester-only (aggregate): a returned request may be revised by the person who raised it; resubmitting restarts the whole chain.',
    proof: [
      cap('requisitions.create'),
      {
        in: 'domains/hr/src/entities/hiring-requisition.ts',
        contains: 'Only the requester can revise a hiring request',
      },
    ],
  },
  'POST /api/hiring/requisitions/:requisitionId/withdraw': {
    class: 'domain_governed',
    justification:
      'requisitions.create + requester-only (aggregate); an approved request can no longer be withdrawn.',
    proof: [
      cap('requisitions.create'),
      {
        in: 'domains/hr/src/entities/hiring-requisition.ts',
        contains: 'Only the requester can withdraw a hiring request',
      },
    ],
  },
  // --- Office requests (leave, purchase, IT access) ----------------------------------------------------
  'POST /api/requests': {
    class: 'rbac',
    justification:
      'requests.create; raises a request of one of the catalogued office workflows from the caller’s own team. The aggregate keeps only the workflow’s own fields and validates each. A decision the requester would have to take themselves is recorded as not required, never self-approved.',
    proof: [cap('requests.create')],
  },
  'POST /api/requests/:requestId/decision': {
    class: 'domain_governed',
    justification:
      'The authority of the SEAT the pending stage belongs to (manager of the request’s own team, the executive, HR, Finance, IT, engineering, marketing, sales, support, Legal, or the requester for their own step), derived server-side; a decision that would fall to the requester goes up to the executive. The aggregate enforces the order of the stages and separation of duties: nobody decides their own request, and saying no needs a reason.',
    proof: [
      { in: 'route', contains: 'requests.approve_manager' },
      {
        in: 'apps/api/src/office/request-authority.ts',
        contains: "seat !== 'manager' || scope.workspaceId === request.workspaceId",
      },
      {
        in: 'domains/hr/src/entities/office-request.ts',
        contains: 'You cannot decide your own request',
      },
      {
        in: 'domains/hr/src/entities/office-request.ts',
        contains: 'This request is waiting at a different stage',
      },
    ],
  },
  'POST /api/requests/:requestId/withdraw': {
    class: 'domain_governed',
    justification:
      'requests.create; the aggregate lets only the requester withdraw, and only while the request is pending.',
    proof: [
      cap('requests.create'),
      {
        in: 'domains/hr/src/entities/office-request.ts',
        contains: 'Only the requester can withdraw a request',
      },
    ],
  },

  'POST /api/requests/draft': {
    class: 'rbac',
    justification:
      'requests.create; the assistant turns the caller’s own sentence into SUGGESTED field values. Nothing is stored: the person reviews and submits through POST /api/requests, where every value is validated.',
    proof: [cap('requests.create')],
  },
  'POST /api/requests/:requestId/brief': {
    class: 'rbac',
    justification:
      'requests.create + visibility of the request + the authority to take its pending stage. The assistant summarises a request the caller already sees and facts computed server-side; it decides nothing. The only write is a history note that help was given.',
    proof: [cap('requests.create'), { in: 'route', contains: 'mayTakePending(' }],
  },
  'POST /api/requests/:requestId/write': {
    class: 'rbac',
    justification:
      'requests.create + visibility of the request + the authority to take its pending stage. The assistant drafts text for the person to edit; it is stored only if they submit it through the decision route. The only write is a history note that help was given.',
    proof: [cap('requests.create'), { in: 'route', contains: 'mayTakePending(' }],
  },

  // --- People and teams ----------------------------------------------------------------------------------
  'POST /api/invites': {
    class: 'rbac',
    justification:
      'members.manage, as the chief executive of the organization or from the caller’s own seat in it (HR). Only the chief executive appoints a team head, and an invitation never gives an executive’s oversight seat. The link’s secret is returned once; only its hash is stored.',
    proof: [
      cap('members.manage'),
      { in: 'route', contains: 'Only the chief executive can appoint a team head' },
      { in: 'route', contains: 'tokenHash: hashOf(code)' },
    ],
  },
  'POST /api/invites/:inviteId/revoke': {
    class: 'rbac',
    justification:
      'members.manage; taking an unused invitation back only reduces who can join. A used or already revoked invitation is refused.',
    proof: [cap('members.manage')],
  },
  'POST /api/invites/accept': {
    class: 'rbac',
    justification:
      'Self-scoped: the signed-in caller takes the one seat the link was made for (by someone holding members.manage). The link’s secret is the authority; it works once, can be revoked and expires. No membership exists yet to resolve a role against. The seat is fixed by the invitation, never by the request.',
    proof: [
      { in: 'route', contains: 'markUsed(invite.id, userId' },
      { in: 'route', contains: 'invite.seat,' },
      {
        in: 'domains/workspaces/src/entities/workspace-invite.ts',
        contains: "INVITE_SEATS = ['owner', 'admin', 'member']",
      },
    ],
  },

  // --- Project tasks -------------------------------------------------------------------------------------
  'POST /api/tasks': {
    class: 'rbac',
    justification:
      'tasks.manage; creates a task on a project of the organization for a member of the caller’s team whose role works on tasks.',
    proof: [
      cap('tasks.manage'),
      { in: 'apps/api/src/routes/tasks.ts', contains: 'That person is not a member of this team' },
    ],
  },
  'POST /api/tasks/:taskId/start': {
    class: 'domain_governed',
    justification: 'tasks.work; the aggregate lets only the assignee start their task.',
    proof: [
      cap('tasks.work'),
      {
        in: 'domains/projects/src/entities/project-task.ts',
        contains: 'Only the person the task is assigned to can do this',
      },
    ],
  },
  'POST /api/tasks/:taskId/submit': {
    class: 'domain_governed',
    justification: 'tasks.work; the aggregate lets only the assignee hand their task in.',
    proof: [
      cap('tasks.work'),
      {
        in: 'domains/projects/src/entities/project-task.ts',
        contains: 'Only the person the task is assigned to can do this',
      },
    ],
  },
  'POST /api/tasks/:taskId/review': {
    class: 'domain_governed',
    justification:
      'tasks.manage; separation of duties in the aggregate: nobody reviews their own work, and sending work back needs a reason.',
    proof: [
      cap('tasks.manage'),
      {
        in: 'domains/projects/src/entities/project-task.ts',
        contains: 'You cannot review your own work',
      },
    ],
  },
  'POST /api/tasks/:taskId/reassign': {
    class: 'rbac',
    justification:
      'tasks.manage; gives an unfinished task to another member of the caller’s team whose role works on tasks.',
    proof: [cap('tasks.manage')],
  },

  // --- Recruiting (HR's side of hiring) ----------------------------------------------------------------
  'POST /api/recruiting/openings': {
    class: 'domain_governed',
    justification:
      'recruiting.manage; a position can only be opened for a hiring request already approved by the executive and by Finance, once per request.',
    proof: [
      cap('recruiting.manage'),
      {
        in: 'domains/hr/application/src/services/recruiting-application-service.ts',
        contains: "requisition.status !== 'approved'",
      },
    ],
  },
  'POST /api/recruiting/openings/:openingId/status': {
    class: 'rbac',
    justification:
      'recruiting.manage; hold / resume / close an opening (closing needs a reason and no open offer).',
    proof: [cap('recruiting.manage')],
  },
  'POST /api/recruiting/openings/:openingId/candidates': {
    class: 'rbac',
    justification: 'recruiting.manage; adds a candidate record to an opening that is recruiting.',
    proof: [cap('recruiting.manage')],
  },
  'POST /api/recruiting/candidates/:candidateId/advance': {
    class: 'rbac',
    justification: 'recruiting.manage; the aggregate only allows the next pipeline stage.',
    proof: [cap('recruiting.manage')],
  },
  'POST /api/recruiting/candidates/:candidateId/feedback': {
    class: 'rbac',
    justification:
      'recruiting.interview + visibility of the opening (HR/executive, or the hiring manager of that opening); the interviewer is always the session user, once per stage.',
    proof: [cap('recruiting.interview')],
  },
  'POST /api/recruiting/candidates/:candidateId/offer': {
    class: 'domain_governed',
    justification:
      'recruiting.manage; the offer must be inside the salary range approved on the hiring request and must hold one of the approved seats (never more offers than headcount).',
    proof: [
      cap('recruiting.manage'),
      {
        in: 'domains/hr/src/entities/candidate.ts',
        contains: 'The offer is outside the salary range approved for this hiring request',
      },
      {
        in: 'domains/hr/src/entities/job-opening.ts',
        contains: 'no seat is left for another offer',
      },
    ],
  },
  'POST /api/recruiting/candidates/:candidateId/offer/response': {
    class: 'domain_governed',
    justification:
      'recruiting.manage; an offer is answered exactly once (optimistic write on the candidate); acceptance creates the employee record in `hired`.',
    proof: [
      cap('recruiting.manage'),
      {
        in: 'domains/hr/src/entities/candidate.ts',
        contains: 'There is no open offer for this candidate',
      },
    ],
  },
  'POST /api/recruiting/candidates/:candidateId/close': {
    class: 'rbac',
    justification:
      'recruiting.manage; reject / withdraw with a reason; a pending offer is rescinded and its seat released.',
    proof: [cap('recruiting.manage')],
  },
  // --- Onboarding and assignment ------------------------------------------------------------------------
  'POST /api/onboarding': {
    class: 'rbac',
    justification:
      'onboarding.hr; starts the checklist for an employee in `hired` (once per employee) and moves them to `onboarding`.',
    proof: [cap('onboarding.hr')],
  },
  'POST /api/onboarding/:onboardingId/items/:item/complete': {
    class: 'domain_governed',
    justification:
      'The item’s owner is server data: the caller must hold THAT owner’s capability (HR / IT / manager), and a manager item belongs to the hiring manager of that hire. An item is completed once; the last one activates the employee.',
    proof: [
      cap('onboarding.hr'),
      cap('onboarding.it'),
      cap('onboarding.manager'),
      {
        in: 'apps/api/src/routes/onboarding.ts',
        contains: "owner !== 'manager' || onboarding.hiringManagerId === userId",
      },
      {
        in: 'domains/hr/src/entities/onboarding.ts',
        contains: 'This onboarding item is already done',
      },
    ],
  },
  'POST /api/projects/:projectId/assignments': {
    class: 'rbac',
    justification:
      'projects.assign, OR onboarding.manager for the hiring manager of THAT employee (their own onboarded hire — the managers’ general AI assignment authority is unchanged). The route additionally requires an ACTIVE employee and a project of the same organization; duplicates are rejected by the domain.',
    proof: [
      cap('projects.assign'),
      cap('onboarding.manager'),
      { in: 'route', contains: 'onboarding.hiringManagerId !== auth.userId' },
      { in: 'route', contains: 'Only an active employee can be assigned' },
    ],
  },
  'POST /api/workspaces': {
    class: 'rbac',
    justification: 'workspaces.create; no policy DENY rule governs the capability.',
    proof: [cap('workspaces.create')],
  },
  // --- Finance ---------------------------------------------------------------------------------------
  'POST /api/finance/budgets': {
    class: 'domain_governed',
    justification:
      'budgets.manage; the budget is the limit policy reads. The domain enforces the budget value objects (positive amount, currency, period) and the lifecycle.',
    proof: [
      cap('budgets.manage'),
      {
        in: 'domains/finance/application/src/validators/create-budget.validator.ts',
        contains: 'ValidationError',
      },
    ],
    residual:
      'A single budgets.manage holder can define a budget and later raise it (PATCH): there is no second-person review of loosening a limit. Policy reads the persisted budget, so a raised limit widens what policy allows.',
  },
  'PATCH /api/finance/budgets/:id': {
    class: 'domain_governed',
    justification:
      'budgets.manage; the domain enforces the lifecycle (a closed budget is terminal and cannot be revised) and revalidates the value objects.',
    proof: [
      cap('budgets.manage'),
      { in: 'domains/finance/src/entities/budget.ts', contains: 'FinanceStateTransitionError' },
    ],
    residual:
      'Single-actor loosening: the same budgets.manage holder may raise allocatedMinorUnits; no separation of duties on budget increases (documented gap).',
  },
  'POST /api/finance/budgets/:id/close': {
    class: 'domain_governed',
    justification:
      'budgets.manage; closing is terminal and only tightens (policy then denies new expenses, and approval of pending ones is refused).',
    proof: [
      cap('budgets.manage'),
      {
        in: 'domains/finance/application/src/services/finance-application-service.ts',
        contains: 'closed budget',
      },
    ],
  },
  'POST /api/finance/budgets/:id/clear-review': {
    class: 'domain_governed',
    justification:
      'budgets.manage; the domain only allows clearing a budget that is under review (state transition guard).',
    proof: [
      cap('budgets.manage'),
      { in: 'domains/finance/src/entities/budget.ts', contains: 'FinanceStateTransitionError' },
    ],
    residual:
      'Single-actor: the holder who can clear a review flag may be the one who caused the flagged spend; the flag is a signal, not a spend block.',
  },
  'POST /api/finance/budgets/flag-over-threshold': {
    class: 'domain_governed',
    justification:
      'budgets.manage; deterministic flagging at a fixed utilization threshold (moves budgets into review — a tightening; the caller supplies no targets).',
    proof: [
      cap('budgets.manage'),
      {
        in: 'domains/finance/application/src/services/finance-application-service.ts',
        contains: 'BUDGET_HIGH_UTILIZATION_THRESHOLD_PERCENT',
      },
    ],
  },
  'POST /api/finance/expenses': {
    class: 'policy_enforced',
    justification:
      "expenses.create + the central policy (origin rest): closed/unresolvable budget and org-configured budget-limit DENY are final. REQUIRE_APPROVAL is satisfied by the domain's own pending -> decided flow (expense stays `pending` until another actor with expenses.decide decides). The application layer also refuses a currency that differs from the budget's.",
    proof: [
      cap('expenses.create'),
      { in: 'route', contains: 'enforceRestPolicy(' },
      {
        in: 'domains/finance/application/src/services/finance-application-service.ts',
        contains: 'currency must match',
      },
    ],
  },
  'POST /api/finance/expenses/:id/decide': {
    class: 'policy_enforced',
    justification:
      "expenses.decide + the central policy re-evaluated at APPROVE time (origin rest, over the persisted expense's own amount/currency/budget and the CURRENT approved spend): an org-configured budget-limit DENY is final and cannot be overridden by an approval; REQUIRE_APPROVAL is satisfied by the deciding human's own act. The domain enforces separation of duties (the submitter may not decide), a decision is never revised, and approval is refused when the budget is closed.",
    proof: [
      cap('expenses.decide'),
      { in: 'route', contains: 'enforceRestPolicy(' },
      { in: 'domains/finance/src/errors/index.ts', contains: 'ExpenseSelfApprovalError' },
      {
        in: 'domains/finance/application/src/services/finance-application-service.ts',
        contains: 'Cannot approve an expense against a closed budget',
      },
    ],
    residual:
      'Rejection needs no policy (moves no money) and may be made by any expenses.decide holder other than the submitter. The approve-time check is serialized per organization in-process only: concurrent approvals across API instances can still both read the same approved spend (check-then-act, no row lock).',
  },
  // --- Policy administration / problems / remediation ------------------------------------------------
  'POST /api/policy/policies/:policyId/versions': {
    class: 'rbac',
    justification:
      'policy.manage (non-delegable, never an AI tool); strict allow-list validation, tighten-only, append-only versions, audited.',
    proof: [{ in: 'route', contains: 'policy.manage' }],
  },
  'POST /api/problems/scan': {
    class: 'rbac',
    justification:
      'problems.read; a MUTATION (it persists/updates problem records) but a deterministic, idempotent one: re-scans update one problem by correlation identity and never duplicate, only detection records change, and no business state or capability is touched.',
    proof: [cap('problems.read'), { in: 'route', contains: 'scan.handle(' }],
    residual:
      'Held by every role with problems.read (not only problems.investigate): any such member can trigger a full detection scan of the scope (a cost/noise concern, not an integrity one).',
  },
  'POST /api/problems/:problemId/plans': {
    class: 'rbac',
    justification: 'problems.investigate; creating a plan executes nothing.',
    proof: [cap('problems.investigate')],
  },
  'POST /api/plans/:planId/advance': {
    class: 'approval_enforced',
    justification:
      'Plan steps run through the governed ToolExecutor: policy + approval per consequential step; the plan is only reachable under its own workspace (404 otherwise).',
    proof: [
      cap('problems.investigate'),
      { in: 'route', contains: 'resolvePlanScope(' },
      {
        in: 'platform/remediation/src/application/remediation-application-service.ts',
        contains: 'record.workspaceId !== context.workspaceId',
      },
    ],
  },
  'POST /api/plans/:planId/replan': {
    class: 'rbac',
    justification:
      'problems.investigate; re-planning executes nothing; the plan is only reachable under its own workspace.',
    proof: [cap('problems.investigate'), { in: 'route', contains: 'resolvePlanScope(' }],
  },
  'POST /api/plans/:planId/cancel': {
    class: 'rbac',
    justification:
      'problems.investigate; cancelling only stops further execution; the plan is only reachable under its own workspace.',
    proof: [cap('problems.investigate'), { in: 'route', contains: 'resolvePlanScope(' }],
  },
  // --- Workflows ---------------------------------------------------------------------------------------
  'POST /api/workflows': {
    class: 'policy_enforced',
    justification:
      'workflows.execute + the initiator must hold EVERY inner capability (RBAC ceiling bound to the instance); the central policy is evaluated (origin rest) for the inner steps: DENY -> 403, policy-required approval -> 409 APPROVAL_REQUIRED (governed AI/approval path).',
    proof: [
      cap('workflows.execute'),
      { in: 'route', contains: 'enforceRestPolicy(' },
      { in: 'route', contains: 'authorizeWorkflowInitiator(' },
    ],
  },
  'POST /api/workflows/:workflowId/cancel': {
    class: 'rbac',
    justification:
      "workflows.execute + ownership scope: the caller must be the instance initiator or a member of its workspace, otherwise the instance is a 404 (an org-level workflows.execute holder can no longer cancel another workspace's instance). Cancelling only stops further execution.",
    proof: [cap('workflows.execute'), { in: 'route', contains: 'existing.value.instance.userId' }],
  },
};
