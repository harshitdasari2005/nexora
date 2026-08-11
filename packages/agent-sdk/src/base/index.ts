/**
 * @nexora/agent-sdk — base agent.
 *
 * The abstract `BaseAgent`: the single execution contract every Nexora
 * agent extends (AIR.md §3). It owns identity, manifest, version,
 * lifecycle, configuration, health, metrics, registration, and capability /
 * skill / tool discovery — and knows nothing about HR, Projects, Finance,
 * or any business domain.
 *
 * Agents implement exactly two hooks: {@link BaseAgent.execute} (the core
 * work) and optionally {@link BaseAgent.shouldRequireApproval} /
 * {@link BaseAgent.checkPolicy} / {@link BaseAgent.requestApproval}.
 *
 * The execution pipeline enforces, in order: context validation, readiness,
 * concurrency, policy (deny-wins), human approval, then the work itself —
 * all before any side effect can occur (AIR.md §12-13).
 */

import type { AgentManifest, AgentIdentity } from '@nexora/contracts/ai';
import type { ConfigManager } from '@nexora/config';
import { createLogger, type Logger } from '@nexora/shared/logger';
import type { Result } from '@nexora/shared/result';

import type { ApprovalResult } from '../approval/index.js';
import { CapabilityRegistry } from '../capabilities/index.js';
import type { ExecutionContext } from '../contexts/index.js';
import { validateExecutionContext } from '../contexts/index.js';
import { AgentExecutionTimeoutError, AgentInitializationError } from '../errors/index.js';
import { AgentEventBus } from '../events/index.js';
import type { HealthSnapshot, HealthStatus } from '../health/index.js';
import { runHealthChecks } from '../health/index.js';
import type { KnowledgeProvider } from '../knowledge/index.js';
import { LifecycleStateMachine } from '../lifecycle/index.js';
import type { MemoryProvider } from '../memory/index.js';
import type { MetricsRecorder } from '../metrics/index.js';
import { InMemoryMetricsRecorder } from '../metrics/index.js';
import type {
  PolicyEvaluationContext,
  PolicyEvaluation,
  PolicyEvaluator,
} from '../policies/index.js';
import { SkillRegistry } from '../skills/index.js';
import { ToolRegistry } from '../tools/index.js';
import type { ExecutionFailure, ExecutionResult, ExecutionResultMetadata } from '../types/index.js';
import { executionErr, executionOk } from '../types/index.js';

/**
 * Agent configuration (generic; domains extend with their own schema).
 *
 * Every field is enforced by {@link BaseAgent.run}: `timeoutMs` and
 * `maxAttempts` bound the work, `memoryEnabled`/`knowledgeEnabled` gate the
 * injected providers. Plan-level caps (`maxSteps`) are a planning-strategy
 * concern, not agent config.
 */
export interface AgentConfig {
  /**
   * Maximum execution duration, in milliseconds. Default 30s. Enforced with
   * a timeout race around {@link BaseAgent.execute}; a timeout yields a
   * `TIMEOUT` failure and is **never retried** (in-flight work may still be
   * running — see below). A value `<= 0` disables the timeout. Note: an
   * abandoned execution cannot be cancelled — the timeout releases the
   * caller, in-flight work continues.
   */
  timeoutMs?: number;
  /**
   * Maximum execution attempts for *transient* (thrown) failures. Default 1.
   * Typed failures are intentional outcomes and are never retried.
   */
  maxAttempts?: number;
  /** Whether the agent may use memory (AIR.md §8). Default true. */
  memoryEnabled?: boolean;
  /** Whether the agent may query knowledge (AIR.md §9). Default true. */
  knowledgeEnabled?: boolean;
}

/** Dependencies injected into an agent at construction (composition). */
export interface AgentDependencies {
  /** The agent manifest (identity, skills, tools, policies, ...). */
  manifest: AgentManifest;
  /**
   * Optional runtime configuration; merged over the SDK defaults. Every
   * field is enforced (see {@link AgentConfig}).
   */
  config?: Partial<AgentConfig>;
  /**
   * Optional configuration manager from the Configuration Platform
   * (`@nexora/config`). The seam for reading typed platform configuration;
   * wired when the Configuration Platform lands (ROADMAP.md Phase 2).
   */
  configManager?: ConfigManager;
  /** Optional logger; defaults to a scoped structured logger. */
  logger?: Logger;
  /** Optional policy evaluator; defaults to allow-all. */
  policies?: PolicyEvaluator;
  /** Optional metrics recorder; defaults to in-memory. */
  metrics?: MetricsRecorder;
  /** Optional memory provider (AIR.md §8); the Memory Manager injects it. */
  memory?: MemoryProvider;
  /** Optional knowledge provider (AIR.md §9); the Knowledge Runtime injects it. */
  knowledge?: KnowledgeProvider;
}

