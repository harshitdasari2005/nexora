# Nexora — Design System Specification

**Product:** Nexora — _Work. Orchestrated by AI._
**Document Type:** Design System Specification (DSG)
**Version:** 1.0
**Owner:** Design Systems & Visual Design
**Audience:** Product design, frontend engineering, plugin developers, brand
**Related documents:** PRD v1.0 · PSD v1.0 · SAD v1.0 · DOMAIN_MODEL v1.0 · AIR v1.0 · BKD v1.0 · API v1.0 · PERSISTENCE v1.0 · FRONTEND v1.0

---

## 0. Purpose & Consistency

### 0.1 Purpose

This document defines the **complete design language of Nexora**: the visual philosophy, visual language, token architecture, layout system, component language (AI, workflow, enterprise, plugin), interaction patterns, accessibility, responsive behavior, iconography, and motion — the system that makes Nexora feel like an AI Operating System rather than an ERP. It contains **no implementation code, no CSS, and no components** — only design language with reasoning.

### 0.2 Consistency contract

This document is the full expansion of FRONTEND §11 (Design System Architecture). Every element defined here honors the prior documents:

| Anchor                                                           | Used here                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| FRONTEND §11 (tokens, AI styling, accessibility)                 | §3, §6, §11 — the token architecture this doc details        |
| FRONTEND §4 (shell regions), §6 (AI surfaces), §14 (security UX) | §4–§6, §8 — components serve the OS shell                    |
| FRONTEND FEX-1…12 (principles)                                   | §1–§2 — philosophy derives from FEX-*                        |
| PSD §5.3 (declarative App UI), SAD §6.2-3 (shell renders data)   | §9 — plugins inherit the system                              |
| AIR §14 (ten explainability elements), §16 (timelines)           | §6 — AI components render decision records                   |
| NFR-12 (WCAG 2.1 AA)                                             | §11 — accessibility is tokenized                             |
| PRN-1/2/10 (AI first, human control, explainable)                | §1, §6 — the AI is styled distinctly, humans stay in control |

---

## 1. Design Philosophy

### 1.1 Why Nexora feels like an Operating System, not a dashboard

| Dashboard assumption                                  | Nexora OS stance                                                                                        | Reasoning                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| The screen is a collection of widgets reporting state | The screen is **the user's workspace**: a place to act, converse, and delegate — state is ambient       | Work is orchestrated, not just observed (PRD §1)    |
| AI is a feature panel ("Ask AI")                      | AI is **the substrate**: the prompt surface is always present, results stream into context              | AI First (PRN-1, FEX-1/3)                           |
| Data density wins                                     | **Clarity wins**: minimal chrome, generous space, one primary action per view                           | FEX-5 (minimal), the OS feels calm and fast (FEX-6) |
| Brand is decoration                                   | Brand is **the experience**: precision, calm, engineered confidence — Linear × Stripe × Apple restraint | Enterprise trust (FEX-12)                           |
| Every module re-skins                                 | **One language**: shell, Apps, and plugins share tokens; variety comes from content, not chrome         | FEX-10/11, PSD §5.3                                 |

**The design stance:** Nexora is designed like a **precision instrument with a calm surface** — fast, minimal, and quietly confident. Visual noise is treated as a defect. The AI is the only element allowed to "glow"; everything else recedes so the work leads.

---

## 2. Visual Language

| Element               | Definition                                                                                                                | Reasoning                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Brand personality** | Precise · calm · intelligent · trustworthy · quietly confident                                                            | Enterprise software must earn trust; showmanship is reserved for the AI's presence, not the chrome  |
| **Visual tone**       | Restrained; near-neutral surfaces with a single cool accent; warmth only in human/AI interaction moments                  | Neutrality makes data and content the hero; warmth builds approachability (Slack/Notion blend)      |
| **Shape language**    | Soft but crisp: rounded-rect primary shapes (radius scale §3.3), no skeuomorphism; subtle squircle for AI entities        | Rounded = friendly; crisp = engineering-grade; AI entities get a distinct silhouette (FRONTEND §11) |
| **Depth**             | Layered but flat: elevation via shadow/overlay tokens (§3.4), not gradients; content planes recede in light, rise in dark | Clear hierarchy without visual clutter (FEX-5)                                                      |
| **Motion**            | Purposeful and fast: 120–240ms, easing that feels engineered; motion only where it explains state change (§14)            | Speed is a feature (FEX-6); motion is information, not decoration                                   |
| **Density**           | Comfortable by default; a "compact" density token for power users (tables, timelines)                                     | Different surfaces need different density; density is a token, not a per-screen decision            |
| **White space**       | Generous around primary content; tight within controls; whitespace is the layout engine                                   | FEX-5; gives the OS its calm, premium feel (Notion/Apple)                                           |
| **Focus**             | One clear focus per view: the active task, the running plan, the pending approval; everything else dims                   | Reduces cognitive load; supports keyboard-first (FEX-7)                                             |
| **Hierarchy**         | Typographic + spatial hierarchy from tokens; primary actions are the highest-contrast elements; AI surfaces distinct      | Consistency by construction (FEX-10/11)                                                             |

