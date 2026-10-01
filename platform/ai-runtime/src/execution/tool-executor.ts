/**
 * @nexora/ai-runtime — tool executor.
 *
 * The execution gatekeeper for everything the runtime does (AIR.md §10): it
 * resolves, validates, guards, invokes, retries, times out, and verifies
 * tool calls. No tool executes outside this executor (ADR-001). The
 * orchestrator dispatches only through here — the runtime never calls
 * business services directly.
 *
 * S34 RBAC: this is also the ONE enforcement point for the caller's
 * effective capability ceiling. When an invocation carries
 * `allowedCapabilityIds` (the API layer populates it from the caller's
 * TRUSTED RBAC permission set — never a client claim), a tool whose id
 * falls outside that set is rejected with `FORBIDDEN` before the side-effect
 * guard even runs — the AI can never execute an action the caller's own role
 * could not perform, whether the call arrived through chat discovery, an
 * agent proposal, or a direct MCP tool invocation (which bypasses discovery
 * entirely and previously had no capability check at all).
 *
 * Empty-ceiling modes: an ABSENT (`undefined`) ceiling is explicitly
 * unrestricted and is for trusted internal callers only; an EMPTY (`[]`)
 * ceiling grants NO authority (it used to read as "no restriction", which
 * made a role with no executable capability the most powerful one). Agent
 * invocations are also bounded by the execution-time delegation check.
 */

import { toNexoraError } from '@nexora/shared/errors';
import type { AutonomyTier, SideEffectClass } from '@nexora/contracts/ai';
import type { AgentPrincipalContext } from '@nexora/contracts/agent';

import { DEFAULT_TOOL_VERIFICATION, type ToolVerificationMetadata } from '@nexora/agent-sdk/tools';

import type { ExecutableToolRegistry } from '../registry/executable-tools.js';
import type { ExecutionVerifier } from '../verification/execution-verifier.js';
import { DefaultExecutionVerifier } from '../verification/execution-verifier.js';
import type { VerificationResult } from '../verification/verification-result.js';
import { ArgumentGuard } from './argument-guard.js';
import {
  emitSecurityDecision,
  type SecurityDecisionSink,
  type SecurityOrigin,
  type SecurityReasonCode,
} from './security-decision.js';
import type { AgentAuthorityPort } from './agent-authority.js';
import { policyIdForReason, type PolicyDecision } from '@nexora/module-policy';
import { DefaultPolicyPort, type PolicyPort } from './policy-port.js';
import { fingerprintOf } from '@nexora/module-lineage';
import type { RetryRecord, RunTelemetryHub, ToolCall } from '@nexora/module-observability';
import type { LineagePolicyRef, LineagePort, LineageVerification } from './lineage-port.js';
import { prefixedId } from '@nexora/shared/ids';
import { noRetryPolicy, sleep, type RetryPolicy } from './retry-policy.js';
import { noTimeoutPolicy, type TimeoutPolicy } from './timeout-policy.js';

