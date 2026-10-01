/**
 * @nexora/app-api — composite workflow approval preflight (Prompt 9, G7b).
 *
 * A composite workflow tool (hire-and-assign, create-project-and-assign) runs
 * under ONE approval that was opened for the OUTER capability. If organization
 * approval-authority governance (POLICY_APPROVAL_AUTHORITY: separation of
 * duties, required approver role, ttl) targets an INNER capability, that
 * requirement was never applied to the human decision — so the unit approval
 * must not silently satisfy it.
 *
 * Before ANY inner step runs, every inner step's policy decision is evaluated
 * (the same PolicyPort the executor uses). The composite is refused —
 * fail-closed, audited, nothing mutated — when:
 *
 * - an inner decision is a DENY (final: a policy denial is never approvable), or
 * - an inner decision carries approval governance the outer approval record
 *   does not COVER (same or stricter: separation of duties required ⇒ the
 *   approval must record it; a required approver role ⇒ the approval must
 *   record the SAME role; a ttl ⇒ the approval's lifetime must not exceed it), or
 *   there is no outer approval record at all.
 *
 * The baseline side-effect approval (BR-13) stays satisfied by the unit
 * approval: a REQUIRE_APPROVAL WITHOUT governance is covered by definition.
 * Nothing here grants authority — it can only refuse.
 */

import type { ToolExecutionContext } from '@nexora/agent-sdk/tools';
import type { ApprovalEngine } from '@nexora/ai-runtime';
import {
  emitSecurityDecision,
  type PolicyPort,
  type SecurityDecisionSink,
} from '@nexora/ai-runtime/execution';
import type { SideEffectClass } from '@nexora/contracts/ai';

/** The stable code of the refusal (also the audited security reason code). */
export const WORKFLOW_INNER_APPROVAL_UNCOVERED = 'WORKFLOW_INNER_APPROVAL_UNCOVERED';

/** One inner step to check. */
export interface CompositeInnerStep {
  capabilityId: string;
  toolId: string;
}

/** A refusal (never thrown): the composite does not start. */
export interface CompositePreflightRefusal {
  code: 'WORKFLOW_INNER_APPROVAL_UNCOVERED' | 'WORKFLOW_INNER_POLICY_DENIED';
  /** Safe to show: names capabilities and the missing requirement, never values. */
  message: string;
}

/** The preflight a composite tool runs before starting its workflow. */
export type CompositePreflight = (input: {
  /** The composite tool's own id (audit attribution). */
  compositeToolId: string;
  context: ToolExecutionContext;
  steps: readonly CompositeInnerStep[];
}) => Promise<CompositePreflightRefusal | undefined>;

/** Dependencies of {@link createCompositePreflight}. */
export interface CompositePreflightDependencies {
  policy: PolicyPort;
  /** Reads the STORED outer approval (tenant checked by the preflight). */
  approvals: Pick<ApprovalEngine, 'byId'>;
  /** The side-effect class of a tool (defaults to consequential). */
  sideEffectOf: (toolId: string) => SideEffectClass | undefined;
  securitySink?: SecurityDecisionSink;
}

const MINUTE_MS = 60_000;

/** Builds the composite approval preflight. */
export function createCompositePreflight(
  dependencies: CompositePreflightDependencies,
): CompositePreflight {
  return async ({ compositeToolId, context, steps }) => {
    const approval =
      context.approvalId === undefined
        ? undefined
        : await dependencies.approvals.byId(context.approvalId);
    // A foreign-tenant approval is no approval at all.
    const outer =
      approval !== undefined && approval.tenantId === context.tenantId ? approval : undefined;
    const outerTtlMinutes =
      outer === undefined
        ? undefined
        : (Date.parse(outer.expiresAt) - Date.parse(outer.createdAt)) / MINUTE_MS;

    const refuse = async (
      refusal: CompositePreflightRefusal,
      step: CompositeInnerStep,
      reasonCode: 'WORKFLOW_INNER_APPROVAL_UNCOVERED' | 'POLICY_DENIED',
    ): Promise<CompositePreflightRefusal> => {
      await emitSecurityDecision(dependencies.securitySink, {
        actorId: context.userId,
        ...(context.agent === undefined ? {} : { agentId: context.agent.agentId }),
        ...(context.delegationId === undefined ? {} : { delegationId: context.delegationId }),
        origin: 'workflow',
        invocationId: context.executionId,
        organizationId: context.tenantId,
        ...(context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId }),
        toolId: compositeToolId,
        capabilityId: step.capabilityId,
        action: 'workflow.preflight',
        policyDecision: 'deny',
        reasonCode,
        reason: refusal.message,
        outcome: 'blocked',
        occurredAt: new Date().toISOString(),
      });
      return refusal;
    };

    for (const step of steps) {
      let decision;
      try {
        decision = await dependencies.policy.evaluate({
          organizationId: context.tenantId,
          ...(context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId }),
          userId: context.userId,
          ...(context.agent === undefined
            ? {}
            : {
                agent: {
                  agentId: context.agent.agentId,
                  ...(context.delegationId === undefined
                    ? {}
                    : { delegationId: context.delegationId }),
                },
              }),
          capabilityId: step.capabilityId,
          toolId: step.toolId,
          action: 'tool.execute',
          sideEffectClass: dependencies.sideEffectOf(step.toolId) ?? 'consequential',
          autonomyTier: 'supervised',
          origin: context.origin ?? 'orchestrator',
          input: {},
        });
      } catch {
        return refuse(
          {
            code: 'WORKFLOW_INNER_POLICY_DENIED',
            message: `Policy could not be evaluated for step ${step.capabilityId}; the workflow did not start`,
          },
          step,
          'POLICY_DENIED',
        );
      }
      if (decision.outcome === 'DENY') {
        return refuse(
          {
            code: 'WORKFLOW_INNER_POLICY_DENIED',
            message: `Policy ${decision.policyId} does not allow step ${step.capabilityId}; the workflow did not start`,
          },
          step,
          'POLICY_DENIED',
        );
      }
      const governance = decision.outcome === 'REQUIRE_APPROVAL' ? decision.approval : undefined;
      if (governance === undefined) {
        // ALLOW, or the baseline side-effect gate: the unit approval satisfies it.
        continue;
      }
      const missing: string[] = [];
      if (outer === undefined) {
        missing.push('a recorded approval');
      } else {
        if (governance.separationOfDuties && !outer.separationOfDuties) {
          missing.push('separation of duties');
        }
        if (
          governance.requiredApproverRoleId !== undefined &&
          outer.requiredApproverRoleId !== governance.requiredApproverRoleId
        ) {
          missing.push('the required approver role');
        }
        if (
          governance.ttlMinutes !== undefined &&
          outerTtlMinutes !== undefined &&
          outerTtlMinutes > governance.ttlMinutes
        ) {
          missing.push('the approval lifetime');
        }
      }
      if (missing.length > 0) {
        return refuse(
          {
            code: 'WORKFLOW_INNER_APPROVAL_UNCOVERED',
            message: `${WORKFLOW_INNER_APPROVAL_UNCOVERED}: step ${step.capabilityId} requires ${missing.join(', ')} that this approval does not cover; the workflow did not start`,
          },
          step,
          'WORKFLOW_INNER_APPROVAL_UNCOVERED',
        );
      }
    }
    return undefined;
  };
}
