/**
 * @nexora/app-api — the deterministic Demo World.
 *
 * ONE isolated demo organization whose every id is derived from a stable name
 * (never random), so the demo seeds byte-identical rows every time and a reset
 * can target exactly what the demo owns. It is defined with the SAME fixture
 * vocabulary the evaluation dataset uses and is materialized by the SAME
 * seeder (`seedWorld`) — the demo is real backend state, never React state.
 *
 * Personas are real users. Their business roles are RESOLVED by the platform
 * from membership tier × workspace type (business-role-resolver.ts) — the demo
 * never assigns a role directly:
 *
 *   CEO                owner of the organization + Engineering  → executive.ceo
 *                      (plus an `executive` seat in every other workspace:
 *                      sees everything and can raise any request there as the
 *                      CEO, never decides as CFO/HR)
 *   CTO                owner of Technology Office               → technology.cto
 *   Team Manager       admin of the organization + Engineering  → delivery.manager
 *   Developers (IT)    members of Engineering                   → technology.developer
 *   HR Manager         owner of People & Culture                → people.hr
 *   CFO                admin of Finance                         → finance.cfo
 *   Finance Controller member of Finance                        → finance.cfo capability set
 *
 * Approval authority is ordinary organization configuration
 * (POLICY_APPROVAL_AUTHORITY), enforced by the central policy engine and the
 * approval engine — no demo-only approval code exists:
 *
 *   hiring   the CEO requests; a `delivery.manager` (the Team Manager) decides;
 *            the requester can never decide their own request.
 *   finance  the Controller submits; a `finance.cfo` decides; the submitter can
 *            never decide their own expense.
 *
 * Every value is fictional application data for demonstration.
 */

import { deterministicId, WorldBuilder, type ScenarioWorld } from '@nexora/evaluation';

/** The world id (also its deterministic-id namespace). */
export const DEMO_WORLD_ID = 'nexora-demo-v1';

/** The fixed instant every demo fixture timestamp derives from. */
export const DEMO_REFERENCE_TIME = '2026-09-01T09:00:00.000Z';

/** The demo personas, in presentation order. */
export const DEMO_PERSONA_KEYS = [
  'ceo',
  'cto',
  'manager',
  'dev_aarav',
  'dev_meghna',
  'hr',
  'cfo',
  'controller',
] as const;
export type DemoPersonaKey = (typeof DEMO_PERSONA_KEYS)[number];

/** The demo workspaces (one per department a persona can sit in). */
export const DEMO_WORKSPACE_KEYS = ['eng', 'tech', 'hr', 'fin'] as const;
export type DemoWorkspaceKey = (typeof DEMO_WORKSPACE_KEYS)[number];

/** The business role each persona is EXPECTED to resolve to (asserted by tests, never assigned). */
export interface DemoPersonaDefinition {
  key: DemoPersonaKey;
  email: string;
  displayName: string;
  title: string;
  /** What the persona does in the story. */
  responsibility: string;
  /** The workspace key the persona starts in. */
  workspace: DemoWorkspaceKey;
  /** The business role the platform resolves for them in that workspace. */
  expectedRoleId: string;
}

export const DEMO_PERSONAS: readonly DemoPersonaDefinition[] = [
  {
    key: 'ceo',
    email: 'anika.rao@lumen-capital.example',
    displayName: 'Anika Rao',
    title: 'Chief Executive Officer',
    responsibility:
      'Decides on every hiring request first. Sees every department and can raise any request.',
    workspace: 'eng',
    expectedRoleId: 'executive.ceo',
  },
  {
    key: 'cto',
    email: 'vikram.shah@lumen-capital.example',
    displayName: 'Vikram Shah',
    title: 'Chief Technology Officer',
    responsibility:
      'Leads technology. Can ask for hires, interviews candidates and helps set new colleagues up.',
    workspace: 'tech',
    expectedRoleId: 'technology.cto',
  },
  {
    key: 'manager',
    email: 'rohan.mehta@lumen-capital.example',
    displayName: 'Rohan Mehta',
    title: 'Team Manager',
    responsibility:
      'Asks for hires for the team, interviews candidates and puts new colleagues on the project.',
    workspace: 'eng',
    expectedRoleId: 'delivery.manager',
  },
  {
    key: 'dev_aarav',
    email: 'aarav.kulkarni@lumen-capital.example',
    displayName: 'Aarav Kulkarni',
    title: 'Software Developer',
    responsibility:
      'IT: sets up accounts and equipment for new colleagues, and works on assigned projects.',
    workspace: 'eng',
    expectedRoleId: 'technology.developer',
  },
  {
    key: 'dev_meghna',
    email: 'meghna.iyer@lumen-capital.example',
    displayName: 'Meghna Iyer',
    title: 'Software Developer',
    responsibility:
      'IT: sets up accounts and equipment for new colleagues, and works on assigned projects.',
    workspace: 'eng',
    expectedRoleId: 'technology.developer',
  },
  {
    key: 'hr',
    email: 'priya.menon@lumen-capital.example',
    displayName: 'Priya Menon',
    title: 'HR Manager',
    responsibility:
      'Runs recruiting: opens positions, handles candidates and offers, and starts onboarding.',
    workspace: 'hr',
    expectedRoleId: 'people.hr',
  },
  {
    key: 'cfo',
    email: 'karan.malhotra@lumen-capital.example',
    displayName: 'Karan Malhotra',
    title: 'Chief Financial Officer',
    responsibility: 'Decides on the cost of a hire after the CEO. Approves expenses.',
    workspace: 'fin',
    expectedRoleId: 'finance.cfo',
  },
  {
    key: 'controller',
    email: 'divya.nair@lumen-capital.example',
    displayName: 'Divya Nair',
    title: 'Finance Controller',
    responsibility: 'Keeps the books: submits expenses against the budgets.',
    workspace: 'fin',
    expectedRoleId: 'finance.cfo',
  },
];