---

## 3. Design Tokens

Tokens are **the contract** of the design system (FRONTEND §11): behavior-agnostic, semantic, themeable. Every surface — shell, App, plugin — consumes tokens; no surface hardcodes values. This section defines the token architecture conceptually.

### 3.1 Spacing tokens

| Token               | Definition                                                              | Reasoning                                                                                           |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `space-1 … space-6` | 4px-based scale (4/8/12/16/24/32), extensible to 48/64 for hero layouts | 4px base keeps rhythm consistent at every breakpoint; spacing is the layout engine (§2 white space) |
| `space-gutter`      | Standard gutter between adjacent panels/columns                         | Uniform breathing room across split views (§4)                                                      |
| `space-inset`       | Padding scale for controls, cards, panels                               | Density is a token (`compact`/`comfortable`), applied via insets                                    |

### 3.2 Sizing tokens

| Token        | Definition                                                                       | Reasoning                                                                    |
| ------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `size-*`     | Control heights (sm/md/lg), icon sizes, avatar sizes, panel widths               | One sizing language for inputs, buttons, and rows prevents drift across Apps |
| `size-shell` | Sidebar width, top-bar height, AI panel widths — the OS frame's fixed dimensions | The shell is constant (FRONTEND §4); only content resizes                    |

### 3.3 Radius tokens

| Token                | Definition                                                                               | Reasoning                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `radius-sm/md/lg/xl` | 4/8/12/16 scale; `radius-full` for pills/avatars; `radius-ai` (squircle) for AI entities | Soft-but-crisp shape language (§2); AI entities get a distinct silhouette for instant recognition |

### 3.4 Elevation tokens

| Token           | Definition                                                                            | Reasoning                                                                         |
| --------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `elevation-0…4` | Resting → floating (toasts, menus) → overlay (palette, modals) → docked (side panels) | Layered-but-flat depth (§2); elevation signals what is interactive/above the page |
| `scrim`         | Overlay dimming for modals; light theme = soft dark scrim, dark theme = softer        | Focus isolation (FEX-5); modal strategy (§4.10)                                   |

### 3.5 Typography scale

| Token                         | Definition                                                                                                                               | Reasoning                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `type-display … type-caption` | Display (workspace home), title, heading, subheading, body, caption; role tokens (`type-body`, `type-label`) decouple from numeric sizes | FRONTEND §11: role tokens let Apps use consistent hierarchy without coupling to sizes |
| `type-numeric`                | Tabular-aligned numerals for tables, money, timelines                                                                                    | Data alignment is an enterprise need (Finance, Analytics — §8)                        |
| `type-mono`                   | Monospace for IDs, timestamps, technical values (trace IDs, plan IDs)                                                                    | Engineering honesty; technical identity                                               |

### 3.6 Color system

| Token family        | Definition                                                                                                                                             | Reasoning                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Color system**    | Perceptual color space (hue/saturation/lightness) with two themes (light/dark) generated from the same semantic tokens                                 | FRONTEND §11: theming without rebranding; contrast is a property of the token set, not per-screen fixes               |
| **Semantic colors** | `background`, `surface`, `surface-raised`, `text-primary/secondary/muted`, `border`, `border-strong`, `accent` (single cool accent), `accent-contrast` | One accent keeps the system calm and recognizable; surfaces separate content planes (depth, §2)                       |
| **Status colors**   | `success` · `warning` · `danger` · `info` — reserved for state, never decoration                                                                       | Enterprise truthfulness: color means something (status, not style)                                                    |
| **AI colors**       | The **AI accent** family: a distinct hue reserved exclusively for AI-originated content, suggestions, agents, and thinking indicators                  | FRONTEND §11: users must instantly recognize what is AI (trust, PRN-10); the AI is the only element that "glows" (§1) |
| **Warning colors**  | Warning/danger semantic + `warning-banner` surfaces for consequential-action context                                                                   | Consequential actions are visually unambiguous before approval (BR-13, FRONTEND §14)                                  |
| **Approval colors** | Approve = `success`, Reject = `danger`, Pending = `info`, Superseded = `muted` — the approval surface has a dedicated palette                          | Approval decisions are high-stakes; color-coding is consistent across Inbox, notifications, and dialogs (FR-28)       |

