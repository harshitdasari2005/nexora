/**
 * @nexora/module-remediation — PlanBuilder (Phase 10).
 *
 * The DYNAMIC plan derivation: from the problem's applicable known solution
 * + the caller's agent capability set, the builder constructs the plan steps
 * deterministically. There is NO hard-coded scenario — the builder is
 * generic:
 *
 *   known solution → required capabilities → one step per capability
 *
 * Each step carries WHAT will happen (the capability's display action), WHY
 * (the solution's rationale), WHICH capability it requires, whether approval
 * is required + WHO should approve (the routing policy), WHAT it depends on
 * (the previous step — sequential), and HOW success will be verified
 * (read-back verification through the existing execution pipeline).
 *
 * The builder is BOUNDED (max steps) and validates capability membership
 * against the agent set as it goes: a step whose capability is NOT in the
 * agent's registered set is excluded — if NO step survives, the plan cannot
 * be built and the engine reports it (fail closed: a plan can never contain
 * a step beyond the caller's agent's capabilities).
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { SolutionCandidateDto } from '@nexora/contracts/detection';
import type { PlanStepDto } from '@nexora/contracts/remediation';

import { PlanStep } from '../domain/plan.js';
import type { ApprovalRoutingPolicy } from './approval-routing.js';
import type { RemediationAgent, RemediationCapabilityProvider } from './remediation-ports.js';

/** The maximum number of steps a plan may contain (bounded). */
export const MAX_PLAN_STEPS = 6;

/** A plan blueprint: the derived steps + the validation outcome of building. */
export interface PlanBlueprint {
  /** The derived steps (never empty when `ok`). */
  steps: readonly PlanStep[];
  /** The capabilities the builder excluded (not in the agent set / no tool). */
  excludedCapabilities: readonly string[];
  /** Whether ANY step survived (an empty plan is not a plan). */
  ok: boolean;
  /** The reason when the plan could not be built. */
  reason?: string;
}

/** The input the builder needs to derive a plan. */
export interface PlanBuilderInput {
  /** The plan id the steps belong to. */
  planId: string;
  /** The caller's agent (its capability set bounds every step). */
  agent: RemediationAgent;
  /** The applicable known solution the plan grounds in. */
  solution: SolutionCandidateDto;
  /** The problem's signal remediation capabilities (fallback vocabulary). */
  remediationCapabilities: readonly string[];
  /** The capability metadata provider (side-effect class + tool resolution). */
  capabilities: RemediationCapabilityProvider;
  /** The approval routing policy (who should approve what). */
  routing: ApprovalRoutingPolicy;
}

/** Derives the plan steps deterministically from the known solution. */
export class PlanBuilder {
  /**
   * Builds the plan blueprint. The step vocabulary is derived from the
   * capability metadata (display names) + the solution — never hard-coded.
   */
  async build(input: PlanBuilderInput): Promise<PlanBlueprint> {
    const required = this.#requiredCapabilities(input.solution, input.remediationCapabilities);
    const steps: PlanStep[] = [];
    const excluded: string[] = [];
    const now = nowIso();

    for (const capabilityId of required.slice(0, MAX_PLAN_STEPS)) {
      // Fail closed: a step can never use a capability outside the caller's
      // agent set, and a capability with no executable tool is unavailable.
      if (!input.agent.capabilityIds.includes(capabilityId)) {
        excluded.push(capabilityId);
        continue;
      }
      const metadata = await input.capabilities.resolve(capabilityId);
      if (metadata === undefined || metadata.toolId === undefined) {
        excluded.push(capabilityId);
        continue;
      }
      const routing = await input.routing.resolve(metadata);

      const sequence = steps.length + 1;
      const previous = steps[steps.length - 1];
      const step = PlanStep.create({
        id: prefixedId('rst'),
        planId: input.planId,
        sequence,
        action: `${input.solution.title.length > 0 ? boundedLabel(input.solution.title) : 'Known solution'}: ${metadata.name}`,
        capabilityId: metadata.capabilityId,
        description: `Execute ${metadata.name} to apply the known solution.`,
        rationale: input.solution.description || input.solution.title,
        dependencies: previous === undefined ? [] : [previous.id],
        approvalRequirement: routing.approvalRequired ? 'REQUIRED' : 'NONE',
        ...(routing.requiredApproverRoleId === undefined
          ? {}
          : { requiredApproverRoleId: routing.requiredApproverRoleId }),
        verificationRequirement:
          'The execution must complete with a verified result (read-back verification through the existing governed execution pipeline); the problem is re-evaluated after the step.',
        createdAt: now,
      });
      steps.push(step);
    }

    if (excluded.length > 0 || steps.length === 0) {
      // FAIL CLOSED: a plan can NEVER be built (or become executable) when
      // ANY required capability is missing from the caller's set or has no
      // executable tool — the whole plan is BLOCKED with an explicit reason,
      // never a partial plan missing part of the known solution.
      return {
        steps: [],
        excludedCapabilities: excluded,
        ok: false,
        reason:
          'The known solution requires capabilities outside the caller\u2019s executable agent set.',
      };
    }
    return { steps, excludedCapabilities: excluded, ok: true };
  }

  /** Resolves the capability vocabulary the steps derive from. */
  #requiredCapabilities(
    solution: SolutionCandidateDto,
    remediationCapabilities: readonly string[],
  ): readonly string[] {
    if (solution.requiredCapabilities.length > 0) {
      return solution.requiredCapabilities;
    }
    return remediationCapabilities;
  }
}

/** Bounds a solution title into a safe one-line citation label. */
function boundedLabel(title: string, max = 48): string {
  const oneLine = title
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const clean = oneLine.replace(/[\u0000-\u001f\u007f]/g, '');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Maps a step snapshot to its DTO (display). */
export function stepToDto(step: PlanStep): PlanStepDto {
  const snapshot = step.snapshot();
  return {
    id: snapshot.id,
    planId: snapshot.planId,
    sequence: snapshot.sequence,
    action: snapshot.action,
    capabilityId: snapshot.capabilityId,
    description: snapshot.description,
    rationale: snapshot.rationale,
    dependencies: snapshot.dependencies,
    approvalRequirement: snapshot.approvalRequirement,
    requiredApproverRoleId: snapshot.requiredApproverRoleId,
    verificationRequirement: snapshot.verificationRequirement,
    status: snapshot.status,
    result: snapshot.result,
    evidence: snapshot.evidence,
    approvalId: snapshot.approvalId,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    updatedAt: snapshot.updatedAt,
  };
}
