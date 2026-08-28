/**
 * @nexora/design-system — design tokens.
 *
 * The single source of truth for the Nexora visual language (DESIGN_SYSTEM.md
 * §3). Components consume these values directly; {@link cssVariables}
 * projects them onto CSS custom properties so themes (light/dark) can switch
 * at runtime without re-rendering inline styles.
 *
 * Visual direction: high-contrast, near-monochrome neutrals; hairline
 * borders carry the structure; shadows are barely-there; one refined accent
 * per surface. Reads like something Vercel or Apple shipped.
 */

/** The semantic color roles of the system. */
export interface ThemeColors {
  /** App background. */
  bg: string;
  /** Elevated surfaces (cards, panels). */
  surface: string;
  /** Muted surfaces (subtle fills, code). */
  surfaceMuted: string;
  /** Default hairline border. */
  border: string;
  /** Stronger border (inputs, dividers, focus-adjacent). */
  borderStrong: string;
  /** Primary text. */
  text: string;
  /** Secondary text. */
  textSecondary: string;
  /** Muted text (metadata, placeholders). */
  textMuted: string;
  /** Highest-emphasis action (primary button) — neutral by design. */
  primary: string;
  /** Primary hover. */
  primaryHover: string;
  /** Text on primary surfaces. */
  primaryForeground: string;
  /** Primary tint (soft fills, selection, default active nav). */
  primarySoft: string;
  /** Link / informational accent. */
  link: string;
  /** Link hover. */
  linkHover: string;
  /** Focus ring color. */
  ring: string;
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
  /**
   * A translucent variant of {@link surface} for glass panels that sit over
   * a spatial background (Login only, as of S44) — paired with
   * `backdrop-filter: blur(...)` at each call site.
   */
  surfaceGlass: string;
}

/** The light theme (default) — true neutral, maximum contrast. */
export const lightColors: ThemeColors = {
  bg: '#fafafa',
  surface: '#ffffff',
  surfaceMuted: '#f4f4f5',
  border: '#eaeaea',
  borderStrong: '#d4d4d4',
  text: '#0a0a0a',
  textSecondary: '#4b4b4b',
  textMuted: '#7d7d7d',
  primary: '#0a0a0a',
  primaryHover: '#2b2b2b',
  primaryForeground: '#ffffff',
  primarySoft: '#f2f2f2',
  link: '#0060df',
  linkHover: '#0050bb',
  ring: '#0a0a0a',
  ai: '#7c3aed',
  aiSoft: '#f4f1fe',
  success: '#15803d',
  successSoft: '#edfaf0',
  warning: '#b45309',
  warningSoft: '#fdf5e6',
  danger: '#d43c3c',
  dangerSoft: '#fdf0f0',
  overlay: 'rgba(0, 0, 0, 0.40)',
  surfaceGlass: 'rgba(255, 255, 255, 0.80)',
};

/**
 * The dark theme — true near-black (Vercel / Apple dark), not a cool navy.
 * Neutral base only; per-role accent colors sit on top unchanged.
 */
export const darkColors: ThemeColors = {
  bg: '#0a0a0a',
  surface: '#141414',
  surfaceMuted: '#1c1c1c',
  border: '#262626',
  borderStrong: '#383838',
  text: '#ededed',
  textSecondary: '#a3a3a3',
  textMuted: '#707070',
  primary: '#ededed',
  primaryHover: '#ffffff',
  primaryForeground: '#0a0a0a',
  primarySoft: '#212121',
  link: '#4493f8',
  linkHover: '#6aa8f9',
  ring: '#ededed',
  ai: '#a78bfa',
  aiSoft: 'rgba(167, 139, 250, 0.16)',
  success: '#3fb950',
  successSoft: 'rgba(63, 185, 80, 0.15)',
  warning: '#d29922',
  warningSoft: 'rgba(210, 153, 34, 0.15)',
  danger: '#f2555a',
  dangerSoft: 'rgba(242, 85, 90, 0.16)',
  overlay: 'rgba(0, 0, 0, 0.66)',
  surfaceGlass: 'rgba(20, 20, 20, 0.80)',
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

/** Corner radii — tight and consistent. */
export const radius = {
  sm: '5px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

/** Typography: families, the type scale, and tracking. */
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
    xl: '1.3125rem',
    '2xl': '1.625rem',
    '3xl': '2rem',
    '4xl': '2.5rem',
    '5xl': '3.25rem',
  } as const,
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  } as const,
  lineHeights: {
    tight: 1.2,
    snug: 1.35,
    normal: 1.5,
    relaxed: 1.6,
  } as const,
  /** Letter-spacing — negative on display type, wide on eyebrow/caps labels. */
  tracking: {
    tighter: '-0.03em',
    tight: '-0.02em',
    normal: '-0.011em',
    wide: '0.02em',
    caps: '0.06em',
  } as const,
} as const;

/** Elevation shadows — restrained; borders do most of the work. */
export const elevation = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.04)',
  md: '0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04)',
  xl: '0 24px 48px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.06)',
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
  sidebarWidth: '236px',
  topbarHeight: '56px',
  contentMaxWidth: '1080px',
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
