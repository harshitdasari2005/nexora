/**
 * @nexora/app-web — six-persona role experience layer (S35).
 *
 * The trusted backend exposes 20 granular business roles across 11 domains
 * (`platform/domains` catalog) — correct for RBAC, wrong for a first-time
 * user's role switcher. This module adds a thin PRESENTATION layer on top:
 * exactly six user-facing business personas (CEO, CFO, Operations Manager,
 * CTO / Developer, HR, Legal), each bound to one or more real, already-
 * cataloged backend roleIds it may resolve to.
 *
 * This is NOT a second authorization system. A persona never grants
 * anything — it only curates which of the caller's REAL, server-resolved
 * `/api/role-context` options gets a simplified label, and which of the
 * existing nav modules get primary vs. secondary visual weight. Every
 * permission check still runs against `current.permissions` exactly as
 * before (`isModuleVisible` in `./modules.js`); a persona can hide a module
 * the caller is permitted to see (decluttering), but can never SHOW one the
 * caller lacks permission for.
 *
 * A caller whose resolved role doesn't map to any of the six personas
 * (e.g. the demo's Sales, Marketing, Product, Customer Success, or
 * Procurement workspaces) falls through untouched to the existing generic
 * per-role theme/nav behavior — nothing about those roles changes.
 */

import type { RoleContextOption } from './types.js';

/** One of the six user-facing business personas. */
export type PersonaId = 'ceo' | 'cfo' | 'operations' | 'technology' | 'hr' | 'legal';

/** A persona's complete presentation lens over the existing RBAC model. */
export interface RolePersona {
  /** Stable persona id. */
  id: PersonaId;
  /** The user-facing role label shown in the switcher (e.g. "CEO"). */
  displayRole: string;
  /** The one-line focus shown under the role label (e.g. "Business & Strategy"). */
  focusLabel: string;
  /**
   * The real, already-cataloged backend roleIds this persona may resolve
   * to, in preference order. The FIRST id with a matching real membership
   * (from `/api/role-context`'s `options`) becomes this persona's target —
   * never a fabricated one. Technology deliberately lists all three of the
   * engineering hierarchy's roles (CTO, Engineering Manager, Developer) so
   * one persona covers the whole domain without a second top-level choice.
   */
  candidateRoleIds: readonly string[];
  /** Nav item labels (matching `AppShell`'s `BASE_NAV_ITEMS`) shown with primary weight. */
  primaryModules: readonly string[];
  /** Nav item labels shown with secondary (deprioritized) weight. */
  secondaryModules: readonly string[];
  /** Display-only nav label substitutions (e.g. "Agent" reads as "Approvals"). */
  navLabelOverrides?: Readonly<Record<string, string>>;
  /** Role-specific AI Assistant suggested prompts (replaces the generic default set). */
  aiPrompts: readonly string[];
  /**
   * Which of the Command Center's two secondary-tier blocks — risk/approval
   * SIGNALS (workflow health, risk lists) or the ACTIVITY-adjacent supporting
   * KPIs — reads first for this persona. Decision-and-risk roles (CEO, CFO,
   * HR, Legal — the six personas' own descriptions center on risks,
   * approvals, and signals) put signals first; execution roles (Operations,
   * Technology — centered on bottlenecks and engineering/delivery activity)
   * put the supporting KPIs first instead. This is the ONE place a persona
   * varies the Command Center's structure, not just its labels/data — every
   * role keeps the same top-level Health → Attention → Activity → Secondary
   * order (S44), since that consistency is what lets a first-time user
   * always know where to look.
   */
  secondaryEmphasis: 'signals-first' | 'kpi-first';
  /**
   * The premium, honest empty state shown when the Command Center has NO
   * widgets at all for a given section (e.g. a role with zero KPI widgets
   * composed) — used instead of silently omitting the section, so its
   * absence reads as "checked, nothing here yet" rather than a missing
   * load. Never backs a fabricated number; only ever replaces a section
   * that would otherwise render nothing.
   */
  emptyState: { title: string; description: string };
}

