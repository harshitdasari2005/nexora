/**
 * @nexora/module-agents — initial business agents (S26 Phase 8).
 *
 * The first three governed business-agent definitions: Executive
 * (executive.ceo), Manager (delivery.manager), and Developer
 * (technology.developer). These are CONFIGURATION ONLY — all three resolve
 * through the SAME generic agent engine and execute through the SAME AI
 * Runtime/ToolExecutor/ApprovalEngine; there is no role-specific agent
 * implementation anywhere. The role determines which definition resolves,
 * never which engine runs.
 *
 * Capability sets use the EXECUTABLE AI capability ids (the Phase 3 bridge
 * vocabulary) — never raw Phase 1 business ids. Goals reference only
 * capabilities within the agent's own set (validated at registration).
 *
 * Autonomy bounds: all three are `governed_execution` — they may execute
 * only where capability + policy + approval allow; write actions stay
 * gated by the existing ApprovalEngine and reads stay tenant/workspace
 * scoped through the existing application services. No unrestricted
 * autonomy exists.
 *
 * S35 added a fourth definition: Finance (finance.cfo) — same engine, same
 * rules, registered the identical way.
 *
 * A fifth definition, HR (people.hr), is the ONLY definition whose ceiling
 * contains `hr.create_employee` (plus the hire-and-assign composite and its
 * inner capabilities). Hiring by an agent is therefore possible, but only via
 * an explicit human delegation, policy, and a human approval.
 *
 * These are INITIAL REGISTRATIONS ONLY — other roles have no agent yet and
 * fail safely. A future domain (e.g. Legal) registers its own agent without
 * touching this engine.
 */

import type { BusinessAgentDefinition } from '@nexora/contracts/agent';