/** The capability-prefix rules seeded as POLICY_APPROVAL_AUTHORITY. */
export const DEMO_APPROVAL_AUTHORITY_RULES = [
  { capabilityPrefix: 'hr.', requiredApproverRoleId: 'delivery.manager', separationOfDuties: true },
  {
    capabilityPrefix: 'workflow.',
    requiredApproverRoleId: 'delivery.manager',
    separationOfDuties: true,
  },
  { capabilityPrefix: 'finance.', requiredApproverRoleId: 'finance.cfo', separationOfDuties: true },
] as const;

/** The story's canonical hiring request (the planner accepts a name only). */
export const DEMO_HIRE_REQUEST =
  'Hire Sarah Thomas and assign her to the Mobile Banking Platform project.';

/**
 * What the Guided Demo suggests for the hiring story (the manager may change
 * any of it — these only pre-fill the forms; nothing is created from them).
 */
export const DEMO_HIRING_SUGGESTION = {
  jobTitle: 'Senior Backend Developer',
  department: 'Engineering Delivery',
  headcount: 1,
  employmentType: 'full_time',
  salaryMinMinorUnits: 180_000_000,
  salaryMaxMinorUnits: 240_000_000,
  currency: 'INR',
  urgency: 'high',
  justification:
    'The Mobile Banking Platform rebuild needs one more backend engineer to hit the Q4 date.',
  jobPosting:
    'Build and run the backend services of the Mobile Banking Platform with the delivery team.',
  candidateName: 'Sarah Thomas',
  candidateEmail: 'sarah.thomas@example.com',
} as const;

/** The demo project the hire is assigned to. */
export const DEMO_PROJECT_NAME = 'Mobile Banking Platform';

/** The demo budget's display name. */
export const DEMO_BUDGET_NAME = 'Mobile Banking Delivery Budget';

/** The demo expense the Controller submits (minor units, INR). */
export const DEMO_EXPENSE = {
  description: 'Mobile device test lab licences',
  amountMinorUnits: 4_500_000,
  currency: 'INR',
} as const;

