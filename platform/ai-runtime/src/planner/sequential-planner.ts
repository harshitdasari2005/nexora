/**
 * @nexora/ai-runtime — sequential planner.
 *
 * The deterministic v1 planner (AIR.md §6): converts the discovery outcome
 * into a linear task graph — one step per matched capability, in discovery
 * rank order, each depending on its predecessor. Gates are attached from the
 * tool's side-effect class and the workspace autonomy tier (BR-13). Parallel
 * fan-out is a future strategy; the interface supports it (AIR.md §6.4).
 */

import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import { SIDE_EFFECT_WEIGHT } from '@nexora/shared/constants';
import { sideEffectRequiresApproval } from '@nexora/module-policy';
import type { PlannerContext } from './planner-context.js';
import type { PlanResult } from './plan-result.js';
import type { ExecutionPlan, ExecutionStep, PlanGate } from './plan.js';
import type { PlanningStrategy } from './planning-strategy.js';

/**
 * Decides whether a side-effect class requires approval under a tier (BR-13).
 * The single definition lives in the policy module (POLICY_SIDE_EFFECT_APPROVAL);
 * this is the planner's coarse, fact-free view — the executor's policy
 * decision (which may add finance/agent conditions) is authoritative.
 */
export function requiresApprovalFor(
  sideEffectClass: SideEffectClass,
  autonomyTier: AutonomyTier,
): boolean {
  return sideEffectRequiresApproval(sideEffectClass, autonomyTier);
}

/**
 * Extracts the user-controlled action parameters from the intent, shaped to
 * the tool's input schema (AIR.md §6.3 deterministic parameter binding).
 * Returns `{}` when nothing can be extracted — the tool then fails
 * validation rather than inventing input. This is the seam where future
 * LLM tool-calling plugs in without changing the planner.
 */
export type IntentParameterExtractor = (input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract. */
  inputSchema: Record<string, unknown>;
  /** The tool id the parameters target (lets one dispatcher route per tool). */
  toolId: string;
  /** The capability id matched for this step. */
  capabilityId: string;
}) => Record<string, unknown>;

/**
 * A deterministic workflow proposal: when the intent matches a registered
 * workflow template, the planner produces ONE plan step that orchestrates
 * the whole workflow (the workflow runtime executes the internal steps). The
 * proposal carries the capability/skill/tool ids plus the workflow's display
 * steps (safe names only) so the plan and the approval card can show what
 * will happen BEFORE any execution.
 */
export interface WorkflowProposal {
  /** The workflow definition key (e.g. `projects.create_and_assign_employee`). */
  workflowKey: string;
  /** The capability id of the workflow-orchestrating tool. */
  capabilityId: string;
  /** The skill id backing the capability. */
  skillId: string;
  /** The tool id invoked to run the workflow. */
  toolId: string;
  /** The side-effect class of the workflow as a whole (gating). */
  sideEffectClass: SideEffectClass;
  /** The bound workflow input (user-controlled business values only). */
  input: Record<string, unknown>;
  /** Safe display steps of the workflow (name + capability only). */
  displaySteps: readonly { id: string; name: string; capabilityId: string }[];
}

/**
 * Detects whether an intent should be planned as a workflow. Implementations
 * are deterministic (keyword/template matching) and MUST return `undefined`
 * for non-workflow intents so individual capabilities plan normally. The
 * planner never executes the workflow — the workflow runtime does.
 *
 * The detector receives the caller's TRUSTED business capability affinity
 * (S24 Phase 4): a workflow proposal is executable only when the workflow's
 * capability requirement is within the caller's affinity. When the affinity
 * is absent/empty (unmapped role, safe default) the current unrestricted
 * behavior applies — matching discovery's rule.
 */
export type WorkflowProposalDetector = (input: {
  intent: string;
  /** The caller's trusted business capability affinities, when resolved. */
  businessCapabilityIds?: readonly string[];
}) => WorkflowProposal | undefined;

/** Options for {@link SequentialPlanner}. */
export interface SequentialPlannerOptions {
  /** Capability-id allow-list; empty = use all matched capabilities. */
  allowedCapabilityIds?: readonly string[];
  /** Maximum steps in a plan (guards runaway plans). Default 10. */
  maxSteps?: number;
  /**
   * Binds user-controlled parameters from the intent into each step's
   * input. Defaults to no extraction (`{}`). Identity, tenant, and scope are
   * NEVER part of extraction — they always come from the trusted execution
   * context (AI security contract).
   */
  parameterExtractor?: IntentParameterExtractor;
  /**
   * Deterministic workflow detection (AIR.md §6.4): when the intent matches
   * a workflow template, the plan is a SINGLE workflow-orchestrating step
   * instead of the individual capability steps. The workflow runtime — not
   * the planner — executes it.
   */
  workflowPlanner?: WorkflowProposalDetector;
}

/**
 * A sequential planning strategy: linear task graph over the matched
 * capabilities, in discovery rank order.
 */
export class SequentialPlanner implements PlanningStrategy {
  readonly name = 'sequential';

  readonly #allowed: ReadonlySet<string> | undefined;
  readonly #maxSteps: number;
  readonly #extract: IntentParameterExtractor;
  readonly #detectWorkflow: WorkflowProposalDetector | undefined;

  constructor(options: SequentialPlannerOptions = {}) {
    this.#allowed =
      options.allowedCapabilityIds !== undefined
        ? new Set(options.allowedCapabilityIds)
        : undefined;
    this.#maxSteps = options.maxSteps ?? 10;
    this.#extract = options.parameterExtractor ?? (() => ({}));
    this.#detectWorkflow = options.workflowPlanner;
  }