### 3.7 Motion, animation & responsive tokens

| Token family             | Definition                                                                                                                  | Reasoning                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Motion tokens**        | Duration scale 80–300ms (instants to deliberate), easing pairs (`standard`, `emphasized`, `entrance`)                       | Fast, engineered feel (§2); deliberate motion for consequential moments (approvals, installs) |
| **Animation tokens**     | Purpose-coded animation: `animate-fade`, `animate-slide`, `animate-scale`, `animate-stream` (AI typing), `animate-progress` | Motion is information (§2); AI streaming has its own token so it never mimics system loading  |
| **Responsive tokens**    | Breakpoint tokens (mobile/tablet/desktop/wide/ultrawide), density, and region-visibility tokens                             | One system adapts (§12); regions hide via tokens, never via App-specific logic (FEX-9)        |
| **Reduced-motion token** | `motion-reduced` gate that collapses animation tokens to minimal/instant                                                    | Accessibility first (NFR-12, §11)                                                             |

---

## 4. Layout System

Realizes: FRONTEND §4 (shell regions), §5 (workspace desktop); FEX-9/10. Layout is **region-composed from tokens**: the shell's geometry is constant, and only content scales (FRONTEND §4).

| Element              | Definition                                                                                                    | Reasoning                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Grid**             | 8-column mobile → 12-column desktop; content columns + gutters from `space-gutter`                            | Responsive by construction (§12); consistent measure                      |
| **Containers**       | Max-width content containers; `container-narrow` for records/forms, `container-wide` for dashboards           | Comfortable reading length; density choice per surface                    |
| **Panels**           | Floating/docked panels with elevation tokens (§3.4); slide-over side panels for AI, inbox, activity           | The OS supports ambient work without page navigation (FRONTEND §4)        |
| **Split views**      | Resizable split panes (list/detail, conversation/timeline) with persisted proportions                         | Linear-style speed; user-controlled layout                                |
| **Sidebar**          | Fixed `size-shell` width, collapsible to icon rail, auto-hide on mobile                                       | Navigation recedes; content leads (FEX-5)                                 |
| **Top Bar**          | Slim fixed bar: context, breadcrumbs, actions, status                                                         | Always-known location; never scrolls away                                 |
| **Dock**             | Optional bottom/dock quick-launch for pinned Apps and AI (power-user)                                         | Keyboard/mouse speed; workspace-first (FEX-2)                             |
| **Workspace layout** | One desktop per Workspace: home canvas + widgets + AI panel; layouts are workspace configuration (PRN-14)     | Switching Workspaces swaps the world (WS-R3, FRONTEND §5)                 |
| **Resizable areas**  | Drag handles with keyboard-accessible alternatives; persisted per user                                        | Power users control their shell (FEX-7)                                   |
| **Modal strategy**   | Modals only for focused, short tasks (approval decisions, quick edits); long tasks use panels/dedicated views | Modal fatigue is a defect; approval dialogs are deliberate (FRONTEND §14) |

---

## 5. Navigation Components

Realizes: FRONTEND §3 (navigation architecture). Navigation is rendered from declarations; every component is keyboard-first (FEX-4/7).

| Component              | Design language                                                                                   | Behavior                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Sidebar**            | Icon rail + labeled list; active = accent indicator + surface-raised; App entries from manifests  | Collapsible; per-Workspace; drag-to-reorder (pinned)            |
| **Breadcrumbs**        | Caption text + chevron separators; each crumb hover-reveals a menu of siblings                    | Always-valid destinations; quick context hops                   |
| **Tabs**               | Underline/segmented tabs within a view; no chrome in content                                      | App views stay chrome-free (FEX-10/11)                          |
| **Workspace Switcher** | Top-left avatar/logo + menu; workspace previews with icon + name; searchable                      | Workspace-first identity (FEX-2); fast switching                |
| **Quick Switcher**     | Overlay palette, fuzzy result rows, section headers, right-aligned shortcuts                      | The fastest path to anything (FRONTEND §3)                      |
| **Recent Items**       | Recency list with type icon, label, timestamp; per-Workspace                                      | Return-to-work speed; from Activity projection (PERSISTENCE §7) |
| **Favorites**          | Star/pin affordances; pinned items rise in switcher and sidebar                                   | User-owned navigation (FEX-4)                                   |
| **Command Palette**    | Single surface for commands + AI prompts; slash-prefixed AI actions visually distinct (AI accent) | Command-driven + AI-first fused (FRONTEND §6)                   |

