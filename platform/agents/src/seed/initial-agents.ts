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
 * These are INITIAL REGISTRATIONS ONLY — other roles (finance.cfo, etc.)
 * have no agent yet and fail safely. A future domain (e.g. Legal) registers
 * its own agent without touching this engine.
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
];