/** The initial business-agent definitions (S26 Phase 8 registrations). */
export const INITIAL_AGENTS: readonly BusinessAgentDefinition[] = [
  {
    id: 'executive',
    name: 'Executive Agent',
    domainId: 'executive',
    roleId: 'executive.ceo',
    description:
      'Organization-level oversight: identifies what requires executive attention from real persisted data (workflow health, projects, activity, knowledge) and proposes governed actions.',
    autonomyLevel: 'governed_execution',
    capabilityIds: [
      'workspaces.list_workspaces',
      'projects.find_project',
      'knowledge.search',
      'hr.find_employee',
      'notifications.what_needs_attention',
      'notifications.mark_all_read',
      'calendar.create_event',
      'github.repositories.list',
      'github.repositories.get',
      'github.issues.list',
      'github.issues.create',
      'slack.channels.list',
      'slack.messages.recent',
      'slack.messages.send',
    ],
    goals: [
      {
        id: 'executive.attention',
        name: 'Identify what needs attention',
        description:
          'Surfaces the organization-level attention items (activity, notifications) so the executive can act on real, persisted signals.',
        capabilityIds: ['notifications.what_needs_attention', 'notifications.mark_all_read'],
      },
      {
        id: 'executive.insights',
        name: 'Organization health and insight',
        description:
          'Synthesizes real project, workflow, and knowledge signals into an explainable organization view — never fabricated metrics.',
        capabilityIds: ['projects.find_project', 'knowledge.search'],
      },
    ],
    policies: [
      {
        id: 'writes.require_approval',
        statement:
          'Every write action (calendar, GitHub issue, Slack message) executes only through the existing approval engine — never autonomously.',
      },
      {
        id: 'reads.tenant_scoped',
        statement:
          'All reads resolve through the existing tenant/workspace-scoped application services; the agent never reaches repositories directly.',
      },
    ],
  },
  {
    id: 'manager',
    name: 'Manager Agent',
    domainId: 'delivery',
    roleId: 'delivery.manager',
    description:
      'Team and execution focus: identifies overdue or attention-worthy operational work from real projects, workflows, notifications, and communication surfaces, and proposes governed actions.',
    autonomyLevel: 'governed_execution',
    capabilityIds: [
      'projects.find_project',
      'knowledge.search',
      'hr.find_employee',
      'workflow.create_project_and_assign_employee',
      'workflow.hire_and_assign_employee',
      'notifications.what_needs_attention',
      'github.repositories.list',
      'github.issues.list',
      'github.issues.create',
      'slack.channels.list',
      'slack.messages.send',
    ],
    goals: [
      {
        id: 'manager.attention',
        name: 'Identify overdue operational work',
        description:
          'Finds projects, workflows, and notifications that need the team\u2019s attention and proposes what the manager should do — from real persisted state.',
        capabilityIds: ['notifications.what_needs_attention', 'projects.find_project'],
      },
      {
        id: 'manager.communication',
        name: 'Coordinate through communication surfaces',
        description:
          'Uses GitHub issue and Slack surfaces (where capabilities permit) to keep work visible — every write stays governed.',
        capabilityIds: ['github.issues.create', 'slack.messages.send'],
      },
    ],
    policies: [
      {
        id: 'writes.require_approval',
        statement:
          'Every write action (GitHub issue, Slack message) executes only through the existing approval engine — never autonomously.',
      },
      {
        id: 'no.message_history_read',
        statement:
          'The Manager agent never reads Slack message history (outside its capability set); communication focus, never surveillance.',
      },
    ],
  },
  {
    id: 'developer',
    name: 'Developer Agent',
    domainId: 'technology',
    roleId: 'technology.developer',
    description:
      'Individual execution: identifies unresolved technical issues from real GitHub repositories, projects, knowledge, and notifications, and proposes governed technical actions.',
    autonomyLevel: 'governed_execution',
    capabilityIds: [
      'projects.find_project',
      'knowledge.search',
      'notifications.what_needs_attention',
      'github.repositories.list',
      'github.repositories.get',
      'github.issues.list',
      'github.issues.create',
    ],
    goals: [
      {
        id: 'developer.technical_issues',
        name: 'Identify unresolved technical issues',
        description:
          'Surfaces open GitHub issues and relevant project/knowledge context so the developer knows what to work on or investigate — real persisted data only.',
        capabilityIds: ['github.issues.list', 'projects.find_project'],
      },
      {
        id: 'developer.research',
        name: 'Research and context',
        description:
          'Finds relevant projects, knowledge, and notifications to ground technical work in the organization\u2019s real state.',
        capabilityIds: ['knowledge.search', 'notifications.what_needs_attention'],
      },
    ],
    policies: [
      {
        id: 'writes.require_approval',
        statement:
          'Every write action (GitHub issue) executes only through the existing approval engine — never autonomously.',
      },
      {
        id: 'no.slack',
        statement:
          'The Developer agent has no Slack surface (outside its capability set); it never reads or sends Slack messages.',
      },
    ],
  },
  {
    id: 'finance',
    name: 'Finance Agent',
    domainId: 'finance',
    roleId: 'finance.cfo',
    description:
      'Financial oversight: identifies budget and expense signals needing attention from real persisted data and proposes governed financial actions.',
    autonomyLevel: 'governed_execution',
    capabilityIds: [
      'notifications.what_needs_attention',
      'finance.submit_expense',
      'finance.flag_over_budget_items',
    ],
    goals: [
      {
        id: 'finance.attention',
        name: 'Identify budget and expense signals needing attention',
        description:
          'Surfaces pending expense approvals and budget-utilization risk so the CFO can act on real, persisted financial signals.',
        capabilityIds: ['notifications.what_needs_attention'],
      },
      {
        id: 'finance.expenses',
        name: 'Submit expense claims',
        description:
          'Submits an expense claim against a budget on the CFO’s behalf — always gated by approval (BR-19 money movement).',
        capabilityIds: ['finance.submit_expense'],
      },
      {
        id: 'finance.remediation',
        name: 'Flag over-budget items for review',
        description:
          'Re-scans active budgets and flags the ones over the deterministic utilization threshold — the remediation action behind the finance_budget_overrun signal.',
        capabilityIds: ['finance.flag_over_budget_items'],
      },
    ],
    policies: [
      {
        id: 'writes.require_approval',
        statement:
          'Every write action (expense submission, budget review flagging) executes only through the existing approval engine — never autonomously.',
      },
      {
        id: 'money.consequential',
        statement:
          'Money-movement and budget-review actions are Consequential (BR-13/BR-19) and always require human approval — the agent never decides a threshold or grants itself an approval.',
      },
    ],
  },
  {
    id: 'hr',
    name: 'HR Agent',
    domainId: 'people',
    roleId: 'people.hr',
    description:
      'People operations: hires employees and assigns them to projects on behalf of a human who explicitly delegated that authority. Every hire is Consequential and stays behind a human approval.',
    autonomyLevel: 'governed_execution',
    // The capability CEILING for hiring. Until this definition existed no
    // definition contained `hr.create_employee` (or the composite's inner
    // capabilities), so an agent could never hire — a delegation could not
    // exceed the (empty) ceiling. The ceiling grants NOTHING by itself: an
    // agent still needs (a) an active, unexpired delegation per capability,
    // granted by a human who currently holds it (`agents.manage`, humans
    // only), (b) an initiator who holds the capability, (c) policy ALLOW, and
    // (d) a human approval decided by someone other than the agent — the
    // agent can never decide (approvals.decide is non-delegable).
    capabilityIds: [
      'hr.find_employee',
      'hr.create_employee',
      'projects.find_project',
      'projects.assign_employee',
      'workflow.hire_and_assign_employee',
    ],
    goals: [
      {
        id: 'hr.hire',
        name: 'Hire an employee',
        description:
          'Creates an employee record on a human requester\u2019s behalf — always gated by a human approval; the agent never approves its own action.',
        capabilityIds: ['hr.create_employee', 'hr.find_employee'],
      },
      {
        id: 'hr.onboard',
        name: 'Hire and assign to a project',
        description:
          'Runs the governed hire-and-assign workflow: one human approval for the unit, inner steps bounded by the agent\u2019s own effective (delegated) capabilities.',
        capabilityIds: [
          'workflow.hire_and_assign_employee',
          'hr.create_employee',
          'projects.find_project',
          'projects.assign_employee',
        ],
      },
    ],
    policies: [
      {
        id: 'writes.require_approval',
        statement:
          'Every write action (hire, assignment) executes only through the existing approval engine — never autonomously.',
      },
      {
        id: 'delegation.required',
        statement:
          'The HR agent holds no authority of its own: each capability must be explicitly delegated by a human who holds it, and revoking, expiring or suspending it stops the run even after an approval was granted.',
      },
      {
        id: 'no.self_approval',
        statement:
          'The HR agent can never decide or approve an approval, manage agents or grant delegations (non-delegable capabilities).',
      },
    ],
  },
];
