/**
 * @nexora/plugin-sdk — navigation.
 *
 * Navigation contributions: where a plugin's views appear inside the
 * platform shell (FRONTEND.md §3, SAD.md §6.3). Everything is declarative —
 * no framework code. The frontend resolves `componentId`s at runtime.
 */

import type { PluginId } from '../types/index.js';

/** A single navigation item in the shell. */
export interface MenuItem {
  /** Stable item id, unique within the plugin. */
  id: string;
  /** Display label. */
  label: string;
  /** Optional icon token reference (resolved by the design system). */
  icon?: string;
  /** Route the item navigates to. */
  route: string;
  /** Optional keyboard shortcut hint. */
  shortcut?: string;
}

/** A sidebar navigation item. */
export interface SidebarItem extends MenuItem {
  /** Children rendered as a nested sidebar group. */
  children?: readonly SidebarItem[];
}

/** A top-bar navigation item. */
export interface TopBarItem extends MenuItem {
  /** Optional badge text (e.g. a count). */
  badge?: string;
}

/** A command palette item (FRONTEND.md §3 quick switcher). */
export interface CommandPaletteItem {
  /** Stable item id. */
  id: string;
  /** Keywords the palette searches. */
  keywords: readonly string[];
  /** The command executed when selected. */
  action: string;
  /** Optional category grouping in the palette. */
  category?: string;
}

/** A route registration: a URL path mapped to a component id. */
export interface RouteContribution {
  /** Contribution kind discriminant. */
  kind: 'route';
  /** The URL path, e.g. `/projects`. */
  path: string;
  /** The frontend component id that renders the route. */
  componentId: string;
  /** Optional permission scope required to view the route. */
  requiredScope?: string;
}

/** A navigation contribution: the plugin's shell navigation surface. */
export interface NavigationContribution {
  /** Contribution kind discriminant. */
  kind: 'navigation';
  /** Sidebar items (root-level). */
  sidebar: readonly SidebarItem[];
  /** Top-bar items. */
  topBar: readonly TopBarItem[];
  /** Command palette items. */
  palette: readonly CommandPaletteItem[];
  /** Owning plugin id. */
  pluginId?: PluginId;
}
