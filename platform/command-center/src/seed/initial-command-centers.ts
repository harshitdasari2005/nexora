/**
 * @nexora/module-command-center — initial command centers (S24 Phase 2).
 *
 * The first three command-center configurations: CEO (executive.ceo),
 * Manager (delivery.manager), and Developer (technology.developer). These
 * are CONFIGURATION ONLY — all three render through the SAME generic
 * engine; there is no role-specific page or rendering logic anywhere. The
 * role determines which widgets are composed, never which renderer is used.
 *
 * Every widget data source is real persisted Nexora data resolved through
 * the EXISTING application services (measurements, activity, notifications,
 * projects, employees, documents, knowledge). No fabricated business
 * metrics: where a tenant has no data, the widget renders an honest empty
 * state. Actions are read/navigation only in Phase 2 (governed execution
 * belongs to later phases).
 *
 * These are INITIAL REGISTRATIONS ONLY — other roles (finance.cfo, etc.)
 * have no command center yet and fail safely. A future domain (e.g. Legal)
 * registers its own command center without touching this engine.
 */

import type { CommandCenterDefinition } from '@nexora/contracts/command-center';

/** The initial command-center definitions (S24 Phase 2 registrations). */
export const INITIAL_COMMAND_CENTERS: readonly CommandCenterDefinition[] = [
  {
    id: 'ceo',
    name: 'Command Center',
    domainId: 'executive',
    roleId: 'executive.ceo',
    description: 'Organization-level visibility: what requires executive attention.',
    widgets: [
      {
        id: 'projects_kpi',
        type: 'kpi',
        title: 'Projects',
        description: 'Projects across the organization',
        dataSource: 'measurements.overview.projects',
        span: 1,
      },
      {
        id: 'users_kpi',
        type: 'kpi',
        title: 'Users',
        description: 'Registered users across the organization',
        dataSource: 'measurements.overview.users',
        span: 1,
      },
      {
        id: 'workflow_health',
        type: 'list',
        title: 'Workflow health',
        description: 'Success and failure across workflow definitions',
        dataSource: 'workflows.health',
        span: 2,
      },
      {
        id: 'attention',
        type: 'attention',
        title: 'Needs your attention',
        description: 'Unread notifications for you',
        dataSource: 'notifications.unread',
        span: 2,
      },
      {
        id: 'activity',
        type: 'activity',
        title: 'Recent activity',
        description: 'Latest business activity in the organization',
        dataSource: 'activity.recent',
        span: 2,
      },
    ],
    actions: [
      { id: 'view_projects', label: 'View projects', kind: 'navigate', href: '/app/projects' },
      { id: 'view_insights', label: 'View insights', kind: 'navigate', href: '/app/insights' },
      { id: 'view_workflows', label: 'View workflows', kind: 'navigate', href: '/app/workflows' },
    ],
  },
  {
    id: 'manager',
    name: 'Command Center',
    domainId: 'delivery',
    roleId: 'delivery.manager',
    description: 'Team and execution focus: what your team needs attention on.',
    widgets: [
      {
        id: 'team_kpi',
        type: 'kpi',
        title: 'Team members',
        description: 'Active employees in the organization',
        dataSource: 'employees.active',
        span: 1,
      },
      {
        id: 'projects_kpi',
        type: 'kpi',
        title: 'Active projects',
        description: 'Projects currently in active status',
        dataSource: 'projects.active',
        span: 1,
      },
      {
        id: 'projects',
        type: 'list',
        title: 'Projects',
        description: 'All projects in the organization',
        dataSource: 'projects.list',
        span: 2,
      },
      {
        id: 'team',
        type: 'list',
        title: 'Team',
        description: 'Employees in the organization',
        dataSource: 'employees.list',
        span: 2,
      },
      {
        id: 'attention',
        type: 'attention',
        title: 'Needs attention',
        description: 'Unread notifications for you',
        dataSource: 'notifications.unread',
        span: 2,
      },
      {
        id: 'activity',
        type: 'activity',
        title: 'Recent activity',
        description: 'Latest business activity in the organization',
        dataSource: 'activity.recent',
        span: 2,
      },
    ],
    actions: [
      { id: 'view_projects', label: 'View projects', kind: 'navigate', href: '/app/projects' },
      { id: 'view_team', label: 'View employees', kind: 'navigate', href: '/app/employees' },
      { id: 'view_workflows', label: 'View workflows', kind: 'navigate', href: '/app/workflows' },
    ],
  },
  {
    id: 'developer',
    name: 'Command Center',
    domainId: 'technology',
    roleId: 'technology.developer',
    description: 'Individual execution: what you need to work on or investigate.',
    widgets: [
      {
        id: 'projects_kpi',
        type: 'kpi',
        title: 'Active projects',
        description: 'Projects currently in active status',
        dataSource: 'projects.active',
        span: 1,
      },
      {
        id: 'documents',
        type: 'list',
        title: 'Documents',
        description: 'Documents in this workspace',
        dataSource: 'documents.list',
        span: 2,
      },
      {
        id: 'knowledge',
        type: 'list',
        title: 'Knowledge',
        description: 'Knowledge articles in this workspace',
        dataSource: 'knowledge.articles',
        span: 2,
      },
      {
        id: 'attention',
        type: 'attention',
        title: 'Needs your attention',
        description: 'Unread notifications for you',
        dataSource: 'notifications.unread',
        span: 2,
      },
      {
        id: 'activity',
        type: 'activity',
        title: 'Recent activity',
        description: 'Latest business activity in the organization',
        dataSource: 'activity.recent',
        span: 2,
      },
    ],
    actions: [
      { id: 'view_documents', label: 'View documents', kind: 'navigate', href: '/app/documents' },
      { id: 'view_knowledge', label: 'View knowledge', kind: 'navigate', href: '/app/knowledge' },
      { id: 'view_projects', label: 'View projects', kind: 'navigate', href: '/app/projects' },
    ],
  },
];
