/**
 * @nexora/app-web — role workspace theme registry (S33).
 *
 * ONE reusable framework, MANY business lenses: every business role
 * resolved by the trusted role-context endpoint (`/api/role-context`) maps
 * here to a `RoleTheme` — an atmosphere (tint), an accent, section
 * terminology, a role-specific "brief" question, and a navigation priority
 * order. The Command Center, AppShell, Agent, and Problems pages all read
 * the SAME theme for the SAME role; there is no per-role React page, only
 * per-role CONFIGURATION consumed by the existing generic renderers.
 *
 * Adding a future role is meant to mean: register its command center
 * (existing `@nexora/module-command-center` catalog), then add one entry
 * here. Nothing about the rendering engine changes.
 */

import type { IntelligenceNetworkTint } from '../components/IntelligenceNetwork.js';

/** The generic widget-group labels + the problem-attention heading. */
export interface RoleThemeSections {
  /** KPI/health widget group heading (e.g. "Organization Health"). */
  health: string;
  /** List/signal widget group heading (e.g. "Business Signals"). */
  signals: string;
  /** Activity feed heading (e.g. "Executive Activity"). */
  activity: string;
  /** The real-problems "needs your attention" heading. */
  attention: string;
}

/** The composition order of the three generic widget groups on the home page. */
export type SectionOrder = readonly ('health' | 'signals' | 'activity')[];

/** A role's complete visual + informational lens. */
export interface RoleTheme {
  /** The trusted roleId this theme is keyed by (e.g. `executive.ceo`). */
  roleId: string;
  /** Short identity used as the page eyebrow (e.g. "Executive Command Center"). */
  identity: string;
  /** The full "workspace" name (e.g. "Executive Command Center"). */
  centerName: string;
  /** One-line description of what this lens is for. */
  tagline: string;
  /** The Nexora Brief card's eyebrow label (e.g. "Executive Brief"). */
  briefLabel: string;
  /** The role-specific question the brief answers. */
  briefQuestion: string;
  /** The default AI Assistant prompt for this lens. */
  assistantPrompt: string;
  /** The ambient background hue. */
  tint: IntelligenceNetworkTint;
  /** A solid accent color (hex) for badges, icons, and hero gradients. */
  accent: string;
  /** A translucent version of {@link accent} for soft fills/washes. */
  accentSoft: string;
  /** Widget-group section labels. */
  sections: RoleThemeSections;
  /** The order the three generic widget groups render in. */
  order: SectionOrder;
  /** Nav item labels (must match existing routes) in priority order. */
  navPriority: readonly string[];
}

const DEFAULT_ORDER: SectionOrder = ['health', 'signals', 'activity'];

/** The fallback lens for a role with no dedicated theme (never blank/broken). */
export const DEFAULT_THEME: RoleTheme = {
  roleId: 'default',
  identity: 'Business Intelligence',
  centerName: 'Command Center',
  tagline: "Here's what needs your attention today.",
  briefLabel: 'Nexora Brief',
  briefQuestion: 'What needs my attention?',
  assistantPrompt: 'What needs my attention?',
  tint: 'indigo',
  accent: '#5b5bd6',
  accentSoft: '#5b5bd61f',
  sections: {
    health: 'Business Health',
    signals: 'Business Signals',
    activity: 'Recent Activity',
    attention: 'Needs your attention',
  },
  order: DEFAULT_ORDER,
  navPriority: ['Command Center', 'Problems', 'Agent', 'AI Assistant', 'Search', 'Settings'],
};