**Navigation rules (reasoning):** (1) **Every item is keyboard-reachable** — arrows, type-to-filter, Enter (FEX-7, §11). (2) **AI entries are visibly distinct** — slash commands and AI results use the AI accent (trust, §3.6). (3) **Nothing navigates to a dead end** — every destination renders a valid view or an honest empty state (§10).

---

## 6. AI Components

Realizes: FRONTEND §6 (AI experience), AIR §14 (explainability elements), §16 (timelines). The AI has a **dedicated visual language** (§3.6): a distinct accent, squircle silhouettes, and streaming tokens — so users instantly recognize AI-originated content and always remain in control (PRN-2, PRN-10).

| Component                 | Design language                                                                                                                     | Behavior                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Conversation Window**   | Message bubbles: user = surface-raised, AI = AI-tinted surface with accent edge; sources as inline chips                            | Streaming text with `animate-stream`; sources always visible (FR-6) |
| **Prompt Input**          | Command-bar input with slash menu; AI accent focus ring; Enter = send, Shift+Enter = newline                                        | Ambient, keyboard-first (FEX-3/7)                                   |
| **Execution Timeline**    | Horizontal step strip: pending/in-flight/done/blocked states with connecting line and gate markers                                  | Live plan progress (OBS-4); the plan is always visible (AIR §6)     |
| **Decision Timeline**     | Vertical feed of decision records: intent → plan → approvals → actions → verification                                               | The AI Timeline as UI (OBS-3); each entry opens its explanation     |
| **Explainability Card**   | Collapsible card listing the ten elements (AIR §14) with drill-down links; AI accent header                                         | Trust by transparency (FR-36); deep links to records + audit        |
| **Approval Card**         | Consequential-action surface: what/records/consequences/approvers + approve/reject/modify actions; warning colors reserved for this | Approval is deliberate, never a toast (FR-28, BR-15, FRONTEND §14)  |
| **Agent Status**          | Compact presence dot + health ring + name; state from the two-plane lifecycle (AIR §4)                                              | Agent health is observable at a glance (AIR §16)                    |
| **Agent Card**            | Profile: agent identity, skills list, version, permissions summary, health; squircle avatar                                         | The marketplace of agents is browseable and auditable (AIR §5)      |
| **Reasoning View**        | Expandable stage list (AIR §7 pipeline) with inputs/outputs per stage                                                               | The "why" is inspectable at any depth (AIR §14)                     |
| **Knowledge References**  | Citation chips with source + version; hover previews passage; conflict indicator for contradictions (EC-6)                          | Grounded claims are verifiable (BR-7)                               |
| **Confidence Indicators** | Subtle strength meter on AI answers (not on gates); confidence never overrides approval (AIR §14-10)                                | Honest signal without false authority                               |

**AI component rules (reasoning):** (1) **One AI visual language everywhere** — conversation, suggestions, agents, and alerts share accent + silhouette so AI is unmistakable (FRONTEND §11). (2) **Human control is visible** — approvals, pause/cancel, and undo always present where relevant (PRN-2). (3) **Explanation is one tap away** — every AI artifact opens its decision record (ADR-011).

---

## 7. Workflow Components

Realizes: FRONTEND §6 (timelines), BKD §8 (workflow journals), WRK-*. Workflow UI makes **execution visible**: users see what is running, what is gated, and what is next — because work is the product (PRD §1).

