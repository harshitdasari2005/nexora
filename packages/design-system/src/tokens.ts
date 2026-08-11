/**
 * @nexora/design-system — design tokens.
 *
 * The single source of truth for the Nexora visual language (DESIGN_SYSTEM.md
 * §3). Components consume these values directly; {@link cssVariables}
 * projects them onto CSS custom properties so themes (light/dark) can switch
 * at runtime without re-rendering inline styles.
 */

/** The semantic color roles of the system. */
export interface ThemeColors {
  /** App background. */
  bg: string;
  /** Elevated surfaces (cards, panels). */
  surface: string;
  /** Muted surfaces (sublte fills, code). */
  surfaceMuted: string;
  /** Default border. */
  border: string;
  /** Stronger border (focus-adjacent, dividers). */
  borderStrong: string;
  /** Primary text. */
  text: string;
  /** Secondary text. */
  textSecondary: string;
  /** Muted text (metadata, placeholders). */
  textMuted: string;
  /** Brand / primary action. */
  primary: string;
  /** Brand hover. */
  primaryHover: string;
  /** Text on primary surfaces. */
  primaryForeground: string;
  /** Primary tint (soft fills, active nav). */
  primarySoft: string;
  /** AI accent (agents, orchestration). */
  ai: string;
  /** AI tint. */
  aiSoft: string;
  /** Success. */
  success: string;
  /** Success tint. */
  successSoft: string;
  /** Warning. */
  warning: string;
  /** Warning tint. */
  warningSoft: string;
  /** Danger. */
  danger: string;
  /** Danger tint. */
  dangerSoft: string;
  /** Overlay (modals, command palette scrim). */
  overlay: string;
}

/** The light theme (default). */
export const lightColors: ThemeColors = {
  bg: '#fafaf9',
  surface: '#ffffff',
  surfaceMuted: '#f5f5f4',
  border: '#e7e5e4',
  borderStrong: '#d6d3d1',
  text: '#1c1917',
  textSecondary: '#57534e',
  textMuted: '#a8a29e',
  primary: '#4f46e5',
  primaryHover: '#4338ca',
  primaryForeground: '#ffffff',
  primarySoft: '#eef2ff',
  ai: '#7c3aed',
  aiSoft: '#f5f3ff',
  success: '#059669',
  successSoft: '#ecfdf5',
  warning: '#d97706',
  warningSoft: '#fffbeb',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',
  overlay: 'rgba(28, 25, 23, 0.45)',
};

/** The dark theme. */
export const darkColors: ThemeColors = {
  bg: '#0c0a09',
  surface: '#1c1917',
  surfaceMuted: '#292524',
  border: '#3f3b38',
  borderStrong: '#57534e',
  text: '#fafaf9',
  textSecondary: '#d6d3d1',
  textMuted: '#78716c',
  primary: '#6366f1',
  primaryHover: '#818cf8',
  primaryForeground: '#ffffff',
  primarySoft: 'rgba(99, 102, 241, 0.16)',
  ai: '#a78bfa',
  aiSoft: 'rgba(167, 139, 250, 0.14)',
  success: '#34d399',
  successSoft: 'rgba(52, 211, 153, 0.14)',
  warning: '#fbbf24',
  warningSoft: 'rgba(251, 191, 36, 0.14)',
  danger: '#f87171',
  dangerSoft: 'rgba(248, 113, 113, 0.14)',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

/** The 4px-based spacing scale (rem). */
export const spacing = {
  0: '0px',
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  2.5: '0.625rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
} as const;

/** Corner radii. */
export const radius = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '20px',
  full: '9999px',
} as const;

/** Typography: families and the type scale. */
export const typography = {
  fontSans:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    base: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
  } as const,
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  } as const,
  lineHeights: {
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
  } as const,
} as const;

/** Elevation shadows (light). */
export const elevation = {
  none: 'none',
  sm: '0 1px 2px rgba(28, 25, 23, 0.06), 0 1px 3px rgba(28, 25, 23, 0.04)',
  md: '0 2px 6px rgba(28, 25, 23, 0.08), 0 4px 12px rgba(28, 25, 23, 0.06)',
  lg: '0 8px 24px rgba(28, 25, 23, 0.12), 0 4px 8px rgba(28, 25, 23, 0.06)',
  xl: '0 16px 40px rgba(28, 25, 23, 0.18), 0 8px 16px rgba(28, 25, 23, 0.08)',
} as const;

/** Motion: durations and easings (DESIGN_SYSTEM.md §14). */
export const motion = {
  duration: { fast: '120ms', base: '180ms', slow: '280ms' } as const,
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasis: 'cubic-bezier(0.16, 1, 0.3, 1)',
  } as const,
} as const;

/** Layer z-index scale. */
export const zIndex = {
  base: 0,
  sticky: 10,
  docked: 20,
  overlay: 30,
  modal: 40,
  popover: 50,
  toast: 60,
} as const;

/** Layout constants. */
export const layout = {
  maxWidth: '1200px',
  sidebarWidth: '248px',
  topbarHeight: '56px',
  contentMaxWidth: '880px',
} as const;

/** Projects a color theme onto `:root` CSS custom properties. */
export function cssVariables(colors: ThemeColors): string {
  const entries = Object.entries(colors).map(([name, value]) => `--nexora-${name}: ${value};`);
  return entries.join('\n');
}

/** The light theme variable block. */
export const lightThemeCss = cssVariables(lightColors);

/** The dark theme variable block. */
export const darkThemeCss = cssVariables(darkColors);
