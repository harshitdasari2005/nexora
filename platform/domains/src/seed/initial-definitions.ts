/**
 * @nexora/module-domains — initial registrations (S24 Phase 1).
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
 * Role `capabilityIds` are BUSINESS AFFINITY, never a grant (ROLE ≠
 * PERMISSION): they say what the role's work is ABOUT. Phase 3 assigned
 * affinities to the roles that power role-aware experiences (executive.ceo,
 * delivery.manager, technology.developer) — each maps to existing executable
 * AI capabilities via the API-layer bridge. Other roles keep empty
 * affinities (no AI focus — discovery stays unrestricted for them, which is
 * the safe default). The role → capability relationship is validated by
 * tests and the Legal extensibility fixture.
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
    // (GitHub + Slack) are within executive focus.
    capabilityIds: [
      'workspaces.list',
      'workspaces.create',
      'projects.read',
      'projects.create',
      'projects.assign',
      'documents.read',
      'knowledge.read',
      'employees.read',
      'employees.manage',
      'workflows.read',
      'workflows.execute',
      'approvals.read',
      'calendar.create',
      'github.repositories.read',
      'github.issues.read',
      'github.issues.create',
      'slack.channels.read',
      'slack.messages.read',
      'slack.messages.send',
    ],
  },
  {
    id: 'finance.cfo',
    name: 'CFO',
    description: 'Chief Financial Officer',
    domainId: 'finance',
    capabilityIds: [],
  },
  {
    id: 'people.hr',
    name: 'HR / CHRO',
    description: 'Human resources / Chief Human Resources Officer',
    domainId: 'people',
    capabilityIds: [],
  },
  {
    id: 'technology.cto',
    name: 'CTO',
    description: 'Chief Technology Officer',
    domainId: 'technology',
    capabilityIds: [],
  },
  {
    id: 'technology.engineering_manager',
    name: 'Engineering Manager',
    description: 'Leads an engineering team',
    domainId: 'technology',
    capabilityIds: [],
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
    // work surface); Slack stays outside the Developer focus.
    capabilityIds: [
      'projects.read',
      'documents.read',
      'knowledge.read',
      'workflows.read',
      'approvals.read',
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
    capabilityIds: [],
  },
  {
    id: 'growth.marketing_manager',
    name: 'Marketing Manager',
    description: 'Leads marketing',
    domainId: 'growth',
    capabilityIds: [],
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
    capabilityIds: [],
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
    // focus, never surveillance).
    capabilityIds: [
      'projects.read',
      'projects.create',
      'documents.read',
      'knowledge.read',
      'employees.read',
      'workflows.read',
      'workflows.execute',
      'approvals.read',
      'github.repositories.read',
      'github.issues.read',
      'github.issues.create',
      'slack.channels.read',
      'slack.messages.send',
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
    capabilityIds: [],
  },
  {
    id: 'legal.compliance_manager',
    name: 'Compliance Manager',
    description: 'Leads regulatory compliance',
    domainId: 'legal',
    capabilityIds: [],
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
    capabilityIds: [],
  },
  {
    id: 'customersuccess.manager',
    name: 'Customer Success Manager',
    description: 'Owns customer outcomes and retention',
    domainId: 'customersuccess',
    capabilityIds: [],
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
    capabilityIds: [],
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
];