/** Every persona's "Agent" nav item is really its governed proposals/approvals surface. */
const APPROVALS_LABEL_OVERRIDE = { Agent: 'Approvals' } as const;

/** The six curated user-facing personas, in switcher display order. */
export const ROLE_PERSONAS: readonly RolePersona[] = [
  {
    id: 'ceo',
    displayRole: 'CEO',
    focusLabel: 'Business & Strategy',
    candidateRoleIds: ['executive.ceo'],
    primaryModules: [
      'Command Center',
      'Problems',
      'AI Assistant',
      'Insights',
      'Projects',
      'Agent',
      'Hiring',
      'Recruiting',
      'Search',
      'Settings',
    ],
    secondaryModules: [
      'Calendar',
      'Audit',
      'Runtime',
      'Policy',
      'Approval Queue',
      'Workflows',
      'Employees',
      'Documents',
      'Knowledge',
    ],
    navLabelOverrides: APPROVALS_LABEL_OVERRIDE,
    secondaryEmphasis: 'kpi-first',
    aiPrompts: [
      'What should I focus on today?',
      'What risks need my attention?',
      'Which projects are at risk?',
      'Summarize the business.',
    ],
    emptyState: {
      title: 'No business signals yet',
      description: 'Your organization currently has nothing new to report here.',
    },
  },
  {
    id: 'cfo',
    displayRole: 'CFO',
    focusLabel: 'Financial Operations',
    candidateRoleIds: ['finance.cfo'],
    primaryModules: [
      'Command Center',
      'Finance',
      'Problems',
      'AI Assistant',
      'Insights',
      'Workflows',
      'Agent',
      'Documents',
      'Hiring',
      'Search',
      'Settings',
    ],
    secondaryModules: ['Projects', 'Knowledge', 'Policy', 'Approval Queue'],
    navLabelOverrides: APPROVALS_LABEL_OVERRIDE,
    secondaryEmphasis: 'kpi-first',
    aiPrompts: [
      'What financial issues need attention?',
      'Which approvals are waiting?',
      'What financial risks do we have?',
    ],
    emptyState: {
      title: 'No financial signals available yet',
      description: 'Connect financial data to surface CFO-level insights.',
    },
  },
  {
    id: 'operations',
    displayRole: 'Operations Manager',
    focusLabel: 'Delivery & Execution',
    candidateRoleIds: ['operations.manager', 'operations.head'],
    primaryModules: [
      'Command Center',
      'Problems',
      'AI Assistant',
      'Insights',
      'Projects',
      'Workflows',
      'Agent',
      'Knowledge',
      'Search',
      'Settings',
    ],
    secondaryModules: ['Employees', 'Documents', 'Approval Queue'],
    navLabelOverrides: APPROVALS_LABEL_OVERRIDE,
    secondaryEmphasis: 'signals-first',
    aiPrompts: [
      'What is blocking execution?',
      'Which projects are at risk?',
      'What can Nexora fix?',
      'Show me the remediation plan.',
    ],
    emptyState: {
      title: 'No delivery signals yet',
      description: 'Nothing is currently blocking execution.',
    },
  },
  {
    id: 'technology',
    displayRole: 'CTO / Developer',
    focusLabel: 'Technology & Engineering',
    candidateRoleIds: ['technology.cto', 'technology.engineering_manager', 'technology.developer'],
    primaryModules: [
      'Command Center',
      'Problems',
      'AI Assistant',
      'Insights',
      'Projects',
      'Workflows',
      'Knowledge',
      'Integrations',
      'Hiring',
      'Recruiting',
      'Search',
      'Settings',
    ],
    secondaryModules: ['Agent', 'Documents', 'Approval Queue'],
    navLabelOverrides: { ...APPROVALS_LABEL_OVERRIDE, Integrations: 'GitHub / Engineering' },
    secondaryEmphasis: 'signals-first',
    aiPrompts: [
      'What technical issues need attention?',
      'Which workflows are failing?',
      'What needs to be fixed?',
      'Show me the execution plan.',
    ],
    emptyState: {
      title: 'No technical issues detected',
      description: 'Your engineering workspace is currently healthy.',
    },
  },
  {
    id: 'hr',
    displayRole: 'HR',
    focusLabel: 'People & Workplace',
    candidateRoleIds: ['people.hr'],
    primaryModules: [
      'Command Center',
      'Problems',
      'AI Assistant',
      'Insights',
      'Workflows',
      'Employees',
      'Documents',
      'Hiring',
      'Recruiting',
      'Search',
      'Settings',
    ],
    secondaryModules: ['Agent', 'Knowledge', 'Approval Queue'],
    navLabelOverrides: APPROVALS_LABEL_OVERRIDE,
    secondaryEmphasis: 'kpi-first',
    aiPrompts: [
      'What needs attention across our people?',
      'Which requests are pending?',
      'Are there any HR problems?',
    ],
    emptyState: {
      title: 'No people actions require attention',
      description: 'Your workforce is currently clear.',
    },
  },
  {
    id: 'legal',
    displayRole: 'Legal',
    focusLabel: 'Legal & Governance',
    candidateRoleIds: ['legal.general_counsel', 'legal.compliance_manager'],
    primaryModules: [
      'Command Center',
      'Audit',
      'Runtime',
      'Policy',
      'Approval Queue',
      'Problems',
      'AI Assistant',
      'Insights',
      'Workflows',
      'Agent',
      'Documents',
      'Knowledge',
      'Search',
      'Settings',
    ],
    secondaryModules: ['Projects'],
    navLabelOverrides: APPROVALS_LABEL_OVERRIDE,
    secondaryEmphasis: 'kpi-first',
    aiPrompts: [
      'What legal issues need attention?',
      'Which matters are at risk?',
      'What approvals are waiting?',
    ],
    emptyState: {
      title: 'No legal matters require attention',
      description: 'No governance risks have been detected.',
    },
  },
];

