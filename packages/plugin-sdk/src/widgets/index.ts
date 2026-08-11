/**
 * @nexora/plugin-sdk — widgets.
 *
 * Widget contributions: the plugin's dashboard widgets (FRONTEND.md §5,
 * DESIGN_SYSTEM.md §8). Declarative; the frontend renders widget kinds.
 */

import type { PluginId } from '../types/index.js';

/** A widget registration. */
export interface WidgetContribution {
  /** Contribution kind discriminant. */
  kind: 'widget';
  /** Stable widget id. */
  id: string;
  /** Widget title. */
  title: string;
  /** The widget kind, mapped to a renderer by the frontend. */
  widget: DashboardWidget;
  /** Optional refresh interval hint, in milliseconds. */
  refreshMs?: number;
  /** Optional permission scope required to view. */
  requiredScope?: string;
  /** Owning plugin id. */
  pluginId?: PluginId;
}

/** The union of supported widget kinds. */
export type DashboardWidget = CardWidget | MetricWidget;

/** A card widget: rich content card. */
export interface CardWidget {
  /** Widget kind discriminant. */
  kind: 'card';
  /** The frontend component id that renders the card. */
  componentId: string;
}

/** A metric widget: a single KPI with trend. */
export interface MetricWidget {
  /** Widget kind discriminant. */
  kind: 'metric';
  /** The metric label. */
  label: string;
  /** The metric source key resolved by the plugin's data provider. */
  sourceKey: string;
  /** Optional format hint (e.g. `currency`, `percent`, `number`). */
  format?: 'currency' | 'percent' | 'number' | 'duration';
}
