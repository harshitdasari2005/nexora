/**
 * @nexora/module-domains — initial registrations (S24 Phase 1; S34 RBAC).
 *
 * The first-party Domain → Role → Capability seed. These are INITIAL
 * REGISTRATIONS ONLY — no application logic is built for any role. The
 * platform core stays domain-agnostic: it renders whatever domains are
 * registered, and a future domain (e.g. Legal) registers the same way.
 *
 * Capabilities are the small set needed to prove the model. Each maps to an
 * existing Nexora operation where one exists; where no executable surface
 * exists yet, the description says so — a definition is never presented as
 * executable (S24: do not pretend).
 *
 * Role `capabilityIds` ARE the role's effective RBAC permission set (S34):
 * the API layer's `authorizePermission()` seam (apps/api/src/business-
 * context/permissions.ts) treats this SAME list as the authoritative answer
 * to "is this role allowed to do X" for protected routes, while the AI
 * Runtime's capability-discovery affinity filter treats it as a soft FOCUS
 * (S24 Phase 3 behavior, unchanged: an EMPTY list there still means
 * "unrestricted discovery," never "denied" — only a route's explicit
 * `authorizePermission()` check treats an empty/missing set as "no
 * permission," so a role not yet assigned a real set here simply keeps
 * today's permissive default instead of silently losing route access).
 * S34 populated the 13 named business roles (executive.ceo, finance.cfo,
 * technology.cto/.engineering_manager/.developer, product.product_manager,
 * people.hr, growth.sales_manager/.marketing_manager, legal.general_counsel,
 * operations.manager, customersuccess.manager, procurement.manager) with a
 * deliberate, real permission set; every other registered role keeps its
 * pre-S34 shape (empty, or the pre-existing delivery.manager set) untouched.
 * The role → capability relationship is validated by tests and the Legal/
 * finance.controller extensibility fixtures.
 *
 * Backend RBAC enforcement closed the last un-gated mutating surfaces:
 * added `integrations.manage` + `marketplace.manage` (granted to
 * executive.ceo, technology.cto/.engineering_manager, operations.manager)
 * and wired the previously-defined-but-ungranted `knowledge.publish` onto
 * the knowledge authors (executive.ceo, technology.cto/.engineering_manager,
 * growth.marketing_manager, legal.general_counsel, finance.cfo) — each also
 * holds `knowledge.read` (finance.cfo gained both: a CFO curating finance
 * runbooks in its own workspace, not company-wide knowledge reach).
 */

import type {
  CapabilityDefinition,
  DomainDefinition,
  DomainRoleDefinition,
} from '@nexora/contracts/domain';

/** The initial business domains (S24 Phase 1 registrations). */
export const INITIAL_DOMAINS: readonly DomainDefinition[] = [
  {
    id: 'executive',
    name: 'Executive',
    description: 'Executive leadership and company direction',
    roleIds: ['executive.ceo'],
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Financial management and reporting',
    roleIds: ['finance.cfo'],
  },
  {
    id: 'people',
    name: 'People',
    description: 'People, human resources, and talent',
    roleIds: ['people.hr'],
  },
  {
    id: 'technology',
    name: 'Technology',
    description: 'Engineering and technology',
    roleIds: ['technology.cto', 'technology.engineering_manager', 'technology.developer'],
  },
  {
    id: 'security',
    name: 'Security',
    description: 'Information security and risk',
    roleIds: ['security.ciso', 'security.security_manager'],
  },
  {
    id: 'growth',
    name: 'Growth',
    description: 'Sales, marketing, and growth',
    roleIds: ['growth.sales_manager', 'growth.marketing_manager', 'growth.growth_manager'],
  },
  {
    id: 'product',
    name: 'Product',
    description: 'Product management and strategy',
    roleIds: ['product.product_manager', 'product.product_lead'],
  },
  {
    id: 'delivery',
    name: 'Delivery',
    description: 'Delivery and project execution',
    roleIds: ['delivery.manager', 'delivery.project_manager'],
  },
  {
    id: 'legal',
    name: 'Legal',
    description: 'Legal and compliance',
    roleIds: ['legal.general_counsel', 'legal.compliance_manager'],
  },
  {
    id: 'operations',
    name: 'Operations',
    description: 'Business operations and process',
    roleIds: ['operations.head', 'operations.manager'],
  },
  {
    id: 'customersuccess',
    name: 'Customer Success',
    description: 'Customer success and support',
    roleIds: ['customersuccess.manager', 'customersuccess.support_manager'],
  },
  {
    id: 'procurement',
    name: 'Procurement',
    description: 'Procurement and vendor management',
    roleIds: ['procurement.manager', 'procurement.vendor_manager'],
  },
];

