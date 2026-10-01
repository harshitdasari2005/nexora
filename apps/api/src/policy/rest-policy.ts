/**
 * @nexora/app-api — REST policy enforcement (Prompt 8).
 *
 * A direct human REST mutation is never a way around a policy DENY. Routes
 * that reach a capability the central policy engine governs call
 * {@link enforceRestPolicy}, which asks the SAME {@link PolicyPort} every AI
 * surface (chat, agents, MCP, workflows) uses — with origin `rest` — over the
 * same trusted facts (persisted budget, persisted organization policy
 * configuration). Nothing here grants authority: RBAC and membership run
 * first, and a policy can only constrain.
 *
 * - `DENY`             -> the route refuses (403 `POLICY_DENIED`, policy id/
 *                         version in the error) and an `ai.security.blocked`-
 *                         style event with origin `rest` is audited.
 * - `REQUIRE_APPROVAL` -> returned to the route. A route whose domain has its
 *                         own submitted -> decided approval flow (expenses)
 *                         proceeds and records the decision in its response;
 *                         a composite route (workflows) refuses (409
 *                         `APPROVAL_REQUIRED`) unless only the baseline
 *                         side-effect gate applies.
 * - engine failure     -> fails closed (503 `POLICY_UNAVAILABLE`).
 */

import type { PolicyPort, SecurityDecisionSink } from '@nexora/ai-runtime/execution';
import { emitSecurityDecision } from '@nexora/ai-runtime/execution';
import type { SideEffectClass } from '@nexora/contracts/ai';
import { POLICY_IDS, type PolicyDecision } from '@nexora/module-policy';

/** What a route needs to ask the policy question. */
export interface RestPolicyDependencies {
  policy: PolicyPort;
  /** Audits denials (`ai.security.blocked`, origin `rest`). Best-effort. */
  securitySink?: SecurityDecisionSink;
}

/** The trusted question (never taken from the request beyond operands). */
export interface RestPolicyRequest {
  /** The governed capability id (the policy vocabulary), e.g. `finance.submit_expense`. */
  capabilityId: string;
  /** Trusted scope: membership-verified organization / workspace. */
  organizationId: string;
  workspaceId?: string;
  /** The authenticated human. */
  userId: string;
  /** The Fastify request id (audit correlation). */
  requestId: string;
  /** The operands the rules compare (amounts, budget ids) — never claims. */
  input: Readonly<Record<string, unknown>>;
  /** The capability's side-effect class (defaults to consequential). */
  sideEffectClass?: SideEffectClass;
  /** Audit only: do not record a denial event (used by preflight checks that report it themselves). */
  quiet?: boolean;
  /**
   * DENY reason codes the ROUTE'S DOMAIN answers itself (e.g. an unresolvable
   * resource is a plain NOT_FOUND, not a policy refusal). Such a DENY is
   * returned as `deferred: true` (not refused, not audited): the domain still
   * rejects the request, since the resource is not in the trusted scope.
   */
  deferReasonCodes?: readonly string[];
}

/** The compact decision record a response can carry. */
export interface RestPolicyRecord {
  outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  policyId: string;
  version: string;
  reasonCode: string;
}

/** The result of {@link enforceRestPolicy}. */
export type RestPolicyResult =
  | {
      ok: true;
      decision: PolicyDecision;
      record: RestPolicyRecord;
      baselineApprovalOnly: boolean;
      /** True when a DENY was deferred to the route's domain (see `deferReasonCodes`). */
      deferred?: true;
    }
  | {
      ok: false;
      status: 403;
      code: 'POLICY_DENIED';
      message: string;
      policy: { policyId: string; version: string; reasonCode: string };
    }
  | { ok: false; status: 503; code: 'POLICY_UNAVAILABLE'; message: string };

/**
 * Evaluates policy for a REST mutation. Never throws: an engine failure is a
 * fail-closed `POLICY_UNAVAILABLE` result.
 */
