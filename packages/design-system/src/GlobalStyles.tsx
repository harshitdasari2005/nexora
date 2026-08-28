/**
 * @nexora/design-system — GlobalStyles.
 *
 * Injects the design-token CSS custom properties (light default, dark via
 * `data-theme="dark"`) and a minimal reset/typography base. Rendered once at
 * the application root (DESIGN_SYSTEM.md §3).
 */

import { darkThemeCss, elevation, lightThemeCss } from './tokens.js';

const resetCss = `
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--nexora-bg);
  color: var(--nexora-text);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: -0.011em;
  font-feature-settings: 'cv02' 1, 'cv03' 1, 'cv04' 1, 'cv11' 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, h4, p { margin: 0; }
h1, h2, h3, h4 { letter-spacing: -0.02em; }
button, input, select, textarea { font: inherit; color: inherit; letter-spacing: inherit; }
a { color: var(--nexora-link); text-decoration: none; }
a:hover { color: var(--nexora-linkHover); text-decoration: underline; text-underline-offset: 2px; }
::selection { background: var(--nexora-primarySoft); color: var(--nexora-text); }
:focus-visible {
  outline: 2px solid var(--nexora-ring);
  outline-offset: 2px;
  border-radius: 3px;
}

/* Thin, unobtrusive scrollbars — the surface does the work, not chrome. */
* { scrollbar-width: thin; scrollbar-color: var(--nexora-borderStrong) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb {
  background: var(--nexora-border);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
}
*::-webkit-scrollbar-thumb:hover { background: var(--nexora-borderStrong); background-clip: content-box; }
*::-webkit-scrollbar-corner { background: transparent; }

@keyframes nexora-spin { to { transform: rotate(360deg); } }
@keyframes nexora-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes nexora-kpi-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.nexora-kpi-value { animation: nexora-kpi-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both; }
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

/** Renders the global token + reset stylesheet. */
export function GlobalStyles(): JSX.Element {
  return (
    <style id="nexora-global-styles">
      {`:root {
  ${lightThemeCss}
  /* App-shell structural tones (light): the sidebar sits flush with the
     page (a single quiet plane, not a stacked panel); the topbar is an
     opaque surface with a hairline underline; elevated cards are pure
     white. Separation comes from the 1px hairline, never a shadow. */
  --nexora-shellSidebar: var(--nexora-bg);
  --nexora-shellTopbar: var(--nexora-surface);
  --nexora-shellCardElevated: #ffffff;
  /* Card surface (light): a plain opaque card — no glass, nothing behind
     it to blur. The [data-theme="dark"] block below keeps real glass for
     the Login scene only. */
  --nexora-cardBg: var(--nexora-surface);
  --nexora-cardBackdropFilter: none;
  --nexora-cardInsetHighlight: none;
}
[data-theme="dark"] {
  ${darkThemeCss}
  /* App-shell structural tones (dark): same principle — sidebar flush
     with the page, topbar an opaque surface, cards one step up. */
  --nexora-shellSidebar: var(--nexora-bg);
  --nexora-shellTopbar: var(--nexora-surface);
  --nexora-shellCardElevated: #1a1a1a;
  /* Card surface (dark): translucent glass over the 3D scene (Login only
     as of S44 — the authenticated shell no longer runs this theme). */
  --nexora-cardBg: var(--nexora-surfaceGlass);
  --nexora-cardBackdropFilter: blur(20px) saturate(150%);
  --nexora-cardInsetHighlight: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.nexora-card-interactive { cursor: pointer; transition: border-color 140ms ease, box-shadow 140ms ease; }
.nexora-card-interactive:hover {
  border-color: var(--nexora-borderStrong);
  box-shadow: ${elevation.md};
}
.nexora-btn:not(:disabled):hover { }
.nexora-btn-primary:not(:disabled):hover { background: var(--nexora-primaryHover); }
.nexora-btn-primary:not(:disabled):active { filter: brightness(0.92); }
.nexora-btn-secondary:not(:disabled):hover { background: var(--nexora-surfaceMuted); border-color: var(--nexora-borderStrong); }
.nexora-btn-ghost:not(:disabled):hover { background: var(--nexora-surfaceMuted); color: var(--nexora-text); }
.nexora-btn-danger:not(:disabled):hover { filter: brightness(0.93); }
.nexora-btn-danger:not(:disabled):active { filter: brightness(0.86); }
.nexora-input::placeholder { color: var(--nexora-textMuted); }
.nexora-input:hover:not(:focus):not(:disabled) { border-color: var(--nexora-text); }
.nexora-input:focus {
  border-color: var(--nexora-ring);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nexora-ring) 16%, transparent);
}
.nexora-input:disabled { opacity: 0.55; cursor: not-allowed; }
.nexora-input-invalid:focus {
  border-color: var(--nexora-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nexora-danger) 16%, transparent);
}
.nexora-icon-btn:hover { background: var(--nexora-surfaceMuted) !important; color: var(--nexora-text) !important; border-color: var(--nexora-borderStrong) !important; }
${resetCss}`}
    </style>
  );
}
