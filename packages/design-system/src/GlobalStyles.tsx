/**
 * @nexora/design-system — GlobalStyles.
 *
 * Injects the design-token CSS custom properties (light default, dark via
 * `data-theme="dark"`) and a minimal reset/typography base. Rendered once at
 * the application root (DESIGN_SYSTEM.md §3).
 */

import { darkThemeCss, elevation, landingThemeCss, lightThemeCss, typography } from './tokens.js';

const resetCss = `
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--nexora-bg);
  color: var(--nexora-text);
  font-family: ${typography.fontSans};
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: -0.004em;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, h4, p { margin: 0; }
h1, h2, h3, h4 {
  font-family: ${typography.fontDisplay};
  letter-spacing: -0.022em;
  font-optical-sizing: auto;
}
button, input, select, textarea { font: inherit; color: inherit; letter-spacing: inherit; }
a { color: var(--nexora-link); text-decoration: none; }
a:hover { color: var(--nexora-linkHover); text-decoration: underline; text-underline-offset: 3px; }
::selection { background: var(--nexora-markerSoft); color: var(--nexora-text); }
:focus-visible {
  outline: 2px solid var(--nexora-ring);
  outline-offset: 2px;
  border-radius: 6px;
}

/* --- Page scaffolding -------------------------------------------------------
   One fluid container for every app page: comfortable on a wide monitor,
   edge-to-edge-with-breathing-room on a phone. */
.nexora-page { width: 100%; max-width: 1040px; margin-inline: auto; }
.nexora-page-wide { max-width: 1280px; }
/* A page with no app shell around it brings its own gutters. */
.nexora-page-standalone { padding: clamp(20px, 5vw, 64px) clamp(16px, 4vw, 40px); }
.nexora-page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px 24px;
}
.nexora-page-head > :first-child { flex: 1 1 320px; min-width: 0; }
/* Two-up fields that fall to one column when there is no room. */
.nexora-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 14px 16px; }
.nexora-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 14px 20px; }
/* The guided story bar: one line about where the story is and whose turn it is. */
.nexora-story {
  width: 100%;
  max-width: 1040px;
  margin: 0 auto 24px;
  border: 1px solid var(--nexora-border);
  border-radius: var(--nexora-radius-lg, 16px);
  background: var(--nexora-surface);
  overflow: hidden;
}
.nexora-story[data-tone='turn'] { border-color: var(--nexora-marker); background: var(--nexora-markerSoft); }
.nexora-story[data-tone='done'] { border-color: transparent; background: var(--nexora-primarySoft); }
.nexora-story-pips { display: flex; gap: 3px; }
.nexora-story-pips > span { flex: 1; height: 4px; background: var(--nexora-border); }
.nexora-story-pips > span[data-state='done'],
.nexora-story-pips > span[data-state='skipped'] { background: var(--nexora-primary); }
.nexora-story-pips > span[data-state='current'],
.nexora-story-pips > span[data-state='returned'] { background: var(--nexora-marker); }
.nexora-story-body { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 14px 18px; }
.nexora-story-name { font-size: 0.75rem; font-weight: 600; color: var(--nexora-textMuted); margin-bottom: 2px; }
.nexora-story-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  font-family: ${typography.fontDisplay};
  font-size: 1.0625rem;
  font-weight: 620;
  letter-spacing: -0.015em;
}
.nexora-story-text { margin-top: 2px; color: var(--nexora-textSecondary); max-width: 70ch; }
.nexora-story[data-tone='turn'] .nexora-story-text { color: var(--nexora-text); }
.nexora-story-link { font-size: 0.8125rem; font-weight: 600; white-space: nowrap; }

/* The story's steps: a numbered column with a line running through the marks. */
.nexora-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.nexora-step { position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 0 16px; padding-bottom: 22px; }
.nexora-step:last-child { padding-bottom: 0; }
.nexora-step::before {
  content: '';
  position: absolute;
  left: 19px;
  top: 40px;
  bottom: 0;
  width: 2px;
  background: var(--nexora-border);
}
.nexora-step:last-child::before { display: none; }
.nexora-step[data-state='done']::before, .nexora-step[data-state='skipped']::before { background: var(--nexora-primary); }
.nexora-step-mark {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: ${typography.fontDisplay};
  font-size: 1.0625rem;
  font-weight: 650;
  background: var(--nexora-surface);
  border: 2px solid var(--nexora-borderStrong);
  color: var(--nexora-textMuted);
}
.nexora-step[data-state='done'] .nexora-step-mark { background: var(--nexora-primary); border-color: var(--nexora-primary); color: var(--nexora-primaryForeground); }
.nexora-step[data-state='current'] .nexora-step-mark,
.nexora-step[data-state='returned'] .nexora-step-mark {
  background: var(--nexora-marker);
  border-color: var(--nexora-marker);
  color: var(--nexora-markerInk);
  box-shadow: 0 0 0 5px var(--nexora-markerSoft);
}
.nexora-step[data-state='skipped'] .nexora-step-mark { border-style: dashed; }
.nexora-step-title { font-size: 1.125rem; font-weight: 620; letter-spacing: -0.015em; line-height: 1.3; padding-top: 6px; }
.nexora-step[data-state='waiting'] .nexora-step-title { color: var(--nexora-textSecondary); }
.nexora-step-state { font-size: 0.75rem; font-weight: 600; color: var(--nexora-textMuted); }
.nexora-step[data-state='current'] .nexora-step-state, .nexora-step[data-state='returned'] .nexora-step-state {
  background: var(--nexora-marker);
  color: var(--nexora-markerInk);
  border-radius: 999px;
  padding: 1px 9px;
}
.nexora-step[data-state='done'] .nexora-step-state { color: var(--nexora-success); }
.nexora-step-detail { margin-top: 6px; color: var(--nexora-textSecondary); max-width: 66ch; }
.nexora-step[data-state='current'] .nexora-step-detail, .nexora-step[data-state='returned'] .nexora-step-detail { color: var(--nexora-text); }

/* A choice between a few kinds of thing, each with a line of explanation. */
.nexora-choice { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)); gap: 10px; }
.nexora-choice-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 12px 14px;
  border-radius: var(--nexora-radius-md, 10px);
  border: 1px solid var(--nexora-borderStrong);
  background: var(--nexora-surface);
  color: var(--nexora-text);
  cursor: pointer;
}
.nexora-choice-option:hover { border-color: var(--nexora-primary); }
.nexora-choice-option[aria-checked='true'] {
  border-color: var(--nexora-primary);
  background: var(--nexora-primarySoft);
  box-shadow: inset 0 0 0 1px var(--nexora-primary);
}

/* Tabs: a row of names that scrolls sideways when it does not fit. */
.nexora-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.nexora-tab {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--nexora-border);
  background: transparent;
  color: var(--nexora-textSecondary);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.nexora-tab:hover { border-color: var(--nexora-borderStrong); color: var(--nexora-text); }
.nexora-tab[aria-selected='true'] { background: var(--nexora-text); border-color: var(--nexora-text); color: var(--nexora-bg); }

/* The assistant: one line saying what it is, and the brief it prepares. */
.nexora-assistant-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--nexora-textSecondary);
}
.nexora-assistant-note > svg { margin-top: 3px; color: var(--nexora-ai); }
.nexora-brief {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--nexora-radius-md, 10px);
  border: 1px solid color-mix(in srgb, var(--nexora-ai) 30%, var(--nexora-border));
  background: color-mix(in srgb, var(--nexora-ai) 6%, var(--nexora-surface));
}
.nexora-brief[data-tone='warn'] { border-color: var(--nexora-warning); }
.nexora-brief ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.nexora-brief li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 2px 16px;
  padding: 6px 0;
  border-top: 1px solid var(--nexora-border);
  font-size: 0.8125rem;
}
.nexora-brief li > span { color: var(--nexora-textSecondary); }
.nexora-brief li[data-tone='warn'] > strong { color: var(--nexora-warning); }

/* A board: one column per state, side by side when there is room. */
.nexora-board { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr)); gap: 20px 16px; align-items: start; }
.nexora-board-column { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.nexora-board-empty {
  border: 1px dashed var(--nexora-borderStrong);
  border-radius: var(--nexora-radius-md, 10px);
  padding: 14px;
  font-size: 0.8125rem;
  color: var(--nexora-textMuted);
}
/* A thin progress meter. */
.nexora-meter { height: 6px; border-radius: 999px; background: var(--nexora-surfaceMuted); margin: 10px 0 6px; overflow: hidden; }
.nexora-meter > span { display: block; height: 100%; border-radius: 999px; background: var(--nexora-primary); }

/* A row on the desk: what it is, and the page it is done on. */
.nexora-desk-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 16px 20px; }
.nexora-desk-icon {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--nexora-surfaceMuted);
  color: var(--nexora-textSecondary);
}
.nexora-desk-icon[data-mine='true'] { background: var(--nexora-marker); color: var(--nexora-markerInk); }

/* A checklist mark: empty ring, amber ring when it is yours, filled when done. */
.nexora-check {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--nexora-borderStrong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--nexora-primaryForeground);
}
.nexora-check[data-mine='true'] { border-color: var(--nexora-marker); box-shadow: 0 0 0 3px var(--nexora-markerSoft); }
.nexora-check[data-done='true'] { background: var(--nexora-primary); border-color: var(--nexora-primary); box-shadow: none; }
/* A quieter block inside a card (a candidate, a sub-form) — tinted, not boxed again. */
.nexora-inset {
  background: var(--nexora-surfaceMuted);
  border-radius: var(--nexora-radius-md, 10px);
  padding: 14px 16px;
}
.nexora-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
@media (max-width: 480px) {
  .nexora-actions > .nexora-btn { flex: 1 1 auto; }
}
.nexora-page-title {
  font-size: clamp(1.6rem, 1.1rem + 1.9vw, 2.25rem);
  line-height: 1.08;
  font-weight: 650;
  letter-spacing: -0.03em;
  text-wrap: balance;
}
.nexora-page-lede { color: var(--nexora-textSecondary); max-width: 64ch; }
.nexora-section-title {
  font-family: ${typography.fontDisplay};
  font-size: 1.05rem;
  font-weight: 620;
  letter-spacing: -0.015em;
  color: var(--nexora-text);
}
/* "It is your turn" — the one loud thing in the interface. */
.nexora-turn {
  position: relative;
  border-color: var(--nexora-marker) !important;
  box-shadow: inset 4px 0 0 var(--nexora-marker);
}
.nexora-turn-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--nexora-marker);
  color: var(--nexora-markerInk);
  font-size: 0.75rem;
  font-weight: 650;
}
/* A row of items separated by hairlines instead of boxed one by one. */
.nexora-rows > * + * { border-top: 1px solid var(--nexora-border); }

/* Route: the stations a request passes through. */
.nexora-route { display: flex; align-items: flex-start; gap: 0; width: 100%; }
.nexora-route-stop { flex: 1 1 0; min-width: 0; position: relative; padding-top: 22px; }
.nexora-route-stop::before {
  content: '';
  position: absolute;
  top: 6px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--nexora-border);
}
.nexora-route-stop:first-child::before { left: 7px; }
.nexora-route-stop:last-child::before { right: calc(100% - 7px); }
.nexora-route-stop[data-reached='true']::before { background: var(--nexora-primary); }
.nexora-route-dot {
  position: absolute;
  top: 0;
  left: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--nexora-surface);
  border: 2px solid var(--nexora-borderStrong);
}
.nexora-route-stop[data-state='done'] .nexora-route-dot { background: var(--nexora-primary); border-color: var(--nexora-primary); }
.nexora-route-stop[data-state='current'] .nexora-route-dot {
  background: var(--nexora-marker);
  border-color: var(--nexora-marker);
  box-shadow: 0 0 0 4px var(--nexora-markerSoft);
}
.nexora-route-stop[data-state='returned'] .nexora-route-dot { background: var(--nexora-danger); border-color: var(--nexora-danger); }
.nexora-route-stop[data-state='skipped'] .nexora-route-dot { border-style: dashed; }
@media (max-width: 560px) {
  .nexora-route { flex-direction: column; gap: 10px; }
  .nexora-route-stop { padding-top: 0; padding-left: 26px; }
  .nexora-route-stop::before { top: 14px; bottom: -10px; left: 6px !important; right: auto !important; width: 2px; height: auto; }
  .nexora-route-stop:last-child::before { display: none; }
}

/* A side rail beside content: side by side when there is room, stacked when not. */
@media (max-width: 760px) {
  .nexora-split { flex-direction: column !important; align-items: stretch !important; }
  .nexora-split > * { width: 100% !important; max-width: none !important; }
}

/* Forms stack on narrow screens without each page re-implementing it. */
@media (max-width: 640px) {
  .nexora-btn { min-height: 38px; }
  .nexora-input { font-size: 16px !important; } /* stops iOS zooming on focus */
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
@keyframes nexora-blink { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0; } }
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
  /* The amber marker — reserved for "it is your turn". */
  --nexora-marker: #f5b82e;
  --nexora-markerSoft: #fdf0cc;
  --nexora-markerInk: #3d2c00;
  /* Shape (overridable per scope; see .nexora-landing). */
  --nexora-radius-sm: 7px;
  --nexora-radius-md: 10px;
  --nexora-radius-lg: 16px;
  --nexora-radius-xl: 22px;
  --nexora-control-sm: 32px;
  --nexora-control-md: 38px;
  --nexora-control-lg: 44px;
  /* App shell: a dark ink rail beside the light desk. */
  --nexora-shellSidebar: #14201c;
  --nexora-shellTopbar: color-mix(in srgb, var(--nexora-bg) 86%, transparent);
  --nexora-shellCardElevated: #ffffff;
  --nexora-cardBg: var(--nexora-surface);
  --nexora-cardBackdropFilter: none;
  --nexora-cardInsetHighlight: none;
}
[data-theme="dark"] {
  ${darkThemeCss}
  --nexora-marker: #f5b82e;
  --nexora-markerSoft: rgba(245, 184, 46, 0.18);
  --nexora-markerInk: #2b1f00;
  --nexora-shellSidebar: #080d0b;
  --nexora-shellTopbar: color-mix(in srgb, var(--nexora-bg) 86%, transparent);
  --nexora-shellCardElevated: #18231f;
  --nexora-cardBg: var(--nexora-surface);
  --nexora-cardBackdropFilter: none;
  --nexora-cardInsetHighlight: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
/* The ink rail: everything inside the sidebar reads light-on-dark in BOTH
   themes, by re-pointing the same variables the components already use. */
.nexora-sidebar {
  --nexora-text: #eef4f1;
  --nexora-textSecondary: #b3c4bc;
  --nexora-textMuted: #7f928a;
  --nexora-border: rgba(255, 255, 255, 0.10);
  --nexora-borderStrong: rgba(255, 255, 255, 0.20);
  --nexora-surface: rgba(255, 255, 255, 0.05);
  --nexora-surfaceMuted: rgba(255, 255, 255, 0.09);
  --nexora-primary: #5fd6b6;
  --nexora-primarySoft: rgba(95, 214, 182, 0.16);
  --nexora-primaryForeground: #06231c;
  --nexora-link: #7fe0c6;
  --nexora-cardBg: rgba(255, 255, 255, 0.05);
  --nexora-popoverBg: #1d2b26;
  color: var(--nexora-text);
}
/* The landing page keeps its own cinematic look: its previous palette,
   typeface and shape, untouched by the app's visual language. */
.nexora-landing {
  ${landingThemeCss}
  --nexora-radius-sm: 5px;
  --nexora-radius-md: 8px;
  --nexora-radius-lg: 12px;
  --nexora-radius-xl: 16px;
  --nexora-control-sm: 30px;
  --nexora-control-md: 34px;
  --nexora-control-lg: 40px;
  --nexora-control-weight: 500;
  --nexora-cardBg: var(--nexora-surfaceGlass);
  --nexora-cardBackdropFilter: blur(20px) saturate(150%);
  --nexora-cardInsetHighlight: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  font-family: ${typography.fontLanding};
  letter-spacing: -0.011em;
  font-feature-settings: 'cv02' 1, 'cv03' 1, 'cv04' 1, 'cv11' 1;
  font-variant-numeric: normal;
}
.nexora-landing h1, .nexora-landing h2, .nexora-landing h3, .nexora-landing h4 {
  font-family: inherit;
  letter-spacing: -0.02em;
}
.nexora-card-interactive { cursor: pointer; transition: border-color 140ms ease, box-shadow 140ms ease; }
.nexora-card-interactive:hover {
  border-color: var(--nexora-borderStrong);
  box-shadow: ${elevation.md};
}
.nexora-btn:not(:disabled):active { transform: translateY(0.5px); }
.nexora-btn-primary:not(:disabled):hover { background: var(--nexora-primaryHover); }
.nexora-btn-primary:not(:disabled):active { filter: brightness(0.92); }
.nexora-btn-secondary:not(:disabled):hover { background: var(--nexora-surfaceMuted); border-color: var(--nexora-borderStrong); }
.nexora-btn-ghost:not(:disabled):hover { background: var(--nexora-surfaceMuted); color: var(--nexora-text); }
.nexora-btn-danger:not(:disabled):hover { filter: brightness(0.93); }
.nexora-btn-danger:not(:disabled):active { filter: brightness(0.86); }
.nexora-input::placeholder { color: var(--nexora-textMuted); }
.nexora-input:hover:not(:focus):not(:disabled) { border-color: var(--nexora-borderStrong); }
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