| Component               | Design language                                                                                            | Behavior                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Workflow Card**       | Summary card: template name, status chip, owner, progress ring, SLA countdown                              | At-a-glance run state; opens the run view                          |
| **Task Graph**          | Node-and-edge graph of plan steps (DAG); gate nodes prominent; blocked nodes pulse                         | Plan-before-action is visible (AIR §6); fan-out/fan-in readable    |
| **Approval Timeline**   | Horizontal lane within the run view marking each gate and its decision (approved/rejected/superseded)      | Approval history is part of execution, not an afterthought (AUD-5) |
| **Execution Graph**     | Live DAG: step status coloring (pending/in-flight/done/failed/compensated), verified results on completion | Live OBS-4; verification marks done (AI-6)                         |
| **Progress Indicators** | Ring + linear forms; per-step and overall; never animate unless state changes                              | Honest progress (FEX-6)                                            |
| **Activity Cards**      | Feed cards: actor, action, record link, timestamp; AI actions AI-accented                                  | Activity Timeline as readable cards (OBS-2)                        |

**Workflow rules (reasoning):** (1) **Gates are visible before they happen** — the graph shows where approval will pause the run (BR-13, AIR §6). (2) **Verification is visible** — only verified steps render "done" (AI-6). (3) **Failure is readable** — failed/compensated states show the reason and the path (ER-8).

---

## 8. Enterprise Components

Realizes: FRONTEND §10 (notifications), PERSISTENCE §7 (read models), NFR-12. The enterprise surfaces must be **dense enough for power, calm enough for everyone** — density is a token, not a mode (FRONTEND §11).

| Component           | Design language                                                                                                            | Behavior                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Data Tables**     | Sticky header, sortable columns, tabular numerals, row hover, selection, density token; virtualized windows (§13 FRONTEND) | Handles 10k+ rows smoothly; keyboard navigable           |
| **Forms**           | Label-above fields, grouped sections, inline validation, one primary action; keyboard-complete                             | Fast, unambiguous data entry                             |
| **Filters**         | Token chips + filter bar; saved filters per view; AI-assisted filter suggestions (AI accent)                               | Powerful without complexity (FEX-5)                      |
| **Bulk Actions**    | Selection-aware action bar with counts; destructive bulk actions require confirmation (§10)                                | Power-user speed with safety                             |
| **Search**          | Overlay search with type headers and permission-filtered results; loading skeletons while streaming                        | FRONTEND §9; instant feel (§13 FRONTEND)                 |
| **Analytics Cards** | KPI cards with sparkline, definition link, and freshness indicator; number always traceable                                | Analytics trust (APP-09; every number has a source)      |
| **Charts**          | Minimal chart language: no 3D, no chartjunk; accessible labels; interactive tooltips                                       | Clarity over decoration; data is the hero                |
| **Notifications**   | Toast (transient), Inbox item (actionable), badge (count); AI-originated toasts AI-accented                                | FRONTEND §10: actionable or silent                       |
| **Audit Timeline**  | Read-only chronological feed of audit records with actor/action/result; filterable                                         | Compliance view (OBS-2/AUD); read-only by design (AUD-8) |

---

## 9. Plugin Components

Realizes: FRONTEND §8 (plugin UX), PSD §7 (plugin lifecycle). Plugins inherit the platform language by consuming tokens and platform components — a third-party App looks native because it _is_ built on the same language (FEX-11).

| Component               | Design language                                                                                            | Behavior                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Marketplace Card**    | Listing card: App icon, name, publisher, version, permission summary chips, install affordance             | Browse/install without leaving the OS (FRONTEND §8) |
| **Plugin Details**      | Detail view: screenshots, capabilities list (from registry, AIR §5), permissions, knowledge scope, ratings | Transparency before install (FR-15)                 |
| **Install Flow**        | Purpose-built multi-step: permission review → confirm → progress → done; each step audited                 | Install is deliberate and reversible (FR-14/15)     |
| **Permissions**         | Clear permission list with plain-language explanations; Workspace-level restriction controls               | Least-privilege is understandable (PRM-4)           |
| **Version Display**     | Version + changelog + update badge; upgrade preview shows changed contracts (FR-17)                        | Update decisions are informed (BR-15 analog)        |
| **Updates**             | Update card with "what changed" (skills, permissions, events); one-tap upgrade with rollback link          | Safe, transparent upgrades (FR-17)                  |
| **Configuration Pages** | Plugin config uses the same typed form language; scoped per Workspace                                      | Config consistency across all Apps (§8 forms)       |

**Plugin rules (reasoning):** (1) **Native by contract** — plugins consume tokens/components; there is no "plugin style" (FEX-11). (2) **Transparency at every step** — installs, upgrades, removals show consequences first (FRONTEND §8). (3) **Data state is honest** — removal shows quarantine/export state until purge (EC-3).

