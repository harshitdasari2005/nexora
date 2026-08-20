/**
 * @nexora/design-system — GlobalStyles.
 *
 * Injects the design-token CSS custom properties (light default, dark via
 * `data-theme="dark"`) and a minimal reset/typography base. Rendered once at
 * the application root (DESIGN_SYSTEM.md §3).
 */

import { darkThemeCss, lightThemeCss } from './tokens.js';

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
      {`:root { ${lightThemeCss} }
[data-theme="dark"] { ${darkThemeCss} }
${resetCss}`}
    </style>
  );
}