/**
 * The abstract base agent. Extend this to build a concrete agent.
 *
 * @typeParam TInput  - the execution input type.
 * @typeParam TOutput - the execution output type.
 *
 * @example
 * ```ts
 * class GreeterAgent extends BaseAgent<string, string> {
 *   protected async execute(input: string): Promise<Result<string, ExecutionFailure>> {
 *     return ok(`Hello, ${input}`);
 *   }
 * }
 * ```
 */
export abstract class BaseAgent<TInput = unknown, TOutput = unknown> {
  /** The agent identity (immutable). */
  readonly identity: AgentIdentity;
  /** The agent manifest. */
  readonly manifest: AgentManifest;
  /** The agent semantic version. */
  readonly version: string;
  /** The agent lifecycle state machine. */
  readonly lifecycle: LifecycleStateMachine;
  /** The capability registry (discovery surface). */
  readonly capabilities: CapabilityRegistry;
  /** The skill registry. */
  readonly skills: SkillRegistry;
  /** The tool registry. */
  readonly tools: ToolRegistry;
  /** The agent event bus. */
  readonly events: AgentEventBus;
  /** The effective agent configuration (defaults merged over overrides). */
  readonly config: Readonly<AgentConfig>;

  readonly #logger: Logger;
  readonly #policies: PolicyEvaluator;
  readonly #metrics: MetricsRecorder;
  readonly #memory?: MemoryProvider;
  readonly #knowledge?: KnowledgeProvider;
  readonly #configManager?: ConfigManager;
  readonly #healthChecks = new Map<string, () => Promise<boolean> | boolean>();
  #healthStatus: HealthStatus = 'healthy';
  #ready = false;
  /** Synchronous concurrency guard — claimed before the first await in `run`. */
  #busy = false;