/** A single tool invocation request. */
export interface ToolInvocation {
  /** The tool id to invoke. */
  toolId: string;
  /** The input payload (untrusted — model-generated arguments). */
  input: Record<string, unknown>;
  /** The authenticated user id (trusted server-side context). */
  userId: string;
  /** Tenant scope (trusted). */
  tenantId: string;
  /** Workspace scope, when workspace-scoped (trusted). */
  workspaceId?: string;
  /** Run id for tracing. */
  runId: string;
  /** Autonomy tier of the invoking run (approval gating). */
  autonomyTier?: AutonomyTier;
  /**
   * The CAPABILITY id this invocation is bound to, when the caller knows it
   * (the orchestrator always does — it comes from the planned step). Checked
   * against `allowedCapabilityIds` — the SAME vocabulary the discovery-layer
   * affinity/allow-list filter already checks (capability ids, which are
   * NOT always identical to the tool id: the two coincide in this codebase's
   * own first-party registrations, by convention, but a generic caller may
   * register them distinctly). Falls back to `toolId` when absent, which is
   * correct for any caller (like the direct MCP tool surface) that only
   * knows tool ids under a convention where the two are the same string.
   */
  capabilityId?: string;
  /**
   * The caller's effective RBAC capability ceiling (S34), when the caller
   * resolves to a trusted business role — never a client-supplied value.
   *
   * Explicit ceiling MODES (empty-ceiling hardening):
   * - `undefined` — NO ceiling: explicitly unrestricted, reserved for trusted
   *   internal callers that carry no RBAC role. Composition sites that run AS
   *   an agent always pass an explicit ceiling (never this mode).
   * - `[]` — an EMPTY ceiling: NO authority. Nothing is permitted.
   * - non-empty — only the listed capability ids are permitted.
   */
  allowedCapabilityIds?: readonly string[];
  /** The entry point that issued the invocation (security audit attribution). */
  origin?: SecurityOrigin;
  /**
   * The TRUSTED agent principal this invocation runs as (Prompt 4). Set only
   * by server code from a persisted agent identity — never from input or a
   * model. When present, the {@link AgentAuthorityPort} must authorize the
   * capability at execution time or the invocation fails closed.
   */
  agent?: AgentPrincipalContext;
  /** The approval this invocation executes under, when resuming one (audit). */
  approvalId?: string;
  /**
   * The fingerprint of the policy decision recorded on the approval this
   * invocation resumes (Prompt 5). When present, the CURRENT decision must
   * carry the same fingerprint — an approval never executes under a policy
   * that changed after the human decided (`POLICY_CHANGED_AFTER_APPROVAL`).
   */
  approvedPolicy?: string;
  /**
   * The key runtime telemetry files this invocation under, when it differs
   * from `runId` (an MCP tool call is its own run inside a shared session).
   */
  runKey?: string;
  /**
   * Lineage/audit ATTRIBUTION only (never authority): the initiating agent
   * principal and delegation a workflow inner step executes on behalf of.
   * Unlike {@link agent}, setting this NEVER triggers a delegation check —
   * the workflow was authorized as ONE unit (workflow-level authorization +
   * approval), bounded by `allowedCapabilityIds`.
   */
  attribution?: { agent?: AgentPrincipalContext; delegationId?: string };
  /**
   * Why `approvalGranted` is true for a workflow inner step. `direct_human`
   * (a direct, RBAC-authorized operator start with no approval record)
   * satisfies ONLY the baseline side-effect approval gate; a REQUIRE_APPROVAL
   * outcome produced by any other policy still blocks. `approval_engine`
   * (or absent) means a recorded approval covers the action.
   */
  approvalBasis?: 'approval_engine' | 'direct_human';
  /**
   * The approver of the approval this invocation executes under (lineage
   * DESCRIPTION only — never read by any authorization decision; the actor
   * stays `userId`, the requester).
   */
  approvedBy?: { userId: string; roleId?: string; decidedAt?: string };
  /** Workflow attribution for lineage (step vs compensation). */
  lineage?: { workflow?: { stepId?: string; purpose?: 'step' | 'compensation' } };
}

/** The outcome of a tool invocation. */
export interface ToolExecutionResult {
  /** Whether the invocation succeeded and was verified. */
  ok: boolean;
  /** The tool id invoked. */
  toolId: string;
  /** The output on success. */
  output?: unknown;
  /** The failure on error/block. */
  error?: { code: string; message: string };
  /** Tool-vetted, user-presentable statement about a failed run (see `ToolResult.detail`). */
  detail?: string;
  /** The delegation that authorized an agent invocation (Prompt 4). */
  delegationId?: string;
  /** The policy decision this invocation was evaluated under (Prompt 5). */
  policy?: PolicyDecision;
  /** The id of this invocation (Prompt 6): lineage, audit and approvals reference it. */
  invocationId?: string;
  /** Number of attempts (1 when the first attempt succeeded). */
  attempts: number;
  /** Whether the result was verified (AI-6). */
  verified: boolean;
  /**
   * How the result was verified (present when the tool ran): the source the
   * TOOL declared (default `handler_result`), the verifier's per-rule checks
   * and the limitation of that source. Never claims a read-back the tool did
   * not declare.
   */
  verification?: LineageVerification;
  /** Whether the invocation was blocked pending approval. */
  blocked: boolean;
  /** ISO-8601 UTC completion time. */
  completedAt: string;
}

