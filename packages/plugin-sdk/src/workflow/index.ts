/**
 * @nexora/plugin-sdk — workflow.
 *
 * Workflow contributions: workflow templates a plugin makes installable in
 * the Workflow platform (SAD.md §12, PSD.md §8). The canonical
 * `WorkflowDefinition` from `@nexora/contracts/workflow` is reused; a
 * template is a definition plus the plugin's declaration.
 */

import type { WorkflowDefinition, WorkflowStep, ApprovalPoint } from '@nexora/contracts/workflow';
import type { PluginId } from '../types/index.js';

/** A workflow trigger: when an instance starts. */
export interface WorkflowTrigger {
  /** Trigger kind. */
  kind: 'event' | 'manual' | 'schedule';
  /** Event type that starts the workflow, for `event` triggers. */
  eventType?: string;
  /** Human-readable description of when the trigger fires. */
  description: string;
}

/** A workflow template: a reusable, plugin-owned definition. */
export interface WorkflowTemplate {
  /** Template id, e.g. `com.nexora.hr.onboarding`. */
  id: string;
  /** Template name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** The workflow definition (canonical, SAD.md §12.2). */
  definition: WorkflowDefinition;
  /** The trigger that starts instances of this workflow. */
  trigger: WorkflowTrigger;
}

/** A workflow contribution. */
export interface WorkflowContribution {
  /** Contribution kind discriminant. */
  kind: 'workflow';
  /** The workflow templates the plugin provides. */
  templates: readonly WorkflowTemplate[];
  /** Owning plugin id. */
  pluginId?: PluginId;
}

/** Convenience type alias for building workflow steps (contracts shape). */
export type PluginWorkflowStep = WorkflowStep;

/** Convenience type alias for building approval points (contracts shape). */
export type PluginApprovalPoint = ApprovalPoint;
