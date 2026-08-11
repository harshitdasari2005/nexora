/**
 * @nexora/ai-runtime — planner context.
 *
 * The full context a planning strategy needs (AIR.md §6): the intent, the
 * permission-filtered discovery outcome, the run context, and the autonomy
 * tier the workspace grants.
 */

import type { AutonomyTier } from '@nexora/contracts/ai';
import type { AIContext } from '../context/index.js';
import type { DiscoveryOutcome } from '../discovery/capability-discovery.js';

/** The context handed to a {@link PlanningStrategy}. */
export interface PlannerContext {
  /** The user intent. */
  intent: string;
  /** The permission-filtered discovery outcome. */
  discovery: DiscoveryOutcome;
  /** The run context (scope, user, workspace, permissions). */
  aiContext: AIContext;
  /** The autonomy tier granted for this interaction. */
  autonomyTier: AutonomyTier;
}