/** One theme per catalog roleId (`platform/command-center` INITIAL_COMMAND_CENTERS). */
export const ROLE_THEMES: Record<string, RoleTheme> = {
  'executive.ceo': {
    roleId: 'executive.ceo',
    identity: 'Executive Command Center',
    centerName: 'Executive Command Center',
    tagline: "Your organization's health, priorities and decisions in one place.",
    briefLabel: 'Executive Brief',
    briefQuestion: 'What matters across the organization today?',
    assistantPrompt: 'What should I know about the organization today?',
    tint: 'gold',
    accent: '#4f46e5',
    accentSoft: '#4f46e51f',
    sections: {
      health: 'Organization Health',
      signals: 'Business Signals',
      activity: 'Executive Activity',
      attention: 'Critical Attention',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Insights',
      'Agent',
      'Projects',
      'Calendar',
      'Audit',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'finance.cfo': {
    roleId: 'finance.cfo',
    identity: 'Finance Command Center',
    centerName: 'Finance Command Center',
    tagline: 'Your financial picture, risks and decisions in one place.',
    briefLabel: 'Financial Brief',
    briefQuestion: 'What financial issues require action?',
    assistantPrompt: 'What financial issues need my attention?',
    tint: 'emerald',
    accent: '#047857',
    accentSoft: '#0478571f',
    sections: {
      health: 'Financial Health',
      signals: 'Business Performance',
      activity: 'Recent Activity',
      attention: 'Financial Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Finance',
      'Problems',
      'Insights',
      'Documents',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'technology.cto': {
    roleId: 'technology.cto',
    identity: 'Technology Command Center',
    centerName: 'Technology Command Center',
    tagline: 'What needs to be built, fixed or shipped.',
    briefLabel: 'Engineering Brief',
    briefQuestion: 'What technology signals require attention?',
    assistantPrompt: 'What technical risks need attention?',
    tint: 'cyan',
    accent: '#0369a1',
    accentSoft: '#0369a11f',
    sections: {
      health: 'Engineering Health',
      signals: 'System Signals',
      activity: 'Engineering Activity',
      attention: 'Technical Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Agent',
      'Projects',
      'Insights',
      'Knowledge',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'technology.engineering_manager': {
    roleId: 'technology.engineering_manager',
    identity: 'Technology Command Center',
    centerName: 'Technology Command Center',
    tagline: 'What needs to be built, fixed or shipped.',
    briefLabel: 'Team Delivery Brief',
    briefQuestion: 'What does the team need from me today?',
    assistantPrompt: 'What does my team need attention on?',
    tint: 'steel',
    accent: '#2563eb',
    accentSoft: '#2563eb1f',
    sections: {
      health: 'Engineering Health',
      signals: 'Delivery Signals',
      activity: 'Team Activity',
      attention: 'Delivery Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Projects',
      'Agent',
      'Employees',
      'Workflows',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'technology.developer': {
    roleId: 'technology.developer',
    identity: 'Technology Command Center',
    centerName: 'Technology Command Center',
    tagline: 'What needs to be built, fixed or shipped.',
    briefLabel: 'My Work',
    briefQuestion: 'What should I work on next?',
    assistantPrompt: 'What should I work on next?',
    tint: 'cyan',
    accent: '#0e7490',
    accentSoft: '#0e74901f',
    sections: {
      health: 'Workflow Health',
      signals: 'Engineering Signals',
      activity: 'Recent Executions',
      attention: 'Technical Problems',
    },
    order: ['signals', 'health', 'activity'],
    navPriority: [
      'Command Center',
      'Problems',
      'Agent',
      'Projects',
      'Knowledge',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'people.hr': {
    roleId: 'people.hr',
    identity: 'People Command Center',
    centerName: 'People Command Center',
    tagline: 'What needs attention across your workforce.',
    briefLabel: 'People Brief',
    briefQuestion: 'What people signals need attention?',
    assistantPrompt: 'What people signals need my attention today?',
    tint: 'rose',
    accent: '#be123c',
    accentSoft: '#be123c1f',
    sections: {
      health: 'Workforce Health',
      signals: 'People Signals',
      activity: 'Employee Activity',
      attention: 'People Operations',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Employees',
      'Problems',
      'Documents',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'growth.sales_manager': {
    roleId: 'growth.sales_manager',
    identity: 'Growth Intelligence',
    centerName: 'Growth Intelligence Center',
    tagline: 'Pipeline health, deal risk, and growth signals.',
    briefLabel: 'Sales Brief',
    briefQuestion: 'What growth signals require action?',
    assistantPrompt: 'What growth signals need my attention?',
    tint: 'jade',
    accent: '#15803d',
    accentSoft: '#15803d1f',
    sections: {
      health: 'Pipeline Health',
      signals: 'Revenue Signals',
      activity: 'Sales Activity',
      attention: 'Deal Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Projects',
      'Insights',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'growth.marketing_manager': {
    roleId: 'growth.marketing_manager',
    identity: 'Market Intelligence',
    centerName: 'Market Intelligence Center',
    tagline: 'Campaign health and market signals worth acting on.',
    briefLabel: 'Marketing Brief',
    briefQuestion: 'What market signals need my attention?',
    assistantPrompt: 'What marketing signals should I know about?',
    tint: 'magenta',
    accent: '#a21caf',
    accentSoft: '#a21caf1f',
    sections: {
      health: 'Campaign Health',
      signals: 'Market Signals',
      activity: 'Marketing Activity',
      attention: 'Growth Opportunities',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Knowledge',
      'Documents',
      'Problems',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'product.product_manager': {
    roleId: 'product.product_manager',
    identity: 'Product Intelligence',
    centerName: 'Product Command Center',
    tagline: 'Delivery risk, initiatives, and priorities across the product portfolio.',
    briefLabel: 'Product Brief',
    briefQuestion: 'What product risks should I know about?',
    assistantPrompt: 'Which product risks need attention?',
    tint: 'violet',
    accent: '#7c3aed',
    accentSoft: '#7c3aed1f',
    sections: {
      health: 'Product Health',
      signals: 'Product Signals',
      activity: 'Recent Activity',
      attention: 'Delivery Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Projects',
      'Agent',
      'Insights',
      'Knowledge',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'product.product_lead': {
    roleId: 'product.product_lead',
    identity: 'Product Leadership',
    centerName: 'Product Leadership Center',
    tagline: 'Portfolio-level product priorities and delivery risk.',
    briefLabel: 'Product Brief',
    briefQuestion: 'What product priorities need my attention?',
    assistantPrompt: 'Which product priorities need my attention?',
    tint: 'violet',
    accent: '#6d28d9',
    accentSoft: '#6d28d91f',
    sections: {
      health: 'Product Health',
      signals: 'Product Signals',
      activity: 'Recent Activity',
      attention: 'Delivery Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Projects',
      'Agent',
      'Insights',
      'Knowledge',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'legal.general_counsel': {
    roleId: 'legal.general_counsel',
    identity: 'Legal Command Center',
    centerName: 'Legal Command Center',
    tagline: 'Legal, compliance and governance matters requiring attention.',
    briefLabel: 'Legal Brief',
    briefQuestion: 'What governance signals need my attention?',
    assistantPrompt: 'What compliance or governance risks need my attention?',
    tint: 'amber',
    accent: '#92400e',
    accentSoft: '#92400e1f',
    sections: {
      health: 'Governance Health',
      signals: 'Compliance Signals',
      activity: 'Recent Activity',
      attention: 'Governance Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Audit',
      'Documents',
      'Knowledge',
      'Problems',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'legal.compliance_manager': {
    roleId: 'legal.compliance_manager',
    identity: 'Legal Command Center',
    centerName: 'Legal Command Center',
    tagline: 'Legal, compliance and governance matters requiring attention.',
    briefLabel: 'Legal Brief',
    briefQuestion: 'What compliance signals need my attention?',
    assistantPrompt: 'What compliance issues need my attention?',
    tint: 'amber',
    accent: '#78350f',
    accentSoft: '#78350f1f',
    sections: {
      health: 'Governance Health',
      signals: 'Compliance Signals',
      activity: 'Recent Activity',
      attention: 'Policy Issues',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Audit',
      'Documents',
      'Knowledge',
      'Problems',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'operations.manager': {
    roleId: 'operations.manager',
    identity: 'Operations Command Center',
    centerName: 'Operations Command Center',
    tagline: 'Everything blocking delivery and execution.',
    briefLabel: 'Operations Brief',
    briefQuestion: 'What operational signals need my attention?',
    assistantPrompt: 'What operational signals need attention?',
    tint: 'orange',
    accent: '#c2410c',
    accentSoft: '#c2410c1f',
    sections: {
      health: 'Operational Health',
      signals: 'Process Signals',
      activity: 'Team Activity',
      attention: 'Process Problems',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Projects',
      'Agent',
      'Workflows',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'operations.head': {
    roleId: 'operations.head',
    identity: 'Operations Command Center',
    centerName: 'Operations Command Center',
    tagline: 'Everything blocking delivery and execution.',
    briefLabel: 'Operations Brief',
    briefQuestion: 'What operational risks need my attention?',
    assistantPrompt: 'What operational risks need my attention?',
    tint: 'orange',
    accent: '#9a3412',
    accentSoft: '#9a34121f',
    sections: {
      health: 'Operational Health',
      signals: 'Process Signals',
      activity: 'Team Activity',
      attention: 'Process Problems',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Projects',
      'Agent',
      'Workflows',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'customersuccess.manager': {
    roleId: 'customersuccess.manager',
    identity: 'Customer Intelligence',
    centerName: 'Customer Intelligence Center',
    tagline: 'Customer health, at-risk accounts, and what needs a response.',
    briefLabel: 'Customer Brief',
    briefQuestion: 'What customer signals need my attention?',
    assistantPrompt: 'Which customers need my attention?',
    tint: 'teal',
    accent: '#0d9488',
    accentSoft: '#0d94881f',
    sections: {
      health: 'Customer Health',
      signals: 'Customer Signals',
      activity: 'Recent Activity',
      attention: 'At-Risk Accounts',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Knowledge',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'customersuccess.support_manager': {
    roleId: 'customersuccess.support_manager',
    identity: 'Customer Intelligence',
    centerName: 'Customer Intelligence Center',
    tagline: 'Customer signals and support exceptions worth a response.',
    briefLabel: 'Customer Brief',
    briefQuestion: 'What customer signals need my attention?',
    assistantPrompt: 'Which customers need my attention?',
    tint: 'teal',
    accent: '#0f766e',
    accentSoft: '#0f766e1f',
    sections: {
      health: 'Customer Health',
      signals: 'Customer Signals',
      activity: 'Recent Activity',
      attention: 'At-Risk Accounts',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Knowledge',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'procurement.manager': {
    roleId: 'procurement.manager',
    identity: 'Procurement Intelligence',
    centerName: 'Procurement Intelligence Center',
    tagline: 'Supplier signals, procurement risk, and documents needing review.',
    briefLabel: 'Procurement Brief',
    briefQuestion: 'What procurement signals need my attention?',
    assistantPrompt: 'What procurement risks need my attention?',
    tint: 'olive',
    accent: '#4d7c0f',
    accentSoft: '#4d7c0f1f',
    sections: {
      health: 'Procurement Health',
      signals: 'Supplier Signals',
      activity: 'Recent Activity',
      attention: 'Procurement Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Documents',
      'Problems',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'procurement.vendor_manager': {
    roleId: 'procurement.vendor_manager',
    identity: 'Procurement Intelligence',
    centerName: 'Procurement Intelligence Center',
    tagline: 'Supplier signals and operational exceptions worth reviewing.',
    briefLabel: 'Procurement Brief',
    briefQuestion: 'What supplier signals need my attention?',
    assistantPrompt: 'What supplier risks need my attention?',
    tint: 'olive',
    accent: '#3f6212',
    accentSoft: '#3f62121f',
    sections: {
      health: 'Procurement Health',
      signals: 'Supplier Signals',
      activity: 'Recent Activity',
      attention: 'Procurement Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Documents',
      'Problems',
      'Agent',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'delivery.manager': {
    roleId: 'delivery.manager',
    identity: 'Delivery Operations',
    centerName: 'Delivery Operations Center',
    tagline: 'Team execution and delivery risk at a glance.',
    briefLabel: 'Delivery Brief',
    briefQuestion: 'What does my team need from me today?',
    assistantPrompt: 'What does my team need from me today?',
    tint: 'steel',
    accent: '#2563eb',
    accentSoft: '#2563eb1f',
    sections: {
      health: 'Team Health',
      signals: 'Delivery Signals',
      activity: 'Team Activity',
      attention: 'Delivery Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
      'Problems',
      'Projects',
      'Employees',
      'Workflows',
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
};

/** Resolves a role's theme, falling back to {@link DEFAULT_THEME} when unknown. */
export function themeForRole(roleId: string | undefined): RoleTheme {
  if (roleId === undefined) return DEFAULT_THEME;
  return ROLE_THEMES[roleId] ?? DEFAULT_THEME;
}