export async function enforceRestPolicy(
  dependencies: RestPolicyDependencies,
  request: RestPolicyRequest,
): Promise<RestPolicyResult> {
  const capabilityId = request.capabilityId;
  let decision: PolicyDecision;
  try {
    decision = await dependencies.policy.evaluate({
      organizationId: request.organizationId,
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      userId: request.userId,
      capabilityId,
      toolId: capabilityId,
      action: 'rest.mutate',
      sideEffectClass: request.sideEffectClass ?? 'consequential',
      // A human at the console: supervised (never the autonomous tier).
      autonomyTier: 'supervised',
      origin: 'rest',
      input: request.input,
    });
  } catch {
    if (request.quiet !== true) {
      await audit(dependencies, request, {
        reasonCode: 'POLICY_UNAVAILABLE',
        reason: 'policy could not be evaluated; the request was not executed',
      });
    }
    return {
      ok: false,
      status: 503,
      code: 'POLICY_UNAVAILABLE',
      message: 'Policy could not be evaluated for this action; it was not executed',
    };
  }

  if (decision.outcome === 'DENY' && request.deferReasonCodes?.includes(decision.reasonCode)) {
    return {
      ok: true,
      deferred: true,
      decision,
      record: {
        outcome: 'DENY',
        policyId: decision.policyId,
        version: decision.version,
        reasonCode: decision.reasonCode,
      },
      baselineApprovalOnly: false,
    };
  }

  if (decision.outcome === 'DENY') {
    if (request.quiet !== true) {
      await audit(dependencies, request, {
        reasonCode: 'POLICY_DENIED',
        reason: decision.reason,
        decision,
      });
    }
    return {
      ok: false,
      status: 403,
      code: 'POLICY_DENIED',
      message: `Policy ${decision.policyId} does not allow this action: ${decision.reason}`,
      policy: {
        policyId: decision.policyId,
        version: decision.version,
        reasonCode: decision.reasonCode,
      },
    };
  }

  return {
    ok: true,
    decision,
    record: {
      outcome: decision.outcome === 'REQUIRE_APPROVAL' ? 'REQUIRE_APPROVAL' : 'ALLOW',
      policyId: decision.policyId,
      version: decision.version,
      reasonCode: decision.reasonCode,
    },
    // True when the ONLY reason for REQUIRE_APPROVAL is the baseline
    // side-effect gate (which a direct human action satisfies).
    baselineApprovalOnly:
      decision.outcome !== 'REQUIRE_APPROVAL' ||
      (decision.approval === undefined &&
        decision.matchedRules.every(
          (rule) =>
            rule.outcome !== 'REQUIRE_APPROVAL' ||
            rule.policyId === POLICY_IDS.SIDE_EFFECT_APPROVAL,
        )),
  };
}

/**
 * The policy that requires approval beyond the baseline side-effect gate
 * (approval governance first, then the first non-baseline REQUIRE_APPROVAL
 * rule), or `undefined` when only the baseline gate applies.
 */
export function governingApprovalPolicy(
  decision: PolicyDecision,
): { policyId: string; version: string; reasonCode: string } | undefined {
  if (decision.approval !== undefined) {
    return {
      policyId: decision.approval.policyId,
      version: decision.approval.policyVersion,
      reasonCode: 'APPROVAL_GOVERNANCE',
    };
  }
  const rule = decision.matchedRules.find(
    (candidate) =>
      candidate.outcome === 'REQUIRE_APPROVAL' &&
      candidate.policyId !== POLICY_IDS.SIDE_EFFECT_APPROVAL,
  );
  return rule === undefined
    ? undefined
    : { policyId: rule.policyId, version: rule.version, reasonCode: rule.reasonCode };
}

/** Sends the refusal of a failed {@link RestPolicyResult}. */
export function sendRestPolicyRefusal(
  reply: { code(status: number): { send(body: unknown): unknown } },
  requestId: string,
  result: Extract<RestPolicyResult, { ok: false }>,
): unknown {
  return reply.code(result.status).send({
    error: {
      code: result.code,
      message: result.message,
      requestId,
      ...(result.code === 'POLICY_DENIED' ? { policy: result.policy } : {}),
    },
  });
}

async function audit(
  dependencies: RestPolicyDependencies,
  request: RestPolicyRequest,
  block: {
    reasonCode: 'POLICY_DENIED' | 'POLICY_UNAVAILABLE';
    reason: string;
    decision?: PolicyDecision;
  },
): Promise<void> {
  await emitSecurityDecision(dependencies.securitySink, {
    actorId: request.userId,
    origin: 'rest',
    invocationId: request.requestId,
    organizationId: request.organizationId,
    ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    toolId: request.capabilityId,
    capabilityId: request.capabilityId,
    action: 'rest.mutate',
    ...(block.decision === undefined
      ? {}
      : {
          policyId: block.decision.policyId,
          policyVersion: block.decision.version,
          policyRules: block.decision.matchedRules.map(
            (m) => `${m.policyId}@${m.version}=${m.outcome}`,
          ),
        }),
    policyDecision: 'deny',
    reasonCode: block.reasonCode,
    reason: block.reason,
    outcome: 'blocked',
    occurredAt: new Date().toISOString(),
  });
}