  /**
   * @param dependencies - the agent's manifest and injected dependencies.
   */
  constructor(dependencies: AgentDependencies) {
    this.manifest = dependencies.manifest;
    this.identity = dependencies.manifest.identity;
    this.version = dependencies.manifest.version;
    this.config = Object.freeze({
      timeoutMs: 30_000,
      maxAttempts: 1,
      memoryEnabled: true,
      knowledgeEnabled: true,
      ...dependencies.config,
    });
    this.lifecycle = new LifecycleStateMachine(this.identity.id);
    this.capabilities = new CapabilityRegistry();
    this.skills = new SkillRegistry();
    this.tools = new ToolRegistry();
    this.events = new AgentEventBus();
    this.#logger = dependencies.logger ?? createLogger({ service: `agent:${this.identity.name}` });
    this.#policies = dependencies.policies ?? createAllowAllEvaluator();
    this.#metrics = dependencies.metrics ?? new InMemoryMetricsRecorder();
    this.#memory = dependencies.memory;
    this.#knowledge = dependencies.knowledge;
    this.#configManager = dependencies.configManager;
    this.lifecycle.onTransition((transition) => {
      this.#logger.debug(`lifecycle: ${transition.from} → ${transition.to}`, {
        reason: transition.reason,
      });
    });
  }

  /**
   * Registers a health check probe.
   *
   * @param id    - check id, e.g. `memory`.
   * @param probe - async or sync probe returning healthy.
   */
  registerHealthCheck(id: string, probe: () => Promise<boolean> | boolean): void {
    this.#healthChecks.set(id, probe);
  }

  /**
   * Runs all registered health checks (AIR.md §16).
   */
  async health(): Promise<HealthSnapshot> {
    const snapshot = await runHealthChecks(
      [...this.#healthChecks.entries()].map(([id, probe]) => ({ id, check: probe })),
      new Date().toISOString(),
    );
    if (snapshot.status !== this.#healthStatus) {
      const previous = this.#healthStatus;
      this.#healthStatus = snapshot.status;
      this.events.publish({
        type: 'health.changed',
        agentId: this.identity.id,
        occurredAt: new Date().toISOString(),
        previous,
        current: snapshot.status,
      });
    }
    return snapshot;
  }

  /**
   * Marks the agent ready for execution. Idempotent; publishes
   * `agent.ready` once.
   */
  markReady(): void {
    if (!this.#ready) {
      this.#ready = true;
      this.lifecycle.transition('ready');
      this.events.publish({
        type: 'agent.ready',
        agentId: this.identity.id,
        occurredAt: new Date().toISOString(),
      });
    }
  }

  /**
   * The execution entry point. Enforces, in order: context validation,
   * readiness, concurrency, policy (deny-wins), approval, then the work
   * within the configured time/attempt budget. Failures are returned, never
   * thrown.
   *
   * @param input   - the execution input.
   * @param context - the execution context (scope).
   * @returns an {@link ExecutionResult}; failures are returned, not thrown.
   */
  async run(input: TInput, context: ExecutionContext): Promise<ExecutionResult<TOutput>> {
    const issues = validateExecutionContext(context);
    if (issues.length > 0) {
      return executionErr('VALIDATION_ERROR', issues.map((issue) => issue.message).join('; '), {
        executionId: context.executionId,
        agentId: this.identity.id,
        startedAt: context.startedAt,
        requiredApproval: false,
      });
    }
    if (!this.#ready) {
      return executionErr('AGENT_NOT_READY', 'Agent is not ready for execution', {
        executionId: context.executionId,
        agentId: this.identity.id,
        startedAt: context.startedAt,
        requiredApproval: false,
      });
    }
    // Both gates are synchronous — no await precedes them, so concurrent
    // calls cannot interleave past this point (TOCTOU-safe).
    if (!this.lifecycle.isReady || this.#busy) {
      return executionErr('AGENT_BUSY', `Agent is ${this.lifecycle.state}`, {
        executionId: context.executionId,
        agentId: this.identity.id,
        startedAt: context.startedAt,
        requiredApproval: false,
      });
    }
    this.#busy = true;
    try {
      return await this.#runGuarded(input, context);
    } finally {
      this.#busy = false;
    }
  }

  /**
   * The guarded execution body — runs only after the synchronous gates in
   * {@link BaseAgent.run}. All awaits happen here, under the `#busy` guard.
   */
  /**
   * The guarded execution body — runs only after the synchronous gates in
   * {@link BaseAgent.run}. All awaits happen here, under the `#busy` guard.
   *
   * Any exception escaping the gates (an injected policy evaluator or an
   * approval hook throwing, e.g. on an engine outage) is converted into an
   * `INTERNAL_ERROR` failure — `run` never throws, honoring the
   * failures-are-values contract.
   */
  async #runGuarded(input: TInput, context: ExecutionContext): Promise<ExecutionResult<TOutput>> {
    try {
      return await this.#runCore(input, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.error('agent execution gate threw', error);
      this.#metrics.recordExecution({
        executionsStarted: 1,
        executionsSucceeded: 0,
        executionsFailed: 1,
      });
      this.#publishFailure(context, 'INTERNAL_ERROR', message);
      return executionErr('INTERNAL_ERROR', message, {
        executionId: context.executionId,
        agentId: this.identity.id,
        startedAt: context.startedAt,
        requiredApproval: false,
      });
    }
  }

  /** The core execution body: policy gate → approval gate → work. */
  async #runCore(input: TInput, context: ExecutionContext): Promise<ExecutionResult<TOutput>> {
    const metadata: ExecutionResultMetadata = {
      executionId: context.executionId,
      agentId: this.identity.id,
      startedAt: context.startedAt,
      requiredApproval: false,
    };

    // 1. Policy gate (AIR.md §13): deny-wins, before any side effect. The
    // manifest's `policyIds` become the requirements the evaluator checks.
    const policy = await this.checkPolicy({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      action: 'agent.execute',
      actor: `agent:${this.identity.id}`,
      requirements: this.manifest.policyIds.map((policyId) => ({
        policyId,
        description: `Policy ${policyId} applies to agent executions`,
      })),
    });
    if (!policy.allowed) {
      const message = `Execution denied by policy ${policy.deniedBy ?? 'unknown'}`;
      this.#metrics.recordExecution({
        executionsStarted: 1,
        executionsSucceeded: 0,
        executionsFailed: 1,
      });
      this.#publishFailure(context, 'POLICY_VIOLATION', message);
      return executionErr('POLICY_VIOLATION', message, metadata);
    }

    // 2. Approval gate (AIR.md §12): human always in control.
    const requiredApproval = await this.shouldRequireApproval(input, context);
    metadata.requiredApproval = requiredApproval;
    if (requiredApproval) {
      const approval = await this.requestApproval(input, context);
      metadata.approvalGranted = approval.granted;
      if (!approval.granted) {
        this.#metrics.recordExecution({
          executionsStarted: 1,
          executionsSucceeded: 0,
          executionsFailed: 1,
        });
        this.#metrics.recordUsage({
          toolInvocations: 0,
          knowledgeRetrievals: 0,
          approvalsRequested: 1,
        });
        return executionErr('APPROVAL_REJECTED', 'The execution was not approved', metadata);
      }
    }

    this.lifecycle.transition('executing');
    this.events.publish({
      type: 'execution.started',
      agentId: this.identity.id,
      executionId: context.executionId,
      occurredAt: new Date().toISOString(),
    });
    this.#metrics.recordExecution({
      executionsStarted: 1,
      executionsSucceeded: 0,
      executionsFailed: 0,
    });
    this.#metrics.recordUsage({
      toolInvocations: 0,
      knowledgeRetrievals: 0,
      approvalsRequested: requiredApproval ? 1 : 0,
    });

    // 3. The work itself, within the configured budget. Typed failures are
    // intentional and never retried; thrown (transient) failures retry up to
    // `maxAttempts`.
    const startedAtMs = Date.now();
    const maxAttempts = Math.max(1, this.config.maxAttempts ?? 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.#executeWithTimeout(input, context);
        this.#metrics.recordLatency(Date.now() - startedAtMs);

        if (result.ok) {
          metadata.finishedAt = new Date().toISOString();
          this.#metrics.recordExecution({
            executionsStarted: 0,
            executionsSucceeded: 1,
            executionsFailed: 0,
          });
          this.lifecycle.transition('ready');
          this.events.publish({
            type: 'execution.completed',
            agentId: this.identity.id,
            executionId: context.executionId,
            occurredAt: new Date().toISOString(),
            finishedAt: metadata.finishedAt,
          });
          return executionOk(result.value, metadata);
        }

        metadata.finishedAt = new Date().toISOString();
        this.#metrics.recordExecution({
          executionsStarted: 0,
          executionsSucceeded: 0,
          executionsFailed: 1,
        });
        this.lifecycle.transition('ready');
        this.#publishFailure(context, result.error.code, result.error.message);
        return executionErr(result.error.code, result.error.message, metadata);
      } catch (error) {
        lastError = error;
        this.#metrics.recordLatency(Date.now() - startedAtMs);
        if (error instanceof AgentExecutionTimeoutError) {
          // A timed-out execution may still be in flight (non-cancellable);
          // retrying would risk duplicate side effects — fail immediately.
          break;
        }
        if (attempt < maxAttempts) {
          this.#logger.warn(
            `agent execution attempt ${attempt} of ${maxAttempts} threw; retrying`,
            error,
          );
        }
      }
    }

    // Attempts exhausted — only transient failures reach this point.
    const timedOut = lastError instanceof AgentExecutionTimeoutError;
    const code = timedOut ? 'TIMEOUT' : 'INTERNAL_ERROR';
    const message = timedOut
      ? 'The execution timed out'
      : lastError instanceof Error
        ? lastError.message
        : String(lastError);
    metadata.finishedAt = new Date().toISOString();
    this.#metrics.recordExecution({
      executionsStarted: 0,
      executionsSucceeded: 0,
      executionsFailed: 1,
    });
    this.#logger.error('agent execution failed after retries', lastError);
    this.#publishFailure(context, code, message);
    if (this.lifecycle.canTransition('ready')) {
      this.lifecycle.transition('ready');
    }
    return executionErr(code, message, metadata);
  }

  /**
   * Runs {@link BaseAgent.execute} against the configured timeout. The work
   * is normalized to never reject, so an abandoned execution after a timeout
   * cannot produce an unhandled rejection.
   */
  async #executeWithTimeout(
    input: TInput,
    context: ExecutionContext,
  ): Promise<Result<TOutput, ExecutionFailure>> {
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const work = this.execute(input, context).then(
      (result) => ({ settled: 'result' as const, result }),
      (error: unknown) => ({ settled: 'error' as const, error }),
    );
    if (timeoutMs <= 0) {
      const outcome = await work;
      return outcome.settled === 'result' ? outcome.result : Promise.reject(outcome.error);
    }
    let handle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ settled: 'timeout' }>((resolve) => {
      handle = setTimeout(() => resolve({ settled: 'timeout' }), timeoutMs);
    });
    try {
      const outcome = await Promise.race([work, timeout]);
      if (outcome.settled === 'timeout') {
        throw new AgentExecutionTimeoutError(`Agent execution exceeded ${timeoutMs}ms`);
      }
      if (outcome.settled === 'error') {
        throw outcome.error;
      }
      return outcome.result;
    } finally {
      if (handle !== undefined) {
        clearTimeout(handle);
      }
    }
  }

  /** Publishes an `execution.failed` event. */
  #publishFailure(context: ExecutionContext, code: string, message: string): void {
    this.events.publish({
      type: 'execution.failed',
      agentId: this.identity.id,
      executionId: context.executionId,
      occurredAt: new Date().toISOString(),
      code,
      message,
    });
  }

  /**
   * Decides whether the execution requires human approval (AIR.md §12).
   * Default: false. Override to consult skills' `requiresApproval` flags,
   * side-effect classes, or domain rules.
   */
  protected async shouldRequireApproval(
    _input: TInput,
    _context: ExecutionContext,
  ): Promise<boolean> {
    return false;
  }

  /**
   * Requests human approval for a consequential execution. Default: granted
   * (no-op) — override to raise an {@link ApprovalRequestBuilder} request
   * through the platform.
   */
  protected async requestApproval(
    _input: TInput,
    _context: ExecutionContext,
  ): Promise<ApprovalResult> {
    return { granted: true };
  }

  /**
   * Evaluates the execution against configured policies (AIR.md §13).
   * Invoked by {@link BaseAgent.run} before approval or any side effect; a
   * denied evaluation fails the execution with `POLICY_VIOLATION`. Default:
   * delegates to the injected {@link PolicyEvaluator}. Override to consult
   * domain policies.
   */
  protected async checkPolicy(context: PolicyEvaluationContext): Promise<PolicyEvaluation> {
    return this.#policies.evaluate(context);
  }

  /**
   * The core execution hook — the only method concrete agents must
   * implement. Perform the work and return a `Result`; throw only for truly
   * unexpected (transient) failures, which are retried per `maxAttempts`.
   */
  protected abstract execute(
    input: TInput,
    context: ExecutionContext,
  ): Promise<Result<TOutput, ExecutionFailure>>;

  /** The metrics recorder (for reporting by domains). */
  protected get metrics(): MetricsRecorder {
    return this.#metrics;
  }

  /** The memory provider (AIR.md §8), when injected and enabled. */
  protected get memory(): MemoryProvider | undefined {
    return this.config.memoryEnabled ? this.#memory : undefined;
  }

  /** The knowledge provider (AIR.md §9), when injected and enabled. */
  protected get knowledge(): KnowledgeProvider | undefined {
    return this.config.knowledgeEnabled ? this.#knowledge : undefined;
  }

  /** The configuration manager (Configuration Platform seam), when injected. */
  protected get configManager(): ConfigManager | undefined {
    return this.#configManager;
  }

  /** The scoped logger (for reporting by domains). */
  protected get logger(): Logger {
    return this.#logger;
  }
}

/**
 * The default policy evaluator: allow everything (used when no policy
 * evaluator is injected). Agents override `checkPolicy` for real policy
 * enforcement (AIR.md §13).
 */
function createAllowAllEvaluator(): PolicyEvaluator {
  return {
    name: 'allow-all',
    evaluate: async (): Promise<PolicyEvaluation> => ({ allowed: true, decisions: [] }),
  };
}

/** Validates the manifest's minimum integrity at construction time. */
export function assertValidManifest(manifest: AgentManifest): void {
  if (manifest.identity.id.length === 0) {
    throw new AgentInitializationError('Agent identity id must not be empty');
  }
  if (manifest.version.length === 0) {
    throw new AgentInitializationError('Agent version must not be empty');
  }
}
