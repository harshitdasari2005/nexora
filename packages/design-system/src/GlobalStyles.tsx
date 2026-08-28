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
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, h4, p { margin: 0; }
button, input, select, textarea { font: inherit; color: inherit; }
a { color: var(--nexora-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
::selection { background: var(--nexora-primarySoft); }
:focus-visible {
  outline: 2px solid var(--nexora-primary);
  outline-offset: 2px;
}
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
  /* App-shell structural tones (light): a very subtle depth ladder —
     sidebar reads as a hair darker than the page, the topbar as a
     translucent wash, elevated cards as pure white — enough to separate
     regions without the shell looking like stacked panels. */
  --nexora-shellSidebar: #f6f5f3;
  --nexora-shellTopbar: rgba(255, 255, 255, 0.86);
  --nexora-shellCardElevated: #ffffff;
  /* Card surface (light): a plain opaque card — no glass, nothing behind
     it to blur. See the [data-theme="dark"] block below for why this
     differs there (Login/the pre-S44 cinematic surfaces still float over
     a 3D scene and need real glass; the authenticated app, S44, does not). */
  --nexora-cardBg: var(--nexora-surface);
  --nexora-cardBackdropFilter: none;
  --nexora-cardInsetHighlight: inset 0 1px 0 rgba(255, 255, 255, 0);
}
[data-theme="dark"] {
  ${darkThemeCss}
  /* App-shell structural tones (dark only): a visible depth ladder from
     the deepest sidebar to the most-elevated card, distinct from the
     generic bg/surface pair so the shell reads as layered, not flat. */
  --nexora-shellSidebar: #05070d;
  --nexora-shellTopbar: rgba(9, 12, 20, 0.72);
  --nexora-shellCardElevated: #182036;
  /* Card surface (dark): translucent glass over the 3D scene (Login only
     as of S44 — the authenticated shell no longer runs this theme). */
  --nexora-cardBg: var(--nexora-surfaceGlass);
  --nexora-cardBackdropFilter: blur(20px) saturate(150%);
  --nexora-cardInsetHighlight: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.nexora-card-interactive { cursor: pointer; outline-offset: 2px; }
.nexora-card-interactive:hover {
  box-shadow: ${elevation.md}, var(--nexora-cardInsetHighlight);
}
${resetCss}`}
    </style>
  );
}