  plan(context: PlannerContext): PlanResult {
    // Workflow first: a deterministic workflow intent becomes ONE plan step
    // (the workflow-orchestrating tool); the workflow runtime executes the
    // internal steps. Individual capability matches are ignored for this
    // intent — never a mix of workflow and per-capability steps. The
    // detector consults the caller's trusted business capability affinity
    // (S24 Phase 4): a workflow proposal must be within the role's
    // affinities — approval is governance, never privilege escalation.
    const proposal = this.#detectWorkflow?.({
      intent: context.intent,
      businessCapabilityIds: context.aiContext.business?.capabilityIds,
    });
    if (proposal !== undefined) {
      return this.#planWorkflow(proposal, context);
    }

    const matches = context.discovery.scores;
    const capabilities = context.discovery.capabilities;
    const byId = new Map(capabilities.map((capability) => [capability.id, capability]));

    const steps: ExecutionStep[] = [];
    const gates: PlanGate[] = [];
    let previousId: string | undefined;

    for (const score of matches) {
      if (steps.length >= this.#maxSteps) {
        break;
      }
      if (this.#allowed !== undefined && !this.#allowed.has(score.capabilityId)) {
        continue;
      }
      const capability = byId.get(score.capabilityId);
      if (capability === undefined) {
        continue;
      }
      const skill = context.discovery.skills.find((s) => s.id === capability.skillId);
      if (skill === undefined || skill.toolIds.length === 0) {
        continue;
      }
      const toolId = skill.toolIds[0] as string;
      const stepId = `step_${steps.length + 1}`;
      const sideEffectClass = sideEffectClassOf(context, score.capabilityId, toolId);
      const toolInputSchema =
        context.discovery.tools.find((tool) => tool.id === toolId)?.inputSchema ?? {};
      // User-controlled action parameters only — never identity/tenant/scope
      // (those are assembled from the trusted execution context downstream).
      const input = this.#extract({
        intent: context.intent,
        inputSchema: toolInputSchema,
        toolId,
        capabilityId: capability.id,
      });
      const requiresApproval = requiresApprovalFor(sideEffectClass, context.autonomyTier);

      const gate: PlanGate | undefined = requiresApproval
        ? {
            stepId,
            sideEffectClass,
            requiresApproval: true,
            reason: `${sideEffectClass} action under ${context.autonomyTier} tier requires approval`,
          }
        : undefined;

      steps.push({
        id: stepId,
        capabilityId: capability.id,
        skillId: skill.id,
        toolId,
        input,
        dependsOn: previousId === undefined ? [] : [previousId],
        gate,
        status: 'pending',
      });
      if (gate !== undefined) {
        gates.push(gate);
      }
      previousId = stepId;
    }

    if (steps.length === 0) {
      return {
        success: false,
        strategy: this.name,
        reason: 'No executable capability matched the intent',
        confidence: 0,
      };
    }

    const plan: ExecutionPlan = {
      id: prefixedId('plan'),
      intent: context.intent,
      graph: { steps, entryPointIds: [steps[0]!.id] },
      gates,
      authorityEnvelope: authorityOf(context),
      createdAt: nowIso(),
    };
    return {
      success: true,
      plan,
      strategy: this.name,
      confidence: planConfidence(plan),
    };
  }

  /** Builds a single-step plan for a workflow proposal (never executes it). */
  #planWorkflow(proposal: WorkflowProposal, context: PlannerContext): PlanResult {
    const stepId = 'step_1';
    const requiresApproval = requiresApprovalFor(proposal.sideEffectClass, context.autonomyTier);
    const gate: PlanGate | undefined = requiresApproval
      ? {
          stepId,
          sideEffectClass: proposal.sideEffectClass,
          requiresApproval: true,
          reason: `${proposal.sideEffectClass} workflow under ${context.autonomyTier} tier requires approval`,
        }
      : undefined;

    const step: ExecutionStep = {
      id: stepId,
      capabilityId: proposal.capabilityId,
      skillId: proposal.skillId,
      toolId: proposal.toolId,
      input: proposal.input,
      dependsOn: [],
      gate,
      status: 'pending',
      workflowSteps: proposal.displaySteps,
    };
    const plan: ExecutionPlan = {
      id: prefixedId('plan'),
      intent: context.intent,
      graph: { steps: [step], entryPointIds: [stepId] },
      gates: gate === undefined ? [] : [gate],
      authorityEnvelope: authorityOf(context),
      createdAt: nowIso(),
    };
    return {
      success: true,
      plan,
      strategy: this.name,
      confidence: 0.9,
    };
  }
}

function sideEffectClassOf(
  context: PlannerContext,
  capabilityId: string,
  toolId: string,
): SideEffectClass {
  const tool = context.discovery.tools.find((t) => t.id === toolId);
  if (tool !== undefined) {
    return tool.sideEffectClass;
  }
  const capability = context.discovery.capabilities.find((c) => c.id === capabilityId);
  return capability?.sideEffectClass ?? 'read_only';
}

function authorityOf(context: PlannerContext): string {
  return `user:${context.aiContext.execution.userId}@tenant:${context.aiContext.execution.tenantId}`;
}

function planConfidence(plan: ExecutionPlan): number {
  const weights = plan.graph.steps.map(
    (step) => SIDE_EFFECT_WEIGHT[step.gate?.sideEffectClass ?? 'read_only'],
  );
  const max = Math.max(0, ...weights);
  const min = Math.min(0, ...weights);
  const span = max - min;
  if (span === 0) {
    return 0.9;
  }
  return Math.max(0.1, 1 - span / 3);
}