---

## 10. Interaction Patterns

Realizes: FRONTEND §12–14 (state, security UX), FEX-6/7. Patterns are the shared behavior vocabulary: consistent, fast, and safe.

| Pattern                 | Design language                                                                                                             | Behavior                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Hover**               | Subtle surface raise + tooltip on demand; never reveals hidden features or permissions                                      | Discovery without clutter (FEX-5)         |
| **Focus**               | Visible 2px focus ring (token); keyboard order = visual order                                                               | Keyboard-first truth (FEX-7, §11)         |
| **Loading**             | Skeletons for content, spinners only for blocking actions; streaming for AI (never spinners)                                | Perceived speed (FEX-6)                   |
| **Empty states**        | Illustrated, instructive, action-forward ("No projects — create one" + AI prompt hint)                                      | Empty is an opportunity, not a void (§13) |
| **Error states**        | Inline errors with recovery actions; error banners for systemic issues; error codes link to help                            | Errors are actionable (API §10)           |
| **Confirmation**        | Destructive/consequential actions use purpose-built confirmation with consequences (approval card for Consequential, BR-13) | Safety before action (FRONTEND §14)       |
| **Undo**                | Toast-based undo where the domain allows; irreversible actions never offer fake undo                                        | Honest recovery (PRD §18.2)               |
| **AI Streaming**        | `animate-stream` text, sources stream in, actions render as plan chips — never a blocking spinner                           | AI feels instant while working (NFR-1)    |
| **Drag & Drop**         | Keyboard-accessible alternative for every drop; reorder/assign via palette too                                              | Power + accessibility (FEX-7)             |
| **Keyboard Navigation** | Complete shortcut map; palette covers everything; Esc closes; modal traps correct                                           | The OS is keyboard-native (FEX-7)         |

---

## 11. Accessibility

Realizes: NFR-12 (WCAG 2.1 AA), FEX-8, FRONTEND §11. Accessibility is **tokenized and gated**, not per-screen effort: contrast pairs, focus, and motion are properties of the token set (FRONTEND §11).

| Area                | Design language                                                                                                      | Behavior                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Keyboard first**  | Every action keyboard-reachable; visible focus; complete shortcut map; modal traps                                   | FEX-7; the palette is the accessibility floor                    |
| **Screen readers**  | Semantic landmarks, labeled controls, announced live regions for streaming AI content and timelines                  | AI content announces progress without flooding                   |
| **Contrast**        | Contrast pairs defined in tokens for text, borders, status, and AI accent in both themes; AA at minimum              | Status and AI colors remain distinguishable for low-vision users |
| **Reduced motion**  | `motion-reduced` collapses animation tokens (§3.7); no motion carries information exclusively                        | Motion is enhancement, never the only signal                     |
| **Focus order**     | Keyboard order = visual order; skip links to main regions; focus never lost in panels                                | Predictable navigation                                           |
| **ARIA philosophy** | Platform-level pattern library for dynamic regions (conversations, timelines, palettes) — Apps inherit, not reinvent | Consistency and correctness by construction (FEX-8)              |

**Accessibility rules (reasoning):** (1) **Tokens first** — contrast and focus are baked into the token set, so every App and plugin is accessible by default (FEX-11). (2) **AI is accessible AI** — streaming, plans, and approvals have announced equivalents; no AI-only interaction is vision-only. (3) **Conformance is gated** — WCAG 2.1 AA is a release gate, not a wish (NFR-12).

---

## 12. Responsive Behavior

Realizes: FEX-9, FRONTEND §15 (mobile/tablet strategy). One system, adapted by tokens and region visibility — never separate designs (FRONTEND §15).

| Breakpoint         | Layout behavior                                                                | Content behavior                                                                 |
| ------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Mobile**         | Sidebar → drawer; AI Command Bar is the home; single column; dock hidden       | Conversation-first: approvals, notifications, search, quick views (FRONTEND §15) |
| **Tablet**         | Collapsed rail sidebar; split views stack; panels become overlays              | Prioritizes inbox + approvals + dashboards                                       |
| **Desktop**        | Full shell: all regions, split views, dock                                     | Full AI surfaces and App views (primary target)                                  |
| **Large monitors** | Wider content containers + optional multi-column dashboards; whitespace leads  | Density token lets power users tighten                                           |
| **Ultra-wide**     | Content max-width preserved; side panels docked; workspaces may use multi-pane | No stretched text; panel flexibility                                             |