/** Options for the {@link ToolExecutor}. */
export interface ToolExecutorOptions {
  /** The registry of executable tools. */
  tools: ExecutableToolRegistry;
  /** The verifier; defaults to a {@link DefaultExecutionVerifier}. */
  verifier?: ExecutionVerifier;
  /** The retry policy; defaults to no-retry (non-idempotent tools never auto-retry). */
  retryPolicy?: RetryPolicy;
  /** The timeout policy; defaults to no timeout. */
  timeoutPolicy?: TimeoutPolicy;
  /** Receives a record of every security block (capability, forged scope, schema). */
  securitySink?: SecurityDecisionSink;
  /**
   * Decides agent authority (delegations) at execution time. Required for
   * any invocation that carries an `agent` — without it such invocations
   * fail closed.
   */
  agentAuthority?: AgentAuthorityPort;
  /**
   * Decides policy (Prompt 5). Defaults to the pure engine without resolved
   * facts; the API wires one that resolves trusted facts. A port that throws
   * makes the invocation fail closed.
   */
  policy?: PolicyPort;
  /**
   * Receives a lineage event for every invocation that actually ran
   * (Prompt 6). Best-effort and one-way: it can never change an outcome.
   */
  lineage?: LineagePort;
  /**
   * Receives per-invocation timing (Prompt 7): segments for authorization,
   * policy, execution and verification, retries, and the tool call itself.
   * Descriptive only — it can never change an outcome.
   */
  telemetry?: RunTelemetryHub;
}

/**
 * The verification detail for an executed invocation: the source comes ONLY
 * from the tool's declaration (default `handler_result`); the checks are the
 * verifier's own per-rule outcomes.
 */
function verificationOf(
  declared: ToolVerificationMetadata | undefined,
  verification: VerificationResult,
): LineageVerification {
  const meta = declared ?? DEFAULT_TOOL_VERIFICATION;
  return {
    verified: verification.verified,
    source: meta.source,
    ...(meta.limitation === undefined ? {} : { limitation: meta.limitation }),
    checks: verification.checks.map((check) => ({ ruleId: check.ruleId, passed: check.passed })),
  };
}

/** Mutable probe an invocation fills while it runs (timing only). */
interface InvocationProbe {
  authorizationMs: number;
  policyMs: number;
  verificationMs: number;
  attemptsStartMs?: number;
  retries: RetryRecord[];
}

/** Executes tools through the governed pipeline (validate → guard → invoke → verify). */
export class ToolExecutor {
  readonly #tools: ExecutableToolRegistry;
  readonly #verifier: ExecutionVerifier;
  readonly #retryPolicy: RetryPolicy;
  readonly #timeoutPolicy: TimeoutPolicy;
  readonly #arguments = new ArgumentGuard();
  readonly #securitySink?: SecurityDecisionSink;
  readonly #agentAuthority?: AgentAuthorityPort;
  readonly #policy: PolicyPort;
  readonly #lineage?: LineagePort;
  readonly #telemetry?: RunTelemetryHub;

  constructor(options: ToolExecutorOptions) {
    this.#securitySink = options.securitySink;
    this.#agentAuthority = options.agentAuthority;
    this.#policy = options.policy ?? new DefaultPolicyPort();
    this.#lineage = options.lineage;
    this.#telemetry = options.telemetry;
    this.#tools = options.tools;
    this.#verifier = options.verifier ?? new DefaultExecutionVerifier();
    this.#retryPolicy = options.retryPolicy ?? noRetryPolicy;
    this.#timeoutPolicy = options.timeoutPolicy ?? noTimeoutPolicy;
  }

