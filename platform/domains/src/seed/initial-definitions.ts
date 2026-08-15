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
 * executable (S24: do not pretend). Seed roles carry empty `capabilityIds`:
 * capability affinity is business context assigned when role-aware
 * experiences exist (later phases), never a grant. The role → capability
 * relationship itself is validated and proven by tests and the Legal
 * extensibility fixture.
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
];

/** The initial business roles (S24 Phase 1 registrations). */
export const INITIAL_ROLES: readonly DomainRoleDefinition[] = [
  {
    id: 'executive.ceo',
    name: 'CEO',
    description: 'Chief Executive Officer',
    domainId: 'executive',
    capabilityIds: [],
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
    capabilityIds: [],
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
    capabilityIds: [],
  },
  {
    id: 'delivery.project_manager',
    name: 'Project Manager',
    description: 'Drives project execution',
    domainId: 'delivery',
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
];