/** The initial business roles (S24 Phase 1 registrations). */
export const INITIAL_ROLES: readonly DomainRoleDefinition[] = [
  {
    id: 'executive.ceo',
    name: 'CEO',
    description: 'Chief Executive Officer',
    domainId: 'executive',
    // Organization-level oversight: every executable AI surface (S24 Phase 3
    // affinity — business context, never a grant). S25 Phase 7: broad
    // enterprise integration oversight — all external connector surfaces
    // (GitHub + Slack) are within executive focus. S34: broad organizational
    // RBAC permissions — the CEO is the one role that reads AND decides
    // across every surface. The CEO can SEE every department and RAISE any
    // request in it (budgets, expenses, documents, project updates) — but holds
    // no `expenses.decide`: money is decided by Finance, so approvals still
    // follow the chain even for the chief executive.
    capabilityIds: [
      'organization.read',
      'workspaces.list',
      'workspaces.create',
      'projects.read',
      'projects.create',
      'projects.assign',
      'problems.read',
      'problems.investigate',
      'insights.read',
      'documents.read',
      'knowledge.read',
      'knowledge.publish',
      'employees.read',
      'employees.manage',
      'workflows.read',
      'workflows.execute',
      'approvals.read',
      'approvals.decide',
      'agent.use',
      'agent.execute',
      'agents.manage',
      'activity.read',
      'calendar.read',
      'calendar.create',
      'audit.read',
      'policy.read',
      'policy.manage',
      'github.repositories.read',
      'github.issues.read',
      'github.issues.create',
      'slack.channels.read',
      'slack.messages.read',
      'slack.messages.send',
      'integrations.manage',
      'marketplace.manage',
      'projects.update',
      'documents.upload',
      'approvals.create',
      'budgets.read',
      'budgets.manage',
      'expenses.read',
      'expenses.create',
      'requisitions.create',
      'requisitions.read',
      'requisitions.approve_executive',
      'recruiting.read',
      'recruiting.interview',
    ],
  },
  {
    id: 'finance.cfo',
    name: 'CFO',
    description: 'Chief Financial Officer',
    domainId: 'finance',
    // Financial/organizational focus (S34): visibility + approval authority
    // over projects, problems, and insights — no employee-management or
    // workflow-execution reach (that stays with People/Delivery). S35
    // (Finance vertical): `problems.investigate` (financial risk detail is
    // core to the role) plus the CFO's own domain data — budgets and
    // expenses — plus deciding expenses (a real money-movement approval,
    // BR-19), scoped to this role only (no other role reads/manages Finance
    // data). `agent.execute` closes the detection → problem → remediation →
    // approval → execution loop for the CFO's OWN domain: the Finance agent
    // registered in platform/agents' INITIAL_AGENTS carries only
    // `finance.submit_expense` / `finance.flag_over_budget_items` (plus the
    // universal `notifications.what_needs_attention`) as ITS capability set
    // — granting the CFO the ceiling to execute at all never widens WHAT
    // they can execute (the agent-definition intersection still fails
    // closed on anything outside that set), and every consequential step
    // stays approval-gated (BR-13).
    capabilityIds: [
      'projects.read',
      'problems.read',
      'problems.investigate',
      'insights.read',
      'approvals.read',
      'approvals.decide',
      'documents.read',
      'knowledge.read',
      'knowledge.publish',
      'agent.use',
      'agent.execute',
      'agents.manage',
      'activity.read',
      'budgets.read',
      'budgets.manage',
      'expenses.read',
      'expenses.create',
      'expenses.decide',
      'policy.read',
      'requisitions.read',
      'requisitions.approve_finance',
    ],
  },
  {
    id: 'people.hr',
    name: 'HR / CHRO',
    description: 'Human resources / Chief Human Resources Officer',
    domainId: 'people',
    // People-related access only (S34): employee records, people-adjacent
    // problems, and documents — no project/financial/technical reach.
    capabilityIds: [
      'employees.read',
      'employees.manage',
      'documents.read',
      'problems.read',
      'agent.use',
      'activity.read',
      'requisitions.read',
      'recruiting.manage',
      'recruiting.read',
      'recruiting.interview',
    ],
  },
  {
    id: 'technology.cto',
    name: 'CTO',
    description: 'Chief Technology Officer',
    domainId: 'technology',
    // Technology-focused (S34): full engineering visibility + governed
    // execution + the GitHub connector surface — no HR/financial/approval
    // authority outside its own domain's problems.
    capabilityIds: [
      'projects.read',
      'projects.update',
      'problems.read',
      'problems.investigate',
      'insights.read',
      'agent.use',
      'agent.execute',
      'agents.manage',
      'documents.read',
      'knowledge.read',
      'knowledge.publish',
      'activity.read',
      'github.repositories.read',
      'github.issues.read',
      'github.issues.create',
      'integrations.manage',
      'marketplace.manage',
      'requisitions.create',
      'recruiting.interview',
    ],
  },
  {
    id: 'technology.engineering_manager',
    name: 'Engineering Manager',
    description: 'Leads an engineering team',
    domainId: 'technology',
    // Delivery/engineering focus (S34): same technical execution reach as
    // the CTO minus organization-wide insight — a team-level, not
    // company-level, technology lens.
    capabilityIds: [
      'projects.read',
      'projects.update',
      'problems.read',
      'problems.investigate',
      'agent.use',
      'agent.execute',
      'knowledge.read',
      'knowledge.publish',
      'activity.read',
      'github.repositories.read',
      'github.issues.read',
      'github.issues.create',
      'integrations.manage',
      'marketplace.manage',
      'requisitions.create',
      'recruiting.interview',
    ],
  },
  {
    id: 'technology.developer',
    name: 'Developer',
    description: 'Builds and maintains software',
    domainId: 'technology',
    // Individual execution: read/find focus — projects, documents,
    // knowledge, workflows, approvals (S24 Phase 3 affinity — business
    // context, never a grant; write capabilities stay out of the AI focus).
    // S25 Phase 7: GitHub repository/issue focus (the Developer's external
    // work surface); Slack stays outside the Developer focus. S34:
    // execution-focused RBAC — deliberately NO organization-wide executive
    // permission (no insights.read, no approvals.decide, no calendar.create,
    // no employees.*) — a Developer sees and investigates problems and works
    // projects/knowledge/GitHub, nothing broader.
    capabilityIds: [
      'projects.read',
      'projects.update',
      'documents.read',
      'knowledge.read',
      'workflows.read',
      'approvals.read',
      'problems.read',
      'problems.investigate',
      'agent.use',
      'agent.execute',
      'activity.read',
      'github.repositories.read',
      'github.issues.read',
      'github.issues.create',
    ],
  },
  {
    id: 'security.ciso',
    name: 'CISO',
    description: 'Chief Information Security Officer',
    domainId: 'security',
    capabilityIds: [],
  },
  {
    id: 'security.security_manager',
    name: 'Security Manager',
    description: 'Leads security operations',
    domainId: 'security',
    capabilityIds: [],
  },
  {
    id: 'growth.sales_manager',
    name: 'Sales Manager',
    description: 'Leads sales',
    domainId: 'growth',
    // Growth/customer access only (S34) — projects and problems visibility
    // plus insight into performance signals; no employee/financial reach.
    capabilityIds: [
      'projects.read',
      'problems.read',
      'insights.read',
      'agent.use',
      'activity.read',
    ],
  },
  {
    id: 'growth.marketing_manager',
    name: 'Marketing Manager',
    description: 'Leads marketing',
    domainId: 'growth',
    // Marketing/growth access only (S34) — knowledge and document reach for
    // campaign material, plus performance signals.
    capabilityIds: [
      'knowledge.read',
      'knowledge.publish',
      'documents.read',
      'insights.read',
      'agent.use',
      'activity.read',
    ],
  },
  {
    id: 'growth.growth_manager',
    name: 'Growth Manager',
    description: 'Leads growth initiatives',
    domainId: 'growth',
    capabilityIds: [],
  },
  {
    id: 'product.product_manager',
    name: 'Product Manager',
    description: 'Owns a product area',
    domainId: 'product',
    // Product/delivery focus (S34): projects + problems (with investigation)
    // + insight + knowledge — no organization-wide approval authority.
    capabilityIds: [
      'projects.read',
      'projects.update',
      'problems.read',
      'problems.investigate',
      'insights.read',
      'knowledge.read',
      'agent.use',
      'activity.read',
    ],
  },
  {
    id: 'product.product_lead',
    name: 'Product Lead',
    description: 'Leads product strategy',
    domainId: 'product',
    capabilityIds: [],
  },
  {
    id: 'delivery.manager',
    name: 'Manager',
    description: 'Leads a delivery team',
    domainId: 'delivery',
    // Team and execution focus: projects, people, knowledge, workflows
    // (S24 Phase 3 affinity — business context, never a grant). S25 Phase
    // 7: project + communication focus — GitHub repository/issue surfaces
    // and Slack channels/send (no message-history read; communication
    // focus, never surveillance). S34: RBAC additions matching this role's
    // EXISTING agent ("Manager Agent") and problems-console reach — a role
    // that already had a non-empty set needed the new permission ids too,
    // or it would silently lose access to routes it already used.
    capabilityIds: [
      'projects.read',
      'projects.create',
      'documents.read',
      'knowledge.read',
      'employees.read',
      'workflows.read',
      'workflows.execute',
      'approvals.read',
      // Prompt 8: the remediation approval routing names this role as the
      // approver of projects./calendar./notifications./workflow./slack.
      // steps — a routed approver must be able to decide (still only when
      // the approval's required role matches; never a blanket authority).
      'approvals.decide',
      'problems.read',
      'problems.investigate',
      'agent.use',
      'agent.execute',
      'agents.manage',
      'activity.read',
      'github.repositories.read',
      'github.issues.read',
      'github.issues.create',
      'slack.channels.read',
      'slack.messages.send',
      'requisitions.create',
      'recruiting.interview',
    ],
  },
  {
    id: 'delivery.project_manager',
    name: 'Project Manager',
    description: 'Drives project execution',
    domainId: 'delivery',
    capabilityIds: [],
  },
  {
    id: 'legal.general_counsel',
    name: 'General Counsel',
    description: 'Chief legal officer',
    domainId: 'legal',
    // Governance/document/approval access (S34) — General Counsel reviews
    // and decides, but has no project/technical/financial reach.
    // `audit.read` added for the Audit Center: governance/compliance
    // oversight over consequential activity is core to this role.
    capabilityIds: [
      'documents.read',
      'documents.upload',
      'knowledge.read',
      'knowledge.publish',
      'approvals.read',
      'approvals.decide',
      'agent.use',
      'activity.read',
      'audit.read',
      'policy.read',
      'policy.manage',
    ],
  },
  {
    id: 'legal.compliance_manager',
    name: 'Compliance Manager',
    description: 'Leads regulatory compliance',
    domainId: 'legal',
    // `audit.read` only: this role's first populated capability — the
    // Legal workspace's admin/member tier still needs audit visibility
    // (the Audit Center's Legal persona requirement) even though no other
    // executable surface has been built for this role yet.
    // `policy.read`: compliance reviews the central policy configuration
    // (read-only — changing it is policy.manage: CEO / General Counsel).
    capabilityIds: ['audit.read', 'policy.read'],
  },
  {
    id: 'operations.head',
    name: 'Head of Operations',
    description: 'Owns end-to-end business operations',
    domainId: 'operations',
    capabilityIds: [],
  },
  {
    id: 'operations.manager',
    name: 'Operations Manager',
    description: 'Runs day-to-day operations',
    domainId: 'operations',
    // Operational/project/workflow access (S34) — runs the day-to-day, sees
    // and acts on process problems, no approval-decision authority.
    // Backend RBAC enforcement: also owns integration + app lifecycle.
    capabilityIds: [
      'projects.read',
      'projects.update',
      'workflows.read',
      'workflows.execute',
      'problems.read',
      'agent.use',
      'activity.read',
      'integrations.manage',
      'marketplace.manage',
    ],
  },
  {
    id: 'customersuccess.manager',
    name: 'Customer Success Manager',
    description: 'Owns customer outcomes and retention',
    domainId: 'customersuccess',
    // Customer/project/problem access (S34) — owns outcomes, needs to see
    // the projects and problems that bear on them.
    capabilityIds: [
      'projects.read',
      'problems.read',
      'documents.read',
      'agent.use',
      'activity.read',
    ],
  },
  {
    id: 'customersuccess.support_manager',
    name: 'Support Manager',
    description: 'Leads customer support',
    domainId: 'customersuccess',
    capabilityIds: [],
  },
  {
    id: 'procurement.manager',
    name: 'Procurement Manager',
    description: 'Leads sourcing and purchasing',
    domainId: 'procurement',
    // Procurement/document/approval access (S34) — sources and purchases
    // through documented, approval-gated decisions.
    capabilityIds: [
      'documents.read',
      'documents.upload',
      'approvals.read',
      'approvals.decide',
      'agent.use',
      'activity.read',
    ],
  },
  {
    id: 'procurement.vendor_manager',
    name: 'Vendor Manager',
    description: 'Manages vendor relationships and contracts',
    domainId: 'procurement',
    capabilityIds: [],
  },
];