  /**
   * Invokes a tool under the governed pipeline.
   *
   * @param invocation - the invocation request.
   * @param approvalGranted - whether human approval has been granted (for
   *        gated actions; BR-13).
   */
  async execute(invocation: ToolInvocation, approvalGranted = false): Promise<ToolExecutionResult> {
    const invocationId = prefixedId('inv');
    const startedAt = new Date().toISOString();
    const collector = this.#telemetry?.get(invocation.runKey ?? invocation.runId);
    const startOffsetMs = collector?.offset() ?? 0;
    const startedMs = performance.now();
    const probe: InvocationProbe = {
      authorizationMs: 0,
      policyMs: 0,
      verificationMs: 0,
      retries: [],
    };
    const result = await this.#execute(invocation, approvalGranted, probe);
    const endedMs = performance.now();
    if (collector !== undefined) {
      try {
        if (!result.ok && result.error !== undefined) {
          collector.noteError(result.error.code, invocation.toolId, invocationId);
        }
        const ran = result.attempts > 0;
        const executionMs =
          ran && probe.attemptsStartMs !== undefined
            ? Math.max(0, endedMs - probe.attemptsStartMs - probe.verificationMs)
            : 0;
        if (result.policy !== undefined && probe.policyMs >= 0) {
          collector.policy({
            policyId: result.policy.policyId,
            version: result.policy.version,
            outcome: result.policy.outcome,
            phase: 'execute',
            durationMs: Math.round(probe.policyMs * 100) / 100,
          });
        } else if (probe.policyMs > 0) {
          collector.addStage('POLICY', probe.policyMs);
        }
        const call: ToolCall | undefined = ran
          ? {
              invocationId,
              toolId: invocation.toolId,
              ...(invocation.capabilityId === undefined
                ? {}
                : { capabilityId: invocation.capabilityId }),
              origin: invocation.origin ?? 'orchestrator',
              startOffsetMs,
              durationMs: Math.round((endedMs - startedMs) * 100) / 100,
              status: result.ok
                ? 'succeeded'
                : result.error?.code === 'UNVERIFIED'
                  ? 'unverified'
                  : 'failed',
              ...(result.error === undefined ? {} : { errorCode: result.error.code }),
              attempts: result.attempts,
              retries: probe.retries,
              verified: result.verified,
              verificationMs: Math.round(probe.verificationMs * 100) / 100,
              ...(result.policy === undefined
                ? {}
                : {
                    policy: {
                      policyId: result.policy.policyId,
                      version: result.policy.version,
                      outcome: result.policy.outcome,
                    },
                  }),
              ...(result.delegationId === undefined ? {} : { delegationId: result.delegationId }),
              ...(invocation.approvalId === undefined ? {} : { approvalId: invocation.approvalId }),
              ...(invocation.lineage?.workflow === undefined
                ? {}
                : { workflow: invocation.lineage.workflow }),
            }
          : undefined;
        collector.invocation(
          {
            authorizationMs: probe.authorizationMs,
            policyMs: 0,
            executionMs,
            verificationMs: probe.verificationMs,
          },
          call,
          resultCountOf(result.output),
        );
      } catch {
        // Telemetry is descriptive and best-effort: it can never change an outcome.
      }
    }
    // Only invocations that actually ran (attempts > 0) are lineage
    // EXECUTIONS; refusals before execution are security decisions, audited
    // separately.
    if (result.attempts > 0 && this.#lineage !== undefined) {
      await this.#reportExecution(invocation, result, invocationId, startedAt);
    }
    return { ...result, invocationId };
  }