/** Builds the demo world (pure, deterministic). */
export function buildDemoWorld(): ScenarioWorld {
  const builder = new WorldBuilder(DEMO_WORLD_ID, DEMO_REFERENCE_TIME)
    .organization('lumen', {
      slug: 'lumen-capital-demo',
      name: 'Lumen Capital (Demo)',
      auditor: { user: 'ceo', workspace: 'eng' },
    })
    .workspace('eng', {
      organization: 'lumen',
      slug: 'engineering-delivery',
      name: 'Engineering Delivery',
      type: 'engineering',
    })
    .workspace('tech', {
      organization: 'lumen',
      slug: 'technology-office',
      name: 'Technology Office',
      type: 'general',
    })
    .workspace('hr', {
      organization: 'lumen',
      slug: 'people-and-culture',
      name: 'People & Culture',
      type: 'hr',
    })
    .workspace('fin', {
      organization: 'lumen',
      slug: 'finance',
      name: 'Finance',
      type: 'finance',
    });

  for (const persona of DEMO_PERSONAS) {
    builder.user(persona.key, {
      email: persona.email,
      displayName: persona.displayName,
      title: persona.title,
    });
  }

  return (
    builder
      // Organization tier: the CEO owns; the Team Manager is an ADMIN so the
      // organization-scoped employee/project routes resolve delivery.manager.
      .organizationMember('ceo', 'lumen', 'owner')
      .organizationMember('manager', 'lumen', 'admin')
      .organizationMember('controller', 'lumen', 'member')
      .organizationMember('cfo', 'lumen', 'member')
      .organizationMember('cto', 'lumen', 'member')
      .organizationMember('hr', 'lumen', 'member')
      .organizationMember('dev_aarav', 'lumen', 'member')
      .organizationMember('dev_meghna', 'lumen', 'member')
      .workspaceMember('ceo', 'eng', 'owner', 'executive.ceo')
      // The CEO holds an EXECUTIVE seat in every other department: full
      // visibility and the ability to raise requests there, as `executive.ceo`
      // — never that department's own role.
      .workspaceMember('ceo', 'tech', 'executive', 'executive.ceo')
      .workspaceMember('ceo', 'hr', 'executive', 'executive.ceo')
      .workspaceMember('ceo', 'fin', 'executive', 'executive.ceo')
      .workspaceMember('cto', 'tech', 'owner', 'technology.cto')
      .workspaceMember('manager', 'eng', 'admin', 'delivery.manager')
      .workspaceMember('dev_aarav', 'eng', 'member', 'technology.developer')
      .workspaceMember('dev_meghna', 'eng', 'member', 'technology.developer')
      .workspaceMember('hr', 'hr', 'owner', 'people.hr')
      .workspaceMember('controller', 'fin', 'member', 'finance.cfo')
      .workspaceMember('cfo', 'fin', 'admin', 'finance.cfo')
      .project('mobile-banking', {
        organization: 'lumen',
        name: DEMO_PROJECT_NAME,
        description: 'Retail mobile banking app rebuild',
        status: 'active',
      })
      .project('payments-gateway', {
        organization: 'lumen',
        name: 'Payments Gateway Upgrade',
        description: 'Gateway modernisation for card and UPI rails',
        status: 'active',
      })
      .project('kyc-onboarding', {
        organization: 'lumen',
        name: 'KYC Onboarding Revamp',
        description: 'Digital KYC onboarding redesign',
        status: 'active',
      })
      .employee('aarav', { organization: 'lumen', name: 'Aarav Kulkarni', status: 'active' })
      .employee('meghna', { organization: 'lumen', name: 'Meghna Iyer', status: 'active' })
      .employee('tanvir', { organization: 'lumen', name: 'Tanvir Shaikh', status: 'active' })
      // The period spans the whole demo horizon so the budget stays ACTIVE and
      // in-period regardless of the wall clock the presentation runs on.
      .budget('mobile-delivery', {
        organization: 'lumen',
        workspace: 'fin',
        createdBy: 'cfo',
        name: DEMO_BUDGET_NAME,
        allocatedMinorUnits: 20_000_000,
        currency: 'INR',
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2036-12-31T00:00:00.000Z',
        status: 'active',
      })
      // One already-approved expense so utilization starts non-zero and the
      // change caused by the live expense is visible.
      .expense('prior-licences', {
        organization: 'lumen',
        workspace: 'fin',
        budget: 'mobile-delivery',
        submittedBy: 'controller',
        decidedBy: 'cfo',
        description: 'Design tooling subscription (prior quarter)',
        amountMinorUnits: 4_000_000,
        currency: 'INR',
        status: 'approved',
      })
      .policy('approval-authority', {
        organization: 'lumen',
        policyId: 'POLICY_APPROVAL_AUTHORITY',
        config: { rules: DEMO_APPROVAL_AUTHORITY_RULES },
        createdBy: 'ceo',
      })
      .build()
  );
}

/** The ids the demo owns, derived from the world (never from the client). */
export interface DemoIds {
  organizationId: string;
  workspaceIds: Record<DemoWorkspaceKey, string>;
  userIds: Record<DemoPersonaKey, string>;
  budgetId: string;
  projectId: string;
}

/** Resolves the demo's deterministic ids. */
export function demoIds(world: ScenarioWorld = buildDemoWorld()): DemoIds {
  const organization = world.organizations[0];
  if (organization === undefined) throw new Error('demo world has no organization');
  const workspace = (key: string) => {
    const found = world.workspaces.find((w) => w.key === key);
    if (found === undefined) throw new Error(`demo world has no workspace ${key}`);
    return found.id;
  };
  const user = (key: string) => {
    const found = world.users.find((u) => u.key === key);
    if (found === undefined) throw new Error(`demo world has no user ${key}`);
    return found.id;
  };
  const entity = (key: string) => {
    const found = world.entities.find((e) => e.key === key);
    if (found === undefined || !('id' in found)) throw new Error(`demo world has no entity ${key}`);
    return found.id;
  };
  return {
    organizationId: organization.id,
    workspaceIds: Object.fromEntries(
      DEMO_WORKSPACE_KEYS.map((key) => [key, workspace(key)]),
    ) as Record<DemoWorkspaceKey, string>,
    userIds: Object.fromEntries(DEMO_PERSONA_KEYS.map((key) => [key, user(key)])) as Record<
      DemoPersonaKey,
      string
    >,
    budgetId: entity('mobile-delivery'),
    projectId: entity('mobile-banking'),
  };
}

/** A stable id derived in the demo namespace (exported for tests). */
export function demoDeterministicId(prefix: string, name: string): string {
  return deterministicId(prefix, `${DEMO_WORLD_ID}/${name}`);
}
