/**
 * @nexora/ai-runtime — policy port (Prompt 5).
 *
 * For every tool invocation the {@link ToolExecutor} asks a PolicyPort for a
 * {@link PolicyDecision} — AFTER RBAC, agent delegation and argument checks
 * have allowed the action, and BEFORE the approval gate and the mutation.
 * The port never receives model output as a policy input: it is given the
 * trusted invocation, resolves trusted facts (persisted budget state,
 * persisted organization policy configuration) itself, and returns the
 * pure engine's decision.
 *
 * If the port throws, the executor fails closed (`POLICY_UNAVAILABLE`).
 * With no port wired, the executor uses {@link DefaultPolicyPort}: the pure
 * engine with no resolved facts, so fact-dependent rules (finance) deny
 * rather than assume.
 */

import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';
import { PolicyEngine, type PolicyDecision } from '@nexora/module-policy';

/** One policy question. Every field is a trusted server-side value. */
export interface PolicyInvocationRequest {
  organizationId: string;
  workspaceId?: string;
  userId: string;
  agent?: { agentId: string; delegationId?: string };
  capabilityId: string;
  toolId: string;
  action: string;
  sideEffectClass: SideEffectClass;
  autonomyTier: AutonomyTier;
  origin: string;
  /** The arguments being executed / approved (operands, never claims). */
  input: Readonly<Record<string, unknown>>;
}

/** Decides policy for an invocation. */
export interface PolicyPort {
  evaluate(request: PolicyInvocationRequest): Promise<PolicyDecision>;
}

/** The pure engine with no resolved facts (default when the host wires no port). */
export class DefaultPolicyPort implements PolicyPort {
  readonly #engine: PolicyEngine;

  constructor(engine: PolicyEngine = new PolicyEngine()) {
    this.#engine = engine;
  }

  async evaluate(request: PolicyInvocationRequest): Promise<PolicyDecision> {
    return this.#engine.evaluate({
      organizationId: request.organizationId,
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      actor: { userId: request.userId },
      ...(request.agent === undefined ? {} : { agent: request.agent }),
      capabilityId: request.capabilityId,
      toolId: request.toolId,
      action: request.action,
      sideEffectClass: request.sideEffectClass,
      autonomyTier: request.autonomyTier,
      origin: request.origin,
      input: request.input,
      facts: { configs: {} },
    });
  }
}
