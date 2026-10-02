/**
 * @nexora/design-system — design tokens.
 *
 * The single source of truth for the Nexora visual language (DESIGN_SYSTEM.md
 * §3). Components consume these values directly; {@link cssVariables}
 * projects them onto CSS custom properties so themes (light/dark) can switch
 * at runtime without re-rendering inline styles.
 *
 * Visual direction — "desk and ledger": the product is an office whose work
 * moves between desks, so the look borrows from that world. A cool paper
 * desk, white sheets, green-black ink, a viridian green for the action that
 * moves work on, and one amber marker reserved for "it is your turn".
 * Hairlines carry structure; shape follows hierarchy (round chips, softly
 * squared controls, rounder sheets). The landing page keeps its own look.
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

/**
 * The light theme (default) — "desk and ledger".
 *
 * A cool paper desk, white sheets on it, green-black ink for text, and a
 * viridian "ledger" green for the action that moves work forward. Amber (the
 * `--nexora-marker*` variables in GlobalStyles) is kept out of this palette on
 * purpose: it means exactly one thing — it is your turn.
 */
export const lightColors: ThemeColors = {
  bg: '#f3f5f1',
  surface: '#ffffff',
  surfaceMuted: '#eaeee8',
  border: '#dce2dc',
  borderStrong: '#bfc9c1',
  text: '#14201c',
  textSecondary: '#42524c',
  textMuted: '#6c7b75',
  primary: '#0e6b58',
  primaryHover: '#0a5747',
  primaryForeground: '#ffffff',
  primarySoft: '#dff0ea',
  link: '#0e6b58',
  linkHover: '#0a5747',
  ring: '#0e6b58',
  ai: '#6b4ee6',
  aiSoft: '#efebfd',
  success: '#17764c',
  successSoft: '#e0f3e8',
  warning: '#96610a',
  warningSoft: '#fbf0d6',
  danger: '#b93a2b',
  dangerSoft: '#fbe9e5',
  overlay: 'rgba(12, 22, 18, 0.46)',
  surfaceGlass: 'rgba(255, 255, 255, 0.82)',
};

/** The dark theme — the same desk at night: deep green-black, mint for action. */
export const darkColors: ThemeColors = {
  bg: '#090f0d',
  surface: '#131c19',
  surfaceMuted: '#1b2823',
  border: '#26362f',
  borderStrong: '#3a4f45',
  text: '#e6eeea',
  textSecondary: '#a4b5ad',
  textMuted: '#74867e',
  primary: '#4fd1ae',
  primaryHover: '#74dfc1',
  primaryForeground: '#06231c',
  primarySoft: 'rgba(79, 209, 174, 0.14)',
  link: '#5fd6b6',
  linkHover: '#8ae4cb',
  ring: '#4fd1ae',
  ai: '#a594ff',
  aiSoft: 'rgba(165, 148, 255, 0.16)',
  success: '#4cc98a',
  successSoft: 'rgba(76, 201, 138, 0.15)',
  warning: '#e0b04a',
  warningSoft: 'rgba(224, 176, 74, 0.15)',
  danger: '#f0796a',
  dangerSoft: 'rgba(240, 121, 106, 0.16)',
  overlay: 'rgba(0, 0, 0, 0.66)',
  surfaceGlass: 'rgba(19, 28, 25, 0.82)',
};

/**
 * The previous neutral dark palette, kept ONLY for the landing page (which
 * carries its own cinematic look and is deliberately not part of the app's
 * visual language). Scoped by `.nexora-landing` in GlobalStyles.
 */
export const landingColors: ThemeColors = {
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

/**
 * Corner radii. Shape follows hierarchy: chips are fully round, controls are
 * softly squared, sheets (cards) are the roundest thing on the page. The
 * values resolve through CSS variables so the landing page can keep its own.
 */
export const radius = {
  sm: 'var(--nexora-radius-sm, 7px)',
  md: 'var(--nexora-radius-md, 10px)',
  lg: 'var(--nexora-radius-lg, 16px)',
  xl: 'var(--nexora-radius-xl, 22px)',
  full: '9999px',
} as const;

/** Typography: families, the type scale, and tracking. */
export const typography = {
  /** Body and interface text. */
  fontSans:
    "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  /** Headings and figures. */
  fontDisplay: "'Bricolage Grotesque', 'Instrument Sans', -apple-system, 'Segoe UI', sans-serif",
  /** The landing page's own face (see `.nexora-landing`). */
  fontLanding:
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
  sm: '0 1px 2px rgba(20, 32, 28, 0.05)',
  md: '0 6px 16px -6px rgba(20, 32, 28, 0.12), 0 1px 2px rgba(20, 32, 28, 0.05)',
  lg: '0 16px 32px -12px rgba(20, 32, 28, 0.16), 0 2px 6px rgba(20, 32, 28, 0.05)',
  xl: '0 32px 64px -20px rgba(20, 32, 28, 0.24), 0 8px 16px rgba(20, 32, 28, 0.06)',
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

/** The landing page's variable block. */
export const landingThemeCss = cssVariables(landingColors);