**Responsive rules (reasoning):** (1) **Region visibility via tokens** — the shell's regions hide per breakpoint via tokens, not per-view logic (FEX-9). (2) **Conversation survives everywhere** — the AI Command Bar is reachable at every size (FRONTEND §15). (3) **No feature orphans** — every surface uses the same server contracts; mobile never re-implements logic (SAD §14.3).

---

## 13. Iconography

Realizes: FRONTEND §11 (icons). Iconography is **one system with one exception — the AI** — so icon language reinforces the AI-first identity (PRN-1).

| Element                | Design language                                                                                                                       | Reasoning                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Icon set**           | One stroke-based set (1.5px weight family), 16/20/24 sizes, optical alignment; no filled duplicates except active states              | Consistent, crisp, engineering-grade (FRONTEND §11)                           |
| **Illustration style** | Minimal geometric illustrations with the platform palette; 2-tone (surface + accent) with soft shadows                                | Calm, modern, non-corporate (not ERP)                                         |
| **Empty states**       | Illustrated scenes that teach the next action; AI hint line where relevant                                                            | Empty is an opportunity (§10)                                                 |
| **Brand graphics**     | A restrained identity: mark + wordmark in the platform type language; used sparingly in shell, marketing, and install flows           | Brand is the experience (§1); restraint builds trust                          |
| **AI visual language** | Distinct glyph family (squircle-based) for AI entities: agents, suggestions, thinking, and AI-originated content — always AI-accented | Users instantly distinguish AI (PRN-10, §3.6); the exception is the signature |

**Iconography rules (reasoning):** (1) **One set, one exception** — the AI glyph family is the only visual exception, making it meaningful (FRONTEND §11). (2) **Icons never carry information alone** — every icon has a label or tooltip (accessibility, §11). (3) **Plugin icons conform** — third-party Apps use the platform icon spec, keeping the marketplace visually coherent (FEX-11).

---

## 14. Motion System

Realizes: FRONTEND §13 (performance), §3.7 tokens. Motion is **information**: it explains state change, progress, and consequence — never decoration (FEX-6).

| Motion                  | Design language                                                                                             | Behavior                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Transitions**         | 120–240ms standard; entrance/exit with slight emphasis; reduced-motion collapse (§3.7)                      | Fast, engineered feel                        |
| **AI thinking**         | The AI accent's signature: a subtle shimmer/breathing indicator + streaming text; never a spinner           | AI presence without blocking (FRONTEND §13)  |
| **Workflow animation**  | Execution Graph pulses in-flight nodes; gates highlight when pending; verification ticks on done (AI-6)     | Execution is alive and readable (§7)         |
| **Approval animation**  | Deliberate, slower emphasis on approval surfaces: request rises, decision settles with success/danger color | Consequential moments deserve weight (BR-13) |
| **Plugin installation** | Sequential progress with clear steps and a completion confirmation; reversible affordance                   | Install is a meaningful event (FR-15)        |
| **Page transition**     | Skeleton → content fade-in (never slide-book); palette opens with scale+scrim                               | Instant feel, no gimmicks (FEX-6)            |

**Motion rules (reasoning):** (1) **Motion explains, never decorates** — every animation maps to a state change or progress signal (§2). (2) **Consequence gets weight** — approvals and installs move slower and settle firmly, matching their importance (BR-13). (3) **AI motion is proprietary** — only AI surfaces use the shimmer/stream language, preserving the signature (PRN-10).

---

## 15. Future Evolution

Realizes: FRONTEND §16, AIR §17 (vision/speech). The design system evolves by **extending the token + component language** — new modalities adopt the system instead of inventing their own (FEX-10/11).

| Evolution        | Design-system seam                                                                                              | What stays constant                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Voice UI**     | The conversation language extends to voice prompts + spoken confirmations; same AI accent and streaming signals | The AI visual language; plan-before-action; approval weight (BR-13) |
| **Spatial UI**   | Depth tokens and elevation adapt for spatial composition; surfaces keep semantic colors                         | Tokens as the contract; accessibility pairs; motion-reduced gate    |
| **Vision UI**    | Vision-enabled knowledge surfaces use citation chips with image previews (AIR §17)                              | Grounded-answer discipline; AI accent (BR-7)                        |
| **Desktop**      | Shell packaging with native windows; same token language and motion                                             | Region model; density tokens; keyboard-first (FEX-7)                |
| **Multi-window** | Regions become detachable windows (§4); each window keeps Workspace context (WS-R3)                             | One shell model; status/context signaling                           |
| **AI Canvas**    | A new canvas surface for plans/workflows beyond timelines; uses AI accent + execution graph language            | Human control; explainability; approval gates (PRN-2)               |