/** The initial capability vocabulary (S24 Phase 1 registrations). */
export const INITIAL_CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: 'projects.read',
    name: 'Read Projects',
    description: 'Read project records (existing surface: project listing)',
  },
  {
    id: 'projects.create',
    name: 'Create Projects',
    description: 'Create a new project (existing surface: create-project)',
  },
  {
    id: 'projects.update',
    name: 'Update Projects',
    description:
      'Update a project record (definition only in Phase 1 — no executable update surface yet)',
  },
  {
    id: 'documents.read',
    name: 'Read Documents',
    description: 'Read document records and content (existing surface: document listing and read)',
  },
  {
    id: 'documents.upload',
    name: 'Upload Documents',
    description: 'Upload a document (existing surface: document upload)',
  },
  {
    id: 'knowledge.read',
    name: 'Read Knowledge',
    description:
      'Read knowledge base articles and retrieval answers (existing surface: knowledge read)',
  },
  {
    id: 'knowledge.publish',
    name: 'Publish Knowledge',
    description: 'Publish a knowledge article (existing surface: article publish)',
  },
  {
    id: 'employees.read',
    name: 'Read Employees',
    description: 'Read employee records (existing surface: employee listing)',
  },
  {
    id: 'employees.manage',
    name: 'Manage Employees',
    description:
      'Manage employee records (existing surface: create-employee; broader manage surfaces land with the People domain)',
  },
  {
    id: 'requisitions.create',
    name: 'Raise Hiring Requests',
    description:
      'Raise a hiring request for one’s team, see one’s own requests, and revise or withdraw them (surface: the hiring requisition routes)',
  },
  {
    id: 'requisitions.read',
    name: 'Read Hiring Requests',
    description:
      'See every hiring request of the organization, not only one’s own (surface: the hiring requisition list/read)',
  },
  {
    id: 'requisitions.approve_executive',
    name: 'Decide Hiring Requests (Executive)',
    description:
      'Take the executive decision on a hiring request — the first stage of the chain; never one’s own request',
  },
  {
    id: 'requisitions.approve_finance',
    name: 'Decide Hiring Requests (Finance)',
    description:
      'Take the finance decision on a hiring request — the second stage of the chain, after the executive decision; never one’s own request',
  },
  {
    id: 'recruiting.manage',
    name: 'Run Recruiting',
    description:
      'Open a position for an approved hiring request, manage its candidates, make offers inside the approved terms and record the answers (surface: the recruiting routes)',
  },
  {
    id: 'recruiting.read',
    name: 'Read Recruiting',
    description:
      'See every job opening and candidate of the organization, including offers (surface: the recruiting reads)',
  },
  {
    id: 'recruiting.interview',
    name: 'Interview Candidates',
    description:
      'See the candidates of the openings one is the hiring manager of, and record interview feedback — never offer amounts',
  },
  {
    id: 'workflows.read',
    name: 'Read Workflows',
    description: 'Read workflow instances (existing surface: workflow listing)',
  },
  {
    id: 'workflows.execute',
    name: 'Execute Workflows',
    description: 'Start and execute a workflow (existing surface: workflow start)',
  },
  {
    id: 'approvals.read',
    name: 'Read Approvals',
    description:
      'Read approval requests (existing surface: the AI runtime approval engine and notification inbox)',
  },
  {
    id: 'approvals.create',
    name: 'Create Approvals',
    description:
      'Open an approval request (created by the approval engine when a gated action runs)',
  },
  {
    id: 'workspaces.list',
    name: 'List Workspaces',
    description: "List the caller's workspaces (existing surface: AI list-workspaces tool)",
  },
  {
    id: 'workspaces.create',
    name: 'Create Workspaces',
    description:
      'Create a workspace (existing surface: workspace creation + AI create-workspace tool)',
  },
  {
    id: 'projects.assign',
    name: 'Assign Projects',
    description:
      'Assign an employee to a project (existing surface: project assignment + AI assign tool)',
  },
  {
    id: 'calendar.create',
    name: 'Create Calendar Events',
    description:
      'Create a calendar event (existing surface: calendar creation + AI create-event tool)',
  },
  // S25 Phase 7: external enterprise connectors (GitHub + Slack). Each
  // capability maps to a real, executable connector tool surface where one
  // exists — a definition is never presented as executable when the
  // connector is not configured for the tenant.
  {
    id: 'github.repositories.read',
    name: 'Read GitHub Repositories',
    description:
      'Read GitHub repositories (existing surface: GitHub connector repository list/get)',
  },
  {
    id: 'github.issues.read',
    name: 'Read GitHub Issues',
    description: 'Read GitHub issues (existing surface: GitHub connector issue list)',
  },
  {
    id: 'github.issues.create',
    name: 'Create GitHub Issues',
    description: 'Create a GitHub issue (existing surface: GitHub connector governed issue create)',
  },
  {
    id: 'slack.channels.read',
    name: 'Read Slack Channels',
    description: 'Read Slack channels (existing surface: Slack connector channel list)',
  },
  {
    id: 'slack.messages.read',
    name: 'Read Slack Messages',
    description:
      'Read recent Slack messages (existing surface: Slack connector conversation history)',
  },
  {
    id: 'slack.messages.send',
    name: 'Send Slack Messages',
    description: 'Send a Slack message (existing surface: Slack connector governed message send)',
  },
  // S34 RBAC: the small set of additional permission ids needed to gate the
  // surfaces the S24 catalog didn't yet cover (organization overview,
  // detected problems, insights, the business-agent surface, and deciding —
  // not just opening — an approval). Each gates a real existing route; none
  // invents a new one.
  {
    id: 'organization.read',
    name: 'Read Organization',
    description:
      'Read organization-level overview data (existing surface: the dashboard/overview route)',
  },
  {
    id: 'problems.read',
    name: 'Read Problems',
    description:
      'List detected business problems (existing surface: the problems console list/scan)',
  },
  {
    id: 'problems.investigate',
    name: 'Investigate Problems',
    description:
      'Open a single problem’s full investigation — evidence, root cause, known solutions (existing surface: the problems console detail read)',
  },
  {
    id: 'insights.read',
    name: 'Read Insights',
    description:
      'Read the tenant measurement/insights snapshot (existing surface: the insights route)',
  },
  {
    id: 'agent.use',
    name: 'Use Agent',
    description: 'View the caller’s governed business agent (existing surface: GET /api/agent)',
  },
  {
    id: 'agent.execute',
    name: 'Execute Agent',
    description:
      'Execute a governed agent proposal or free-form intent (existing surface: the agent execute routes)',
  },
  {
    id: 'approvals.decide',
    name: 'Decide Approvals',
    description:
      'Approve or reject an approval request (existing surface: the approval decision route) — distinct from approvals.create/approvals.read: deciding is authorizing an action, not merely seeing or opening one',
  },
  {
    id: 'activity.read',
    name: 'Read Activity',
    description:
      'Read the recent business activity feed (existing surface: the activity feed read)',
  },
  {
    id: 'calendar.read',
    name: 'Read Calendar',
    description: 'Read calendar events (existing surface: calendar listing)',
  },
  {
    id: 'audit.read',
    name: 'Read Audit Trail',
    description:
      "Read the unified cross-module audit trail — agent executions, approval decisions, workflow step outcomes, and business activity (existing surface: the Audit Center). Governance/oversight scope, distinct from any single module's own read capability.",
  },
  // Policy administration (Prompt 8). Human-only: both are NON_DELEGABLE for
  // agents and never exposed on any AI tool — AI is not authority.
  {
    id: 'policy.read',
    name: 'Read Policies',
    description:
      "Read the central policy registry, each policy's current configuration and its version history (existing surface: the Policy Administration routes). Read-only; never delegable to an agent.",
  },
  {
    id: 'policy.manage',
    name: 'Manage Policies',
    description:
      'Create a new version of, enable or disable an organization-configurable policy — structured, validated, tighten-only configuration (existing surface: the Policy Administration routes). Human-only; never delegable to an agent.',
  },
  // S35 Finance vertical: budgets and expenses (existing surface: the
  // Finance REST routes + the CFO workspace). Deliberately scoped to
  // finance.cfo only — Finance is a real, single-owner vertical, not a
  // company-wide read like calendar/audit.
  {
    id: 'budgets.read',
    name: 'Read Budgets',
    description:
      'List and read budgets in a workspace (existing surface: the Finance budget routes)',
  },
  {
    id: 'budgets.manage',
    name: 'Manage Budgets',
    description:
      'Create, revise, close, and clear the review flag of a budget (existing surface: the Finance budget routes)',
  },
  {
    id: 'expenses.read',
    name: 'Read Expenses',
    description:
      'List and read expenses in a workspace (existing surface: the Finance expense routes)',
  },
  {
    id: 'expenses.create',
    name: 'Submit Expenses',
    description:
      'Submit an expense claim against a budget (existing surface: the Finance expense routes + AI submit-expense tool)',
  },
  {
    id: 'expenses.decide',
    name: 'Decide Expenses',
    description:
      'Approve or reject a pending expense (existing surface: the Finance expense decision route) — a real money movement (BR-19), distinct from expenses.read/expenses.create.',
  },
  // Backend RBAC enforcement: the last two mutating surfaces the S24/S34
  // catalog did not yet cover — inbound webhook administration and the
  // workspace app lifecycle. Each gates a real existing route; a role
  // without the capability now gets 403 where before any org/workspace
  // member could act.
  {
    id: 'integrations.manage',
    name: 'Manage Integrations',
    description:
      'Create, update, enable, and delete inbound webhook endpoints (existing surface: the integrations webhook routes)',
  },
  {
    id: 'marketplace.manage',
    name: 'Manage Marketplace Apps',
    description:
      'Install, update, and uninstall workspace apps (existing surface: the marketplace app lifecycle routes)',
  }, // Prompt 4: agent identity + delegated capabilities. Creating agents,
  // granting/revoking delegations, and suspending/revoking agents is a
  // human-only governance permission — never mapped to an AI capability and
  // never delegable to an agent.
  {
    id: 'agents.manage',
    name: 'Manage Agents',
    description:
      'Create agent identities, grant and revoke their delegated capabilities, and suspend or revoke agents (existing surface: the /api/agents management routes)',
  },
];