/** Resolves a real backend roleId to its curated persona, when one exists. */
export function resolvePersonaForRole(roleId: string | undefined): RolePersona | undefined {
  if (roleId === undefined) return undefined;
  return ROLE_PERSONAS.find((persona) => persona.candidateRoleIds.includes(roleId));
}

/**
 * Finds the caller's real, server-resolved option for a persona — the
 * first candidate roleId (in the persona's own preference order) that the
 * caller actually has a genuine `/api/role-context` option for. Returns
 * `undefined` when the caller has no membership resolving to any of the
 * persona's roles (never fabricates one).
 */
export function matchPersonaOption(
  persona: RolePersona,
  options: readonly RoleContextOption[],
): RoleContextOption | undefined {
  for (const roleId of persona.candidateRoleIds) {
    const match = options.find((option) => option.roleId === roleId);
    if (match !== undefined) return match;
  }
  return undefined;
}

/** One persona paired with the caller's real, matched option for it. */
export interface PersonaOption {
  persona: RolePersona;
  option: RoleContextOption;
}

/**
 * Builds the switcher's curated list: every one of the six personas the
 * caller has a genuine real-membership match for, in fixed display order.
 * A persona the caller has no matching membership for is simply absent —
 * the switcher never shows more or fewer than the caller's real access.
 */
export function buildPersonaOptions(
  options: readonly RoleContextOption[],
): readonly PersonaOption[] {
  const result: PersonaOption[] = [];
  for (const persona of ROLE_PERSONAS) {
    const option = matchPersonaOption(persona, options);
    if (option !== undefined) result.push({ persona, option });
  }
  return result;
}

/** Applies a persona's nav label overrides, falling back to the original label. */
export function applyNavLabelOverride(persona: RolePersona | undefined, label: string): string {
  return persona?.navLabelOverrides?.[label] ?? label;
}