**Evolution invariants:** (1) tokens remain the contract — no surface hardcodes values; (2) the AI visual language stays exclusive to AI; (3) accessibility and reduced-motion gates apply to every new modality; (4) plugins inherit every evolution automatically (FEX-11).

---

## Readiness Checklist

| #   | Readiness item                                                          | Status     |
| --- | ----------------------------------------------------------------------- | ---------- |
| 1   | Design philosophy (OS over dashboard) ratified (§1)                     | ✅ Defined |
| 2   | Visual language defined (§2)                                            | ✅ Defined |
| 3   | Token architecture: spacing, sizing, radius, elevation, type (§3.1–3.5) | ✅ Defined |
| 4   | Color system: semantic, status, AI, warning, approval (§3.6)            | ✅ Defined |
| 5   | Motion/animation/responsive tokens (§3.7)                               | ✅ Defined |
| 6   | Layout system incl. workspace layout + modal strategy (§4)              | ✅ Defined |
| 7   | Navigation components (§5)                                              | ✅ Defined |
| 8   | AI component language (§6)                                              | ✅ Defined |
| 9   | Workflow + enterprise component language (§7–8)                         | ✅ Defined |
| 10  | Plugin component language (§9)                                          | ✅ Defined |
| 11  | Interaction patterns (§10)                                              | ✅ Defined |
| 12  | Accessibility model (§11)                                               | ✅ Defined |
| 13  | Responsive behavior model (§12)                                         | ✅ Defined |
| 14  | Iconography + AI visual language (§13)                                  | ✅ Defined |
| 15  | Motion system (§14)                                                     | ✅ Defined |

## Dependencies

| Dependency                             | From                                  | Consumed by |
| -------------------------------------- | ------------------------------------- | ----------- |
| Shell regions & AI surfaces            | FRONTEND v1.0 (§4, §6)                | §4, §6      |
| Token architecture                     | FRONTEND v1.0 (§11)                   | §3          |
| AI explainability elements & timelines | AIR v1.0 (§14, §16)                   | §6–7        |
| Approval UX contracts                  | FRONTEND v1.0 (§14), BR-13/15         | §6, §10     |
| Accessibility requirement              | PRD NFR-12                            | §11         |
| Plugin contract & lifecycle            | PSD v1.0 (§5, §7), FRONTEND v1.0 (§8) | §9          |
| Responsive strategy                    | FRONTEND v1.0 (§15)                   | §12         |

## Documents Enabled Next

1. **Concrete token reference** (exact values for §3 tokens, both themes). 2. **Component pattern library** (per §5–§9, with states). 3. **Icon + illustration asset spec** (§13). 4. **Motion choreography guide** (§14). 5. **Accessibility conformance test plan** (§11).

## Remaining Risks

| Risk                              | Mitigation                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Token sprawl as the system grows  | Token governance: additions require review; aliasing rules (§3)                |
| AI accent dilution by Apps        | Exclusive AI token family + conformance gates (§3.6, §13)                      |
| Plugin visual drift               | Platform component/token consumption is mandatory; marketplace review (FEX-11) |
| Dark-mode contrast regressions    | Token-pair contrast testing in CI; both themes are release gates (§11)         |
| Motion overuse                    | Motion review gates; every animation maps to a state change (§14)              |
| Density conflicts across surfaces | Density as a token with explicit per-surface policy (§2)                       |

## Implementation Readiness Score

**8.5 / 10 — Ready for concrete token definition and component-library build-out.**

- **Strong (fully specified):** visual language, token _architecture_, AI component language, layout/navigation language, motion system, accessibility model.
- **To reach 9.5 before full build:** (1) ratify concrete token values (both themes) against the accessibility contrast plan; (2) approve the AI-accent exclusivity policy with plugin review criteria; (3) validate motion durations against the reduced-motion gate; (4) publish the icon/illustration asset spec for the marketplace. The token reference (Documents Enabled Next) is the immediate successor artifact.

---

_End of document — Nexora Design System v1.0. Successor artifact: concrete token reference, component pattern library, icon/illustration spec, motion guide._
