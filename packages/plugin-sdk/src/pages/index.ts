/**
 * @nexora/plugin-sdk — pages.
 *
 * Page contributions: the plugin's renderable views (FRONTEND.md §7).
 * Declarative only — the frontend maps `componentId` to framework
 * components; the SDK never ships framework code.
 */

import type { PluginId } from '../types/index.js';

/** A single page registration. */
export interface PageContribution {
  /** Contribution kind discriminant. */
  kind: 'page';
  /** Stable page id, e.g. `com.nexora.projects.overview`. */
  id: string;
  /** Page title. */
  title: string;
  /** The frontend component id that renders the page. */
  componentId: string;
  /** Route the page is mounted at. */
  route: string;
  /** Optional permission scope required to view the page. */
  requiredScope?: string;
  /** Optional page-level settings schema id (see configuration module). */
  settingsSchemaId?: string;
  /** Owning plugin id. */
  pluginId?: PluginId;
}

/** A dashboard registration: a curated home view. */
export interface DashboardContribution {
  /** Contribution kind discriminant. */
  kind: 'dashboard';
  /** Stable dashboard id. */
  id: string;
  /** Dashboard title. */
  title: string;
  /** Ordered widget ids rendered on the dashboard. */
  widgetIds: readonly string[];
  /** Optional grid layout hints (rows × columns). */
  layout?: { columns: number; rows: number };
  /** Optional permission scope required to view. */
  requiredScope?: string;
  /** Owning plugin id. */
  pluginId?: PluginId;
}

/** A view registration: a data view (list, board, calendar, ...). */
export interface ViewContribution {
  /** Contribution kind discriminant. */
  kind: 'view';
  /** Stable view id. */
  id: string;
  /** View title. */
  title: string;
  /** The frontend component id that renders the view. */
  componentId: string;
  /** View layout kind (frontend hint). */
  layout: 'list' | 'board' | 'calendar' | 'gantt' | 'custom';
  /** Optional permission scope required to view. */
  requiredScope?: string;
  /** Owning plugin id. */
  pluginId?: PluginId;
}