  async #reportExecution(
    invocation: ToolInvocation,
    result: ToolExecutionResult,
    invocationId: string,
    startedAt: string,
  ): Promise<void> {
    try {
      const policy: LineagePolicyRef | undefined =
        result.policy === undefined
          ? undefined
          : {
              outcome: result.policy.outcome,
              policyId: result.policy.policyId,
              version: result.policy.version,
              fingerprint: result.policy.fingerprint,
              ...(result.policy.contextFingerprint === undefined
                ? {}
                : { contextFingerprint: result.policy.contextFingerprint }),
            };
      await this.#lineage?.executed({
        tenantId: invocation.tenantId,
        ...(invocation.workspaceId === undefined ? {} : { workspaceId: invocation.workspaceId }),
        userId: invocation.userId,
        ...(invocation.agent === undefined && invocation.attribution?.agent === undefined
          ? {}
          : { agent: invocation.agent ?? invocation.attribution?.agent }),
        ...(result.delegationId === undefined && invocation.attribution?.delegationId === undefined
          ? {}
          : { delegationId: result.delegationId ?? invocation.attribution?.delegationId }),
        ...(invocation.approvalId === undefined ? {} : { approvalId: invocation.approvalId }),
        ...(invocation.approvedBy === undefined ? {} : { approvedBy: invocation.approvedBy }),
        runId: invocation.runId,
        origin: invocation.origin ?? 'orchestrator',
        invocationId,
        capabilityId: invocation.capabilityId ?? invocation.toolId,
        toolId: invocation.toolId,
        status: result.ok
          ? 'succeeded'
          : result.error?.code === 'UNVERIFIED'
            ? 'unverified'
            : 'failed',
        ...(result.error === undefined ? {} : { errorCode: result.error.code }),
        verified: result.verified,
        ...(result.verification === undefined ? {} : { verification: result.verification }),
        attempts: result.attempts,
        startedAt,
        completedAt: result.completedAt,
        inputFingerprint: fingerprintOf(invocation.input),
        ...(result.ok
          ? { outputFingerprint: fingerprintOf(result.output ?? null), output: result.output }
          : {}),
        ...(policy === undefined ? {} : { policy }),
        ...(invocation.lineage?.workflow === undefined
          ? {}
          : { workflow: invocation.lineage.workflow }),
      });
    } catch {
      // Lineage is descriptive and best-effort: it can never change an outcome.
    }
  }

  async #execute(
    invocation: ToolInvocation,
    approvalGranted: boolean,
    probe: InvocationProbe,
  ): Promise<ToolExecutionResult> {
    const tool = this.#tools.resolve(invocation.toolId);
    if (tool === undefined) {
      return this.#failure(invocation, {
        code: 'NOT_FOUND',
        message: `Tool not found: ${invocation.toolId}`,
      });
    }

    const boundCapabilityId = invocation.capabilityId ?? invocation.toolId;
    // Ceiling modes: `undefined` = explicitly unrestricted (trusted internal
    // callers only); `[]` = no authority; non-empty = only those capabilities.
    // Every server composition site that runs AS an agent supplies an explicit
    // ceiling (see ApiAgentExecutionPort / MCP context); the delegation check
    // below is the agent-specific authority and fails closed on its own.
    if (
      invocation.allowedCapabilityIds !== undefined &&
      !invocation.allowedCapabilityIds.includes(boundCapabilityId)
    ) {
      // Fail closed, before the side-effect guard even runs: a ceiling is an
      // explicit RBAC restriction — a capability outside it (or any capability
      // under an EMPTY ceiling) is never executed, approval or not (S34:
      // approval is a governance step, never a substitute for the underlying
      // permission). Only an ABSENT ceiling is unrestricted (trusted internal
      // callers); agent invocations are additionally bounded by delegations
      // below.
      await this.#audit(
        invocation,
        'CAPABILITY_NOT_PERMITTED',
        `capability ${boundCapabilityId} is outside the caller's permitted capability set`,
      );
      return this.#failure(invocation, {
        code: 'FORBIDDEN',
        message: `Your current role does not have permission to use ${boundCapabilityId}`,
      });
    }

    // Untrusted arguments: no trusted-scope/authority fields, and the tool's
    // declared schema must hold — BEFORE the approval gate, so forged or
    // malformed arguments can never even open an approval request.
    const argumentCheck = this.checkArguments(invocation.toolId, invocation.input);
    if (!argumentCheck.ok) {
      // Forged scope/authority is a security event; a merely incomplete or
      // malformed argument set is an ordinary input error (not audited).
      if (argumentCheck.code !== 'INVALID_ARGUMENTS') {
        await this.#audit(invocation, argumentCheck.code, argumentCheck.reason);
      }
      return this.#failure(invocation, {
        code: argumentCheck.code,
        message:
          argumentCheck.code === 'INVALID_ARGUMENTS'
            ? 'The action arguments are not valid for this tool'
            : argumentCheck.code === 'ARGUMENT_TOO_DEEP'
              ? 'The action arguments are nested too deeply to be safely inspected'
              : 'The request tried to set identity, scope, agent, or permission values — those come only from trusted server-side state',
      });
    }

    // Agent principal (Prompt 4): an invocation running AS an agent must be
    // covered by an active, unexpired delegation in scope — checked HERE, at
    // execution time, so a delegation revoked/expired or an agent suspended
    // after planning or approval can never execute.
    let delegationId: string | undefined;
    if (invocation.agent !== undefined) {
      const authStarted = performance.now();
      const agentCheck = await this.checkAgentAuthority(invocation);
      probe.authorizationMs += performance.now() - authStarted;
      if (!agentCheck.ok) {
        await this.#audit(invocation, agentCheck.reasonCode, agentCheck.reason);
        return this.#failure(invocation, {
          code: 'AGENT_NOT_AUTHORIZED',
          message: 'The agent is not authorized to perform this action',
        });
      }
      delegationId = agentCheck.delegationId;
    }

    // Central policy (Prompt 5): after RBAC, delegation and argument checks,
    // before the approval gate and the mutation. DENY is final — an
    // approval can never override it; REQUIRE_APPROVAL is satisfied only by
    // a recorded human approval; an unavailable policy fails closed.
    const policyStarted = performance.now();
    const evaluated = await this.evaluatePolicy(invocation, tool.manifest.sideEffectClass);
    probe.policyMs += performance.now() - policyStarted;
    if (!evaluated.ok) {
      await this.#audit(invocation, 'POLICY_UNAVAILABLE', evaluated.reason);
      return this.#failure(invocation, {
        code: 'POLICY_UNAVAILABLE',
        message: 'Policy could not be evaluated for this action; it was not executed',
      });
    }
    const policy = evaluated.decision;
    if (policy.outcome === 'DENY') {
      await this.#audit(invocation, 'POLICY_DENIED', policy.reason, policy);
      return {
        ...this.#failure(invocation, {
          code: 'POLICY_DENIED',
          message: `Policy ${policy.policyId} does not allow this action`,
        }),
        policy,
      };
    }
    if (
      approvalGranted &&
      invocation.approvedPolicy !== undefined &&
      invocation.approvedPolicy !== policy.fingerprint
    ) {
      await this.#audit(
        invocation,
        'POLICY_CHANGED_AFTER_APPROVAL',
        'the policy that governed this action changed after it was approved; it must be re-requested',
        policy,
      );
      return {
        ...this.#failure(invocation, {
          code: 'POLICY_CHANGED_AFTER_APPROVAL',
          message: 'Policy changed after this action was approved; request it again',
        }),
        policy,
      };
    }
    // A `direct_human` grant (workflow started directly by an operator, no
    // approval record) never satisfies an approval that policy requires
    // beyond the baseline side-effect gate: fail closed.
    const approvalSatisfied =
      approvalGranted &&
      (invocation.approvalBasis !== 'direct_human' ||
        (policy.approval === undefined &&
          policy.matchedRules.every(
            (rule) =>
              rule.outcome !== 'REQUIRE_APPROVAL' ||
              rule.policyId === 'POLICY_SIDE_EFFECT_APPROVAL',
          )));
    if (policy.outcome === 'REQUIRE_APPROVAL' && !approvalSatisfied) {
      return {
        ok: false,
        toolId: invocation.toolId,
        error: {
          code: 'APPROVAL_REQUIRED',
          message: policy.reason,
        },
        // The delegation that WOULD authorize the agent (recorded on the
        // approval; re-checked when the approved call executes).
        ...(delegationId === undefined ? {} : { delegationId }),
        policy,
        attempts: 0,
        verified: false,
        blocked: true,
        completedAt: new Date().toISOString(),
      };
    }

    const maxAttempts = tool.manifest.idempotent ? this.#retryPolicy.maxAttempts : 1;
    let lastError: { code: string; message: string } | undefined;
    let lastDetail: string | undefined;
    let lastVerification: LineageVerification | undefined;
    let attempts = 0;

    probe.attemptsStartMs = performance.now();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      try {
        const raw = await this.#timeoutPolicy.run(() =>
          tool.execute(invocation.input, {
            userId: invocation.userId,
            tenantId: invocation.tenantId,
            workspaceId: invocation.workspaceId,
            executionId: invocation.runId,
            // Trusted execution attribution (Prompt 4): nested executors —
            // e.g. a workflow tool — propagate the agent principal, its
            // delegation, the approval, and the origin into their own records.
            ...(invocation.agent === undefined ? {} : { agent: invocation.agent }),
            ...(delegationId === undefined ? {} : { delegationId }),
            ...(invocation.approvalId === undefined ? {} : { approvalId: invocation.approvalId }),
            ...(invocation.origin === undefined ? {} : { origin: invocation.origin }),
            // The run's RBAC ceiling — lets a nested workflow tool bound its
            // inner steps by the SAME ceiling (never widened).
            ...(invocation.allowedCapabilityIds === undefined
              ? {}
              : { allowedCapabilityIds: invocation.allowedCapabilityIds }),
          }),
        );
        const verifyStarted = performance.now();
        const verification = await this.#verifier.verify({
          ok: raw.ok,
          output: raw.output,
          error: raw.ok
            ? undefined
            : { code: 'EXECUTION_ERROR', message: raw.error ?? 'Tool failed' },
        });
        probe.verificationMs += performance.now() - verifyStarted;
        const verificationDetail = verificationOf(tool.manifest.verification, verification);
        if (raw.ok && verification.verified) {
          return {
            ok: true,
            toolId: invocation.toolId,
            ...(delegationId === undefined ? {} : { delegationId }),
            policy,
            output: raw.output,
            attempts,
            verified: true,
            verification: verificationDetail,
            blocked: false,
            completedAt: new Date().toISOString(),
          };
        }
        if (raw.ok) {
          // Unverified result: reported unverified, never done (TLR-3).
          return {
            ok: false,
            toolId: invocation.toolId,
            error: { code: 'UNVERIFIED', message: verification.message },
            policy,
            attempts,
            verified: false,
            verification: verificationDetail,
            blocked: false,
            completedAt: new Date().toISOString(),
          };
        }
        lastError = { code: 'EXECUTION_ERROR', message: raw.error ?? 'Tool failed' };
        lastDetail = raw.detail;
        // Only a tool whose OWN read-back ran and disagreed (`readBackFailed`)
        // records the source it DECLARED; an ordinary failure makes no
        // verification claim at all.
        if (raw.readBackFailed === true) {
          lastVerification = verificationDetail;
        }
        break;
      } catch (caught) {
        const error = toNexoraError(caught);
        lastError = { code: error.code, message: error.message };
        if (!tool.manifest.idempotent || !this.#retryPolicy.isRetryable(lastError)) {
          break;
        }
        if (attempt < maxAttempts) {
          const delayMs = this.#retryPolicy.delayForAttempt(attempt);
          // Only transient infrastructure faults ever reach here (`isRetryable`);
          // security denials returned before the attempt loop and never retry.
          probe.retries.push({
            attempt,
            errorCode: lastError.code,
            delayMs,
            reason: 'TRANSIENT_INFRASTRUCTURE',
          });
          await sleep(delayMs);
        }
      }
    }

    return {
      ...this.#failure(
        invocation,
        lastError ?? { code: 'EXECUTION_ERROR', message: 'Tool failed' },
        attempts,
        lastDetail,
      ),
      policy,
      ...(lastVerification === undefined ? {} : { verification: lastVerification }),
    };
  }

  /**
   * Evaluates policy for an invocation WITHOUT executing it. The
   * orchestrator calls this before opening an approval (a human is never
   * asked to approve what policy denies) and to record the decision on the
   * approval. Returns `ok: false` when the policy port throws — callers
   * must fail closed.
   */
  async evaluatePolicy(
    invocation: ToolInvocation,
    sideEffectClass?: SideEffectClass,
  ): Promise<
    | { ok: true; decision: PolicyDecision }
    | { ok: false; reasonCode: 'POLICY_UNAVAILABLE'; reason: string }
  > {
    const tool = this.#tools.resolve(invocation.toolId);
    const effect = sideEffectClass ?? tool?.manifest.sideEffectClass ?? 'consequential';
    try {
      const decision = await this.#policy.evaluate({
        organizationId: invocation.tenantId,
        ...(invocation.workspaceId === undefined ? {} : { workspaceId: invocation.workspaceId }),
        userId: invocation.userId,
        ...(invocation.agent === undefined ? {} : { agent: { agentId: invocation.agent.agentId } }),
        capabilityId: invocation.capabilityId ?? invocation.toolId,
        toolId: invocation.toolId,
        action: 'tool.execute',
        sideEffectClass: effect,
        autonomyTier: invocation.autonomyTier ?? 'supervised',
        origin: invocation.origin ?? 'orchestrator',
        input: invocation.input,
      });
      return { ok: true, decision };
    } catch {
      return {
        ok: false,
        reasonCode: 'POLICY_UNAVAILABLE',
        reason: 'the policy engine could not be evaluated',
      };
    }
  }

  /**
   * Checks untrusted arguments against a registered tool (reserved scope
   * fields + schema) WITHOUT executing it. The orchestrator calls this before
   * opening an approval so a human is never asked to approve invalid input.
   */
  checkArguments(toolId: string, input: unknown): ReturnType<ArgumentGuard['check']> {
    const tool = this.#tools.resolve(toolId);
    if (tool === undefined) {
      return { ok: false, code: 'INVALID_ARGUMENTS', reason: `unknown tool ${toolId}` };
    }
    return this.#arguments.check(toolId, tool.manifest.inputSchema, input);
  }

  /**
   * Decides whether the invocation's agent principal may exercise the
   * capability right now (no execution). The orchestrator calls this BEFORE
   * opening an approval (a human is never asked to approve an action the
   * agent is not delegated), and {@link execute} calls it again at
   * execution time. An invocation without an agent needs no delegation.
   */
  async checkAgentAuthority(
    invocation: ToolInvocation,
  ): Promise<
    | { ok: true; delegationId?: string }
    | { ok: false; reasonCode: SecurityReasonCode; reason: string }
  > {
    if (invocation.agent === undefined) {
      return { ok: true };
    }
    if (this.#agentAuthority === undefined) {
      return {
        ok: false,
        reasonCode: 'AGENT_AUTHORITY_UNAVAILABLE',
        reason: 'agent authority cannot be verified (no delegation authority is configured)',
      };
    }
    try {
      return await this.#agentAuthority.authorize({
        agent: invocation.agent,
        userId: invocation.userId,
        tenantId: invocation.tenantId,
        ...(invocation.workspaceId === undefined ? {} : { workspaceId: invocation.workspaceId }),
        capabilityId: invocation.capabilityId ?? invocation.toolId,
        toolId: invocation.toolId,
        input: invocation.input,
      });
    } catch {
      return {
        ok: false,
        reasonCode: 'AGENT_AUTHORITY_UNAVAILABLE',
        reason: 'agent authority could not be verified',
      };
    }
  }

  async #audit(
    invocation: ToolInvocation,
    reasonCode: SecurityReasonCode,
    reason: string,
    policy?: PolicyDecision,
  ): Promise<void> {
    const policyId = policy?.policyId ?? policyIdForReason(reasonCode);
    await emitSecurityDecision(this.#securitySink, {
      actorId: invocation.userId,
      ...(invocation.agent === undefined && invocation.attribution?.agent === undefined
        ? {}
        : { agentId: (invocation.agent ?? invocation.attribution?.agent)?.agentId }),
      origin: invocation.origin ?? 'orchestrator',
      invocationId: invocation.runId,
      organizationId: invocation.tenantId,
      ...(invocation.workspaceId === undefined ? {} : { workspaceId: invocation.workspaceId }),
      toolId: invocation.toolId,
      capabilityId: invocation.capabilityId ?? invocation.toolId,
      action: 'tool.execute',
      ...(policyId === undefined ? {} : { policyId }),
      ...(policy === undefined ? {} : { policyVersion: policy.version }),
      ...(policy === undefined
        ? {}
        : {
            policyRules: policy.matchedRules.map((m) => `${m.policyId}@${m.version}=${m.outcome}`),
          }),
      policyDecision: 'deny',
      reasonCode,
      reason,
      outcome: 'blocked',
      occurredAt: new Date().toISOString(),
    });
  }

  #failure(
    invocation: ToolInvocation,
    error: { code: string; message: string },
    attempts = 0,
    detail?: string,
  ): ToolExecutionResult {
    return {
      ok: false,
      toolId: invocation.toolId,
      error,
      ...(detail === undefined ? {} : { detail }),
      attempts,
      verified: false,
      blocked: false,
      completedAt: new Date().toISOString(),
    };
  }
}

/** The number of results a search-style tool output carries (retrieval telemetry), else undefined. */
function resultCountOf(output: unknown): number | undefined {
  if (output === null || typeof output !== 'object') {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  const list = record['references'] ?? record['documents'];
  return Array.isArray(list) ? list.length : undefined;
}
