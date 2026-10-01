/**
 * @nexora/ai-runtime — orchestrator dependencies.
 *
 * The EAO's composition root contract (AIR.md §2): every dependency is
 * injected, nothing is hardcoded. The runtime is provider-independent — the
 * model provider and its narration prompt arrive through options.
 */

import type { ConfigManager } from '@nexora/config';
import type { PlanningStrategy } from '../planner/planning-strategy.js';
import type { CapabilityDiscovery } from '../discovery/capability-discovery.js';
import type { ToolExecutor } from '../execution/tool-executor.js';
import type { RunTelemetryHub } from '@nexora/module-observability';
import type { LineagePort } from '../execution/lineage-port.js';
import type { SecurityDecisionSink } from '../execution/security-decision.js';
import type { ExecutionVerifier } from '../verification/execution-verifier.js';
import type { ConversationManager } from '../conversation/conversation-manager.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import type { PromptRegistry } from '../prompting/prompt-registry.js';
import type { TelemetrySink } from '../telemetry/telemetry.js';
import type { RuntimeEventBus } from '../events/runtime-events.js';
import type { ApprovalEngine } from '../approval/engine.js';

/** Options for the {@link EnterpriseAIOrchestrator}. */
export interface OrchestratorOptions {
  /** The planning strategy (defaults to a sequential planner). */
  planner?: PlanningStrategy;
  /** The capability discovery service. */
  discovery: CapabilityDiscovery;
  /** The tool executor (the only execution path). */
  executor: ToolExecutor;
  /** The verifier (defaults to a default verifier). */
  verifier?: ExecutionVerifier;
  /** The conversation manager. */
  conversations: ConversationManager;
  /** The model provider registry, when a provider narrates. */
  providers?: ProviderRegistry;
  /** The prompt registry, when provider narration uses templates. */
  prompts?: PromptRegistry;
  /** The telemetry sink (defaults to no-op). */
  telemetry?: TelemetrySink;
  /** The runtime event bus (defaults to an in-memory bus). */
  events?: RuntimeEventBus;
  /** Optional configuration manager for runtime settings. */
  configManager?: ConfigManager;
  /** Narration prompt template id, when provider narration is used. */
  narrationPromptId?: string;
  /**
   * The approval engine: the server-side record of approval requests and
   * decisions (AIR.md §12). When injected, state-changing gates open a
   * recorded request, and execution happens ONLY after a granted decision.
   * Without it, gates fall back to the request-level auto-approve test hook.
   */
  approvals?: ApprovalEngine;
  /**
   * Receives a record of every security block the orchestrator makes
   * (forged arguments before an approval opens, approved arguments that no
   * longer match, a narration that disclosed system instructions).
   */
  securitySink?: SecurityDecisionSink;
  /** Receives a PLANNED_ACTION lineage event per step (Prompt 6); best-effort, one-way. */
  lineage?: LineagePort;
  /**
   * Collects per-run timing, model and tool telemetry (Prompt 7) and persists
   * each finished run best-effort. Descriptive only.
   */
  runTelemetry?: RunTelemetryHub;
}

/** Runtime configuration keys read from the ConfigManager (BKD.md §11). */
export const RUNTIME_CONFIG_KEYS = {
  autonomyTier: 'ai.runtime.autonomyTier' as const,
  maxPlanSteps: 'ai.runtime.maxPlanSteps' as const,
  narrationModel: 'ai.runtime.narrationModel' as const,
  autoApprove: 'ai.runtime.autoApprove' as const,
} as const;

/** Reads a runtime setting from the ConfigManager, or a default. */
export function runtimeSetting(
  configManager: ConfigManager | undefined,
  key: string,
  fallback: string | number | boolean | undefined,
): string | number | boolean | undefined {
  if (configManager === undefined) {
    return fallback;
  }
  const value = configManager.get(key as never);
  return (value as string | number | boolean | undefined) ?? fallback;
}
