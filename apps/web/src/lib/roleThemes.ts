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
  /** Short identity used as the page eyebrow (e.g. "Executive Intelligence"). */
  identity: string;
  /** The full "workspace" name (e.g. "Executive Intelligence Center"). */
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
  accent: '#818cf8',
  accentSoft: 'rgba(129, 140, 248, 0.16)',
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
    identity: 'Executive Intelligence',
    centerName: 'Executive Intelligence Center',
    tagline: 'Organization-wide visibility — health, risk, and what needs a decision.',
    briefLabel: 'Executive Brief',
    briefQuestion: 'What matters across the organization today?',
    assistantPrompt: 'What should I know about the organization today?',
    tint: 'gold',
    accent: '#e0b86e',
    accentSoft: 'rgba(224, 184, 110, 0.16)',
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
      'AI Assistant',
      'Search',
      'Settings',
    ],
  },
  'finance.cfo': {
    roleId: 'finance.cfo',
    identity: 'Financial Intelligence',
    centerName: 'Financial Intelligence Center',
    tagline: 'Financial health, exceptions, and approvals awaiting a decision.',
    briefLabel: 'Financial Brief',
    briefQuestion: 'What financial issues require action?',
    assistantPrompt: 'What financial issues need my attention?',
    tint: 'emerald',
    accent: '#34d399',
    accentSoft: 'rgba(52, 211, 153, 0.16)',
    sections: {
      health: 'Financial Health',
      signals: 'Business Performance',
      activity: 'Recent Activity',
      attention: 'Financial Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
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
    identity: 'Technology Intelligence',
    centerName: 'Technology Command Center',
    tagline: 'Engineering health, technical risk, and system signals across the stack.',
    briefLabel: 'Engineering Brief',
    briefQuestion: 'What technology signals require attention?',
    assistantPrompt: 'What technical risks need attention?',
    tint: 'cyan',
    accent: '#22d3ee',
    accentSoft: 'rgba(34, 211, 238, 0.16)',
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
    identity: 'Engineering Operations',
    centerName: 'Engineering Operations Center',
    tagline: 'Team delivery, workflow health, and what your engineers need from you.',
    briefLabel: 'Team Delivery Brief',
    briefQuestion: 'What does the team need from me today?',
    assistantPrompt: 'What does my team need attention on?',
    tint: 'steel',
    accent: '#4f8fd1',
    accentSoft: 'rgba(79, 143, 209, 0.16)',
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
    identity: 'Technical Execution',
    centerName: 'Technical Execution Workspace',
    tagline: 'What to work on next, grounded in real signals and evidence.',
    briefLabel: 'My Work',
    briefQuestion: 'What should I work on next?',
    assistantPrompt: 'What should I work on next?',
    tint: 'cyan',
    accent: '#67e8f9',
    accentSoft: 'rgba(103, 232, 249, 0.16)',
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
    identity: 'People Intelligence',
    centerName: 'People Intelligence Center',
    tagline: 'Workforce health, hiring, and people signals that need attention.',
    briefLabel: 'People Brief',
    briefQuestion: 'What people signals need attention?',
    assistantPrompt: 'What people signals need my attention today?',
    tint: 'rose',
    accent: '#f0a8bb',
    accentSoft: 'rgba(240, 168, 187, 0.16)',
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
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.16)',
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
    accent: '#d891c6',
    accentSoft: 'rgba(216, 145, 198, 0.16)',
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
    accent: '#a78bfa',
    accentSoft: 'rgba(167, 139, 250, 0.16)',
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
    accent: '#8b5cf6',
    accentSoft: 'rgba(139, 92, 246, 0.16)',
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
    identity: 'Governance Intelligence',
    centerName: 'Governance Intelligence Center',
    tagline: 'Compliance signals, governance risk, and policy issues.',
    briefLabel: 'Legal Brief',
    briefQuestion: 'What governance signals need my attention?',
    assistantPrompt: 'What compliance or governance risks need my attention?',
    tint: 'amber',
    accent: '#d9a35a',
    accentSoft: 'rgba(217, 163, 90, 0.16)',
    sections: {
      health: 'Governance Health',
      signals: 'Compliance Signals',
      activity: 'Recent Activity',
      attention: 'Governance Risks',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
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
    identity: 'Governance Intelligence',
    centerName: 'Governance Intelligence Center',
    tagline: 'Compliance signals and policy issues requiring review.',
    briefLabel: 'Legal Brief',
    briefQuestion: 'What compliance signals need my attention?',
    assistantPrompt: 'What compliance issues need my attention?',
    tint: 'amber',
    accent: '#c99653',
    accentSoft: 'rgba(201, 150, 83, 0.16)',
    sections: {
      health: 'Governance Health',
      signals: 'Compliance Signals',
      activity: 'Recent Activity',
      attention: 'Policy Issues',
    },
    order: DEFAULT_ORDER,
    navPriority: [
      'Command Center',
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
    identity: 'Operational Intelligence',
    centerName: 'Operations Command Center',
    tagline: 'Process health, exceptions, and what needs operational attention.',
    briefLabel: 'Operations Brief',
    briefQuestion: 'What operational signals need my attention?',
    assistantPrompt: 'What operational signals need attention?',
    tint: 'orange',
    accent: '#e6923f',
    accentSoft: 'rgba(230, 146, 63, 0.16)',
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
    identity: 'Operational Leadership',
    centerName: 'Operations Leadership Center',
    tagline: 'Cross-functional operational health and exceptions worth escalating.',
    briefLabel: 'Operations Brief',
    briefQuestion: 'What operational risks need my attention?',
    assistantPrompt: 'What operational risks need my attention?',
    tint: 'orange',
    accent: '#d97706',
    accentSoft: 'rgba(217, 119, 6, 0.16)',
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
    accent: '#2dd4bf',
    accentSoft: 'rgba(45, 212, 191, 0.16)',
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
    accent: '#14b8a6',
    accentSoft: 'rgba(20, 184, 166, 0.16)',
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
    accent: '#b7a24a',
    accentSoft: 'rgba(183, 162, 74, 0.16)',
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
    accent: '#a08f3f',
    accentSoft: 'rgba(160, 143, 63, 0.16)',
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
    accent: '#4f8fd1',
    accentSoft: 'rgba(79, 143, 209, 0.16)',
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
