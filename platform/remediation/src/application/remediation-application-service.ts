/**
 * @nexora/module-remediation — RemediationApplicationService (Phase 10).
 *
 * The GENERIC remediation surface: from a detected problem with an
 * applicable known solution, the engine derives a DYNAMIC plan (one step
 * per required capability, bounded), VALIDATES it server-side (capability
 * membership, tool availability, dependencies, scope, fresh problem state,
 * fresh solution applicability), ROUTES approvals (who should approve —
 * derived from capability policy, never the client), and EXECUTES one step
 * at a time through the EXISTING governed execution path
 * ({@link RemediationExecutionPort} → AI Runtime → ToolExecutor →
 * ApprovalEngine → verification → decision records → journal). After every
 * step the engine RE-EVALUATES the problem deterministically and decides:
 * next step / replan / complete / stop. Bounds (steps, replans, duration)
 * are explicit — the plan never loops autonomously.
 *
 * Security contract (Phase 10): the engine resolves tenant/workspace/role/
 * capability/approver from the trusted context + ports ONLY. A forged plan/
 * problem/step id resolves to nothing; a step whose capability is outside
 * the caller's CURRENT agent set is rejected before execution; approval
 * decisions are recorded through the existing ApprovalEngine and never
 * influenced by the request. The client is authoritative for NOTHING.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type {
  ActionProposal,
  AgentExecutionIntent,
  AgentExecutionOutcome,
} from '@nexora/contracts/agent';
import type { BusinessProblemDto, SolutionCandidateDto } from '@nexora/contracts/detection';
import type {
  AdvanceRemediationPlanResult,
  CancelRemediationPlanResult,
  CreateRemediationPlanRequest,
  CreateRemediationPlanResult,
  RemediationPlanDto,
  RemediationPlanRecord,
  ReplanRemediationPlanResult,
} from '@nexora/contracts/remediation';

import { PlanStep, RemediationPlan } from '../domain/plan.js';
import type { ApprovalRoutingPolicy } from './approval-routing.js';
import { PlanBuilder, stepToDto } from './plan-builder.js';
import type { PlanStore } from './plan-store.js';
import type {
  RemediationAgent,
  RemediationAgentResolver,
  RemediationApprovalEngine,
  RemediationCapabilityProvider,
  RemediationContext,
  RemediationExecutionPort,
  RemediationExecutionRecorder,
  RemediationProblemLifecyclePort,
  RemediationProblemProvider,
  RemediationProblemReevaluator,
} from './remediation-ports.js';

/** The maximum number of re-plans (explicit bound — stop + human after). */
export const MAX_REPLANS = 3;

/** The maximum plan duration (explicit bound). */
export const MAX_PLAN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** The maximum number of plans returned per list (bounded). */
export const PLANS_LIMIT = 20;

/** Dependencies of the remediation application service. */
export interface RemediationApplicationServiceDependencies {
  /** The durable plan store (+ atomic step claim). */
  store: PlanStore;
  /** Resolves the caller's agent from trusted membership. */
  agentResolver: RemediationAgentResolver;
  /** Loads problem investigations (tenant-scoped). */
  problemProvider: RemediationProblemProvider;
  /** Re-evaluates a problem deterministically (post-step + final). */
  reevaluator: RemediationProblemReevaluator;
  /** Transitions the problem lifecycle (deterministic table). */
  lifecycle: RemediationProblemLifecyclePort;
  /** Resolves capability metadata (side-effect class + tool). */
  capabilities: RemediationCapabilityProvider;
  /** The approval routing policy (who should approve). */
  routing: ApprovalRoutingPolicy;
  /** The EXISTING approval engine (gate + dedupe; decisions via its surface). */
  approvals: RemediationApprovalEngine;
  /** The EXISTING governed execution path (one engine). */
  execution?: RemediationExecutionPort;
  /** The EXISTING execution journal (one journal, plan-linked records). */
  recorder?: RemediationExecutionRecorder;
}

/** The generic remediation application service. */
export class RemediationApplicationService {
  readonly #store: PlanStore;
  readonly #agentResolver: RemediationAgentResolver;
  readonly #problemProvider: RemediationProblemProvider;
  readonly #reevaluator: RemediationProblemReevaluator;
  readonly #lifecycle: RemediationProblemLifecyclePort;
  readonly #capabilities: RemediationCapabilityProvider;
  readonly #routing: ApprovalRoutingPolicy;
  readonly #approvals: RemediationApprovalEngine;
  readonly #execution?: RemediationExecutionPort;
  readonly #recorder?: RemediationExecutionRecorder;
  readonly #builder = new PlanBuilder();

  constructor(dependencies: RemediationApplicationServiceDependencies) {
    this.#store = dependencies.store;
    this.#agentResolver = dependencies.agentResolver;
    this.#problemProvider = dependencies.problemProvider;
    this.#reevaluator = dependencies.reevaluator;
    this.#lifecycle = dependencies.lifecycle;
    this.#capabilities = dependencies.capabilities;
    this.#routing = dependencies.routing;
    this.#approvals = dependencies.approvals;
    this.#execution = dependencies.execution;
    this.#recorder = dependencies.recorder;
  }

  /**
   * Creates a remediation plan for a problem: known solution → dynamic plan
   * → server validation → VALIDATED (AWAITING_APPROVAL / READY) or BLOCKED
   * with an explicit reason. Idempotent per problem: while an active plan
   * exists, creating another returns the existing plan (duplicate-plan
   * protection, Phase 10 §18). A forged problem/solution id resolves to an
   * explicit failure — never a plan for someone else's problem.
   */
  async createPlan(
    context: RemediationContext,
    request: CreateRemediationPlanRequest,
  ): Promise<CreateRemediationPlanResult> {
    const agent = await this.#agentResolver.resolve(context);
    if (agent === undefined) {
      return { ok: false, reason: 'no-agent' };
    }
    const problem = await this.#problemProvider.getById(context, request.problemId);
    if (problem === undefined) {
      return { ok: false, reason: 'no-problem' };
    }
    if (problem.status === 'RESOLVED') {
      return { ok: false, reason: 'problem-resolved' };
    }

    // The grounding solution: the client may only pick among the problem's
    // OWN applicable candidates — anything else (forged id) resolves to
    // no-solution BEFORE any plan is returned (fail closed).
    const solution = this.#selectSolution(problem, request.solutionId);
    if (solution === undefined) {
      return { ok: false, reason: 'no-solution' };
    }

    // Duplicate-plan protection: one active plan per problem.
    const existing = await this.#store.listPlansByProblem({
      tenantId: context.tenantId,
      problemId: problem.id,
      limit: 1,
    });
    const active = existing.find((plan) => !RemediationPlan.hydrate(plan).isTerminal());
    if (active !== undefined) {
      const steps = (await this.#store.listSteps(active.id)).map((record) =>
        PlanStep.hydrate(record),
      );
      return { ok: true, plan: await this.#toDto(context, active, steps) };
    }

    const now = nowIso();
    const plan = RemediationPlan.create({
      id: prefixedId('rpl'),
      problemId: problem.id,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      agentId: agent.id,
      roleId: agent.roleId,
      title: `Remediate: ${problem.title}`,
      objective: solution.title,
      groundedSolutionId: solution.id,
      createdAt: now,
    });

    const blueprint = await this.#builder.build({
      planId: plan.id,
      agent,
      solution,
      remediationCapabilities: problem.remediationCapabilities,
      capabilities: this.#capabilities,
      routing: this.#routing,
    });

    await this.#store.savePlan(plan.record());
    const steps: PlanStep[] = [];
    for (const step of blueprint.steps) {
      await this.#store.saveStep(step.record());
      steps.push(step);
    }

    if (!blueprint.ok) {
      // The server validated the plan and determined it CANNOT execute:
      // BLOCKED + explicit reason (never executable because it was derived).
      plan.transitionTo('BLOCKED', now);
      plan.setReason(blueprint.reason, now);
      await this.#store.savePlan(plan.record());
      await this.#lifecycle.transition(context, problem.id, 'REMEDIATION_BLOCKED', now);
      return { ok: true, plan: await this.#toDto(context, plan.record(), steps) };
    }

    // Server validation passed → VALIDATED; approval routing decides the
    // initial executable status.
    plan.transitionTo('VALIDATED', now);
    const anyApproval = steps.some((step) => step.approvalRequirement === 'REQUIRED');
    plan.transitionTo(anyApproval ? 'AWAITING_APPROVAL' : 'READY', now);
    await this.#store.savePlan(plan.record());
    await this.#lifecycle.transition(context, problem.id, 'REMEDIATION_PLANNED', now);
    return { ok: true, plan: await this.#toDto(context, plan.record(), steps) };
  }

  /**

  /**
   * Advances the plan: executes the next step (one at a time) through the
   * EXISTING governed execution path, verifies it, re-evaluates the
   * problem, and decides next step / replan / complete / stop. A duplicate
   * or concurrent advance can never execute the same step twice (atomic
   * claim + approval claim). Approval-required steps open ONE approval
   * (dedupe by resume key) and wait for the decision through the EXISTING
   * approval surface.
   */
  async advance(
    context: RemediationContext,
    planId: string,
  ): Promise<AdvanceRemediationPlanResult> {
    const plan = await this.#loadPlan(context, planId);
    if (plan === undefined) {
      return { ok: false, reason: 'no-plan' };
    }
    if (!plan.isExecutable()) {
      return { ok: false, reason: 'not-runnable' };
    }
    const agent = await this.#agentResolver.resolve(context);
    if (agent === undefined) {
      return { ok: false, reason: 'no-agent' };
    }
    if (this.#execution === undefined) {
      return { ok: false, reason: 'not-configured' };
    }

    // Explicit duration bound — the plan never runs forever.
    if (Date.parse(plan.createdAt) + MAX_PLAN_DURATION_MS < Date.now()) {
      plan.transitionTo('FAILED', nowIso());
      plan.setReason(
        'The plan exceeded its maximum duration and requires human intervention.',
        nowIso(),
      );
      await this.#store.savePlan(plan.record());
      return {
        ok: true,
        plan: await this.#toDto(context, plan.record(), []),
        stepId: plan.problemId,
      };
    }

    const steps = (await this.#store.listSteps(plan.id)).map((record) => PlanStep.hydrate(record));
    const step = this.#nextStep(plan, steps);
    if (step === undefined) {
      return this.#finishOrReplan(context, plan, steps);
    }

    // Stale-state guard: before executing, re-evaluate the problem — if the
    // grounding solution is no longer applicable (observed state changed),
    // the original plan is invalidated → REPLANNING (Phase 10 §8).
    const fresh = await this.#reevaluator.reevaluate(context, plan.problemId);
    if (fresh !== undefined && !this.#groundingStillApplicable(plan, fresh.problem)) {
      const replanned = await this.#replanInternal(
        context,
        plan,
        'The observed state changed — the grounding solution no longer applies.',
      );
      if (!replanned.ok) {
        const now = nowIso();
        plan.transitionTo('FAILED', now);
        plan.setReason(replanned.reason, now);
        await this.#store.savePlan(plan.record());
        await this.#lifecycle.transition(context, plan.problemId, 'REMEDIATION_FAILED', now);
        return {
          ok: true,
          plan: await this.#toDto(context, plan.record(), steps),
          stepId: step.id,
        };
      }
      return { ok: true, plan: replanned.plan, stepId: step.id };
    }

    // Fail closed: the step's capability must be in the caller's CURRENT
    // agent set BEFORE any approval is opened or acted on — a caller whose
    // effective agent changed can never escalate or even open an approval
    // beyond it.
    if (!agent.capabilityIds.includes(step.capabilityId)) {
      return { ok: false, reason: 'capability-escalation' };
    }

    // Approval-required step: open ONE approval (dedupe by resume key) and
    // wait for the decision through the EXISTING approval surface.
    if (step.approvalRequirement === 'REQUIRED' && step.approvalId === undefined) {
      const approval = await this.#openApproval(context, plan, step);
      step.markAwaitingApproval(approval.id, nowIso());
      await this.#store.saveStep(step.record());
      if (plan.status !== 'AWAITING_APPROVAL') {
        plan.transitionTo('AWAITING_APPROVAL', nowIso());
      }
      await this.#store.savePlan(plan.record());
      return { ok: true, plan: await this.#toDto(context, plan.record(), steps), stepId: step.id };
    }

    // Awaiting approval: re-check the recorded decision (never the request).
    if (step.status === 'AWAITING_APPROVAL' && step.approvalId !== undefined) {
      const decision = await this.#approvals.decisionStatus(step.approvalId);
      if (decision === 'pending') {
        if (plan.status !== 'AWAITING_APPROVAL') {
          plan.transitionTo('AWAITING_APPROVAL', nowIso());
        }
        await this.#store.savePlan(plan.record());
        return {
          ok: true,
          plan: await this.#toDto(context, plan.record(), steps),
          stepId: step.id,
        };
      }
      if (decision === 'rejected') {
        step.transitionTo('FAILED', nowIso());
        step.recordResult(
          { evidence: ['The approval was rejected — the step never executed.'] },
          nowIso(),
        );
        await this.#store.saveStep(step.record());
        plan.transitionTo('FAILED', nowIso());
        plan.setReason('A required approval was rejected — remediation stopped.', nowIso());
        await this.#store.savePlan(plan.record());
        return {
          ok: true,
          plan: await this.#toDto(context, plan.record(), steps),
          stepId: step.id,
        };
      }
      // granted → fall through to claim + execute.
    }

    // Atomic claim (exactly-once): a duplicate/concurrent advance of this
    // step can never claim it twice.
    const claimed = await this.#store.claimStep(plan.id, step.id);
    if (claimed === undefined) {
      return { ok: false, reason: 'not-runnable' };
    }
    // A multi-step plan without an inter-step approval is already
    // EXECUTING from the previous step's advance — transitioning to the
    // SAME state is not a legal move (the transition table has no
    // self-loop), so only transition when the plan isn't there yet.
    if (plan.status !== 'EXECUTING') {
      plan.transitionTo('EXECUTING', nowIso());
      await this.#store.savePlan(plan.record());
    }

    const outcome = await this.#executeStep(context, plan, claimed, agent);

    // The step succeeded only when the governed execution COMPLETED and its
    // result was VERIFIED — never "successful" because a tool returned ok.
    const completed =
      outcome.status === 'completed' && outcome.steps.every((s) => s.status === 'succeeded');
    if (completed) {
      claimed.transitionTo('VERIFIED', nowIso());
      claimed.recordResult(
        {
          result: { runId: outcome.runId, steps: outcome.steps },
          evidence: [outcome.response.slice(0, 500)],
        },
        nowIso(),
      );
      await this.#store.saveStep(claimed.record());
    } else {
      claimed.transitionTo('FAILED', nowIso());
      claimed.recordResult(
        { evidence: [`Execution ${outcome.status}: ${outcome.response.slice(0, 300)}`] },
        nowIso(),
      );
      await this.#store.saveStep(claimed.record());
    }

    // Reload AFTER the result is persisted — the DTO and the next-step
    // decision must see the step's real state, never a stale RUNNING.
    const executed = (await this.#store.listSteps(plan.id)).map((record) =>
      PlanStep.hydrate(record),
    );

    // RE-EVALUATE the problem after the step (deterministic) and decide.
    const reevaluation = await this.#reevaluator.reevaluate(context, plan.problemId);
    if (reevaluation === undefined) {
      plan.transitionTo('FAILED', nowIso());
      plan.setReason(
        'The problem record could no longer be resolved — remediation stopped.',
        nowIso(),
      );
      await this.#store.savePlan(plan.record());
      return {
        ok: true,
        plan: await this.#toDto(context, plan.record(), executed),
        stepId: claimed.id,
        outcome,
      };
    }

    if (reevaluation.stillPresent === false) {
      // The condition is gone — honest resolution through the deterministic
      // re-evaluation, not a tool's success claim.
      return this.#complete(
        context,
        plan,
        executed,
        reevaluation.problem,
        'The condition was re-evaluated and is no longer present.',
      );
    }

    if (!completed) {
      // A failed step never blindly continues: re-plan (bounded) or stop.
      return this.#replanAfterFailure(context, plan, executed, outcome);
    }

    // Step verified + condition still present → the next advance runs the
    // next step (sequential, one at a time).
    const next = this.#nextStep(plan, executed);
    if (next === undefined) {
      // All steps executed but the condition persists: the known solution
      // was insufficient — re-plan (bounded) or stop for human review.
      return this.#replanAfterFailure(context, plan, executed, outcome);
    }
    // The plan is waiting on the next step's approval when it requires one
    // (approval opened on the next advance); otherwise it stays executable.
    if (next.approvalRequirement === 'REQUIRED' && next.approvalId === undefined) {
      if (plan.status !== 'AWAITING_APPROVAL') {
        plan.transitionTo('AWAITING_APPROVAL', nowIso());
      }
    }
    await this.#store.savePlan(plan.record());
    return {
      ok: true,
      plan: await this.#toDto(context, plan.record(), executed),
      stepId: claimed.id,
      outcome,
    };
  }

  /**
   * Re-plans a plan explicitly (user/UI) or internally: re-derives the plan
   * from the CURRENT problem state (fresh solutions, fresh applicability)
   * into a new DRAFT version. Bounded by {@link MAX_REPLANS} — beyond it the
   * plan stops and requires human intervention.
   */
  async replan(context: RemediationContext, planId: string): Promise<ReplanRemediationPlanResult> {
    const plan = await this.#loadPlan(context, planId);
    if (plan === undefined) {
      return { ok: false, reason: 'no-plan' };
    }
    if (plan.isTerminal()) {
      return { ok: false, reason: 'not-replannable' };
    }
    if (plan.replanCount >= MAX_REPLANS) {
      return { ok: false, reason: 'replan-limit' };
    }
    const replanned = await this.#replanInternal(context, plan);
    if (!replanned.ok) {
      // Internal reasons beyond the public vocabulary map to the honest
      // "cannot replan right now" (the plan is not in a replannable state).
      return {
        ok: false,
        reason: replanned.reason === 'replan-limit' ? 'replan-limit' : 'not-replannable',
      };
    }
    return { ok: true, plan: replanned.plan };
  }

  /** Cancels a plan (human decision): the problem stays open, remediation stops. */
  async cancel(context: RemediationContext, planId: string): Promise<CancelRemediationPlanResult> {
    const plan = await this.#loadPlan(context, planId);
    if (plan === undefined) {
      return { ok: false, reason: 'no-plan' };
    }
    if (plan.isTerminal()) {
      return { ok: false, reason: 'not-cancellable' };
    }
    const now = nowIso();
    plan.transitionTo('CANCELLED', now);
    plan.setReason('The remediation plan was cancelled.', now);
    await this.#store.savePlan(plan.record());
    // The problem is NOT resolved — remediation stopped; the problem is
    // marked blocked (owned by the plan engine, never auto-resolved).
    await this.#lifecycle.transition(context, plan.problemId, 'REMEDIATION_BLOCKED', now);
    return { ok: true, plan: await this.#toDto(context, plan.record(), []) };
  }

  /** Lists the scope's plans (bounded, newest first) with their problems. */
  async list(context: RemediationContext): Promise<readonly RemediationPlanDto[]> {
    const plans = await this.#store.listPlans({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      limit: PLANS_LIMIT,
    });
    if (plans.length === 0) {
      return [];
    }
    const problems = await this.#problemProvider.listByIds(
      context,
      plans.map((plan) => plan.problemId),
    );
    const problemById = new Map(problems.map((problem) => [problem.id, problem]));
    const result: RemediationPlanDto[] = [];
    for (const plan of plans) {
      const steps = (await this.#store.listSteps(plan.id)).map((record) =>
        PlanStep.hydrate(record),
      );
      result.push(this.#compose(plan, steps, problemById.get(plan.problemId)));
    }
    return result;
  }

  /** Resolves one plan by id (tenant-scoped; forged ids resolve to nothing). */
  async getById(
    context: RemediationContext,
    planId: string,
  ): Promise<RemediationPlanDto | undefined> {
    const plan = await this.#loadPlan(context, planId);
    if (plan === undefined) {
      return undefined;
    }
    const steps = (await this.#store.listSteps(plan.id)).map((record) => PlanStep.hydrate(record));
    return this.#toDto(context, plan.record(), steps);
  }

  // --- internals -----------------------------------------------------------

  /** Loads a plan within the trusted tenant scope. */
  async #loadPlan(
    context: RemediationContext,
    planId: string,
  ): Promise<RemediationPlan | undefined> {
    const record = await this.#store.findPlanById(context.tenantId, planId);
    return record === undefined ? undefined : RemediationPlan.hydrate(record);
  }

  /** Selects the grounding solution (client choice bounded to the problem's own). */
  #selectSolution(
    problem: BusinessProblemDto,
    solutionId: string | undefined,
  ): SolutionCandidateDto | undefined {
    const applicable = problem.solutions.filter(
      (solution) => solution.applicability === 'APPLICABLE',
    );
    return solutionId === undefined
      ? applicable[0]
      : applicable.find((solution) => solution.id === solutionId);
  }

  /** The next runnable step (first PENDING/AWAITING_APPROVAL with deps met). */
  #nextStep(plan: RemediationPlan, steps: readonly PlanStep[]): PlanStep | undefined {
    const verified = new Set(
      steps.filter((step) => step.status === 'VERIFIED').map((step) => step.id),
    );
    return steps.find((step) => {
      if (step.status !== 'PENDING' && step.status !== 'AWAITING_APPROVAL') {
        return false;
      }
      return step.snapshot().dependencies.every((id) => verified.has(id));
    });
  }

  /** Whether the plan's grounding solution is still applicable in a fresh DTO. */
  #groundingStillApplicable(plan: RemediationPlan, fresh: BusinessProblemDto): boolean {
    if (plan.groundedSolutionId === undefined) {
      return true;
    }
    const grounding = fresh.solutions.find((solution) => solution.id === plan.groundedSolutionId);
    return grounding !== undefined && grounding.applicability === 'APPLICABLE';
  }

  /** Opens (or resumes) the ONE approval for a step — dedupe by resume key. */
  async #openApproval(
    context: RemediationContext,
    plan: RemediationPlan,
    step: PlanStep,
  ): Promise<{ id: string }> {
    const resumeKey = `remediation:plan:${plan.id}:step:${step.id}`;
    const capability = await this.#capabilities.resolve(step.capabilityId);
    const sideEffectClass = capability?.sideEffectClass ?? 'state_change';
    const approval = await this.#approvals.open({
      conversationId: `remediation:${plan.id}`,
      userId: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      runId: plan.id,
      stepId: step.id,
      toolId: capability?.toolId ?? step.capabilityId,
      capabilityId: step.capabilityId,
      sideEffectClass,
      reason: `Step ${step.sequence} of remediation plan ${plan.id}: ${step.snapshot().action}`,
      intent: `${step.snapshot().action}: ${step.snapshot().rationale}`,
      input: {},
      resumeKey,
    });
    return approval;
  }

  /** Executes ONE step through the EXISTING governed execution path. */
  async #executeStep(
    context: RemediationContext,
    plan: RemediationPlan,
    step: PlanStep,
    agent: RemediationAgent,
  ): Promise<AgentExecutionOutcome> {
    const snapshot = step.snapshot();
    const proposal: ActionProposal = {
      id: `propose_${step.id.slice(-12)}`,
      action: snapshot.action,
      reason: snapshot.rationale,
      requiredCapability: snapshot.capabilityId,
      requiresApproval: snapshot.approvalRequirement === 'REQUIRED',
      expectedResult:
        'The step executes through the governed pipeline and the problem is re-evaluated.',
      targetSystem: 'nexora',
    };
    const intent: AgentExecutionIntent = {
      agentId: plan.snapshot().agentId,
      roleId: plan.snapshot().roleId,
      domainId: agent.domainId,
      proposal,
      utterance: `${snapshot.action}. ${snapshot.rationale}`,
      allowedCapabilityIds: [snapshot.capabilityId],
      // The SAME conversation id `#openApproval` used to open the step's
      // approval — required so the orchestrator can resolve the resumed
      // `approvalId` (it only matches an approval opened under the SAME
      // conversation).
      conversationId: `remediation:${plan.id}`,
      ...(snapshot.approvalId === undefined ? {} : { approvalId: snapshot.approvalId }),
    };
    const outcome = await this.#execution?.execute(context, intent);
    if (outcome === undefined) {
      throw new Error('Remediation execution port is not configured');
    }
    // Journal through the SAME execution journal (problem → plan → step →
    // execution traceability, Phase 10 §11).
    if (this.#recorder !== undefined) {
      await this.#recorder.record({
        id: prefixedId('agx'),
        agentId: plan.snapshot().agentId,
        roleId: plan.snapshot().roleId,
        domainId: agent.domainId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        planId: plan.id,
        stepId: step.id,
        problemId: plan.problemId,
        proposalId: proposal.id,
        proposalAction: snapshot.action,
        status: outcome.status,
        runId: outcome.runId,
        reason: outcome.status === 'completed' ? undefined : outcome.response.slice(0, 500),
        createdAt: nowIso(),
      });
    }
    return outcome;
  }

  /** Final verification: the plan completed when the problem is resolved. */
  async #complete(
    context: RemediationContext,
    plan: RemediationPlan,
    steps: readonly PlanStep[],
    problem: BusinessProblemDto,
    verification: string,
  ): Promise<AdvanceRemediationPlanResult> {
    const now = nowIso();
    // Any remaining steps are skipped — never executed after resolution.
    for (const step of steps) {
      if (step.isClaimable()) {
        step.transitionTo('SKIPPED', now);
        await this.#store.saveStep(step.record());
      }
    }
    plan.transitionTo('COMPLETED', now);
    plan.setOutcome({ status: 'resolved', finalVerification: verification, verifiedAt: now }, now);
    await this.#store.savePlan(plan.record());
    // The problem is RESOLVED only because the deterministic re-evaluation
    // proved the condition gone — never a tool's success claim.
    await this.#lifecycle.transition(context, plan.problemId, 'RESOLVED', now);
    return {
      ok: true,
      plan: await this.#toDto(context, plan.record(), steps),
      stepId: steps[steps.length - 1]?.id ?? plan.problemId,
    };
  }

  /** A step failed (or all steps ran without resolving): replan or stop. */
  async #replanAfterFailure(
    context: RemediationContext,
    plan: RemediationPlan,
    steps: readonly PlanStep[],
    outcome: AgentExecutionOutcome,
  ): Promise<AdvanceRemediationPlanResult> {
    if (plan.replanCount >= MAX_REPLANS) {
      const now = nowIso();
      plan.transitionTo('FAILED', now);
      plan.setReason(
        'The remediation did not resolve the problem and the re-plan limit was reached — human intervention required.',
        now,
      );
      await this.#store.savePlan(plan.record());
      await this.#lifecycle.transition(context, plan.problemId, 'REMEDIATION_FAILED', now);
      return {
        ok: true,
        plan: await this.#toDto(context, plan.record(), steps),
        stepId: steps[steps.length - 1]?.id ?? plan.problemId,
        outcome,
      };
    }
    const replanned = await this.#replanInternal(context, plan);
    if (!replanned.ok) {
      const now = nowIso();
      plan.transitionTo('FAILED', now);
      plan.setReason(replanned.reason, now);
      await this.#store.savePlan(plan.record());
      await this.#lifecycle.transition(context, plan.problemId, 'REMEDIATION_FAILED', now);
      return {
        ok: true,
        plan: await this.#toDto(context, plan.record(), steps),
        stepId: steps[steps.length - 1]?.id ?? plan.problemId,
        outcome,
      };
    }
    return {
      ok: true,
      plan: replanned.plan,
      stepId: steps[steps.length - 1]?.id ?? plan.problemId,
      outcome,
    };
  }

  /** No runnable step but the problem persists: replan (bounded) or stop. */
  async #finishOrReplan(
    context: RemediationContext,
    plan: RemediationPlan,
    steps: readonly PlanStep[],
  ): Promise<AdvanceRemediationPlanResult> {
    const reevaluation = await this.#reevaluator.reevaluate(context, plan.problemId);
    if (reevaluation !== undefined && reevaluation.stillPresent === false) {
      return this.#complete(
        context,
        plan,
        steps,
        reevaluation.problem,
        'The condition was re-evaluated and is no longer present.',
      );
    }
    if (plan.replanCount >= MAX_REPLANS) {
      const now = nowIso();
      plan.transitionTo('FAILED', now);
      plan.setReason(
        'The plan has no runnable steps and the problem persists — re-plan limit reached, human intervention required.',
        now,
      );
      await this.#store.savePlan(plan.record());
      await this.#lifecycle.transition(context, plan.problemId, 'REMEDIATION_FAILED', now);
      return {
        ok: true,
        plan: await this.#toDto(context, plan.record(), steps),
        stepId: plan.problemId,
      };
    }
    const replanned = await this.#replanInternal(context, plan);
    if (!replanned.ok) {
      const now = nowIso();
      plan.transitionTo('FAILED', now);
      plan.setReason(replanned.reason, now);
      await this.#store.savePlan(plan.record());
      await this.#lifecycle.transition(context, plan.problemId, 'REMEDIATION_FAILED', now);
      return {
        ok: true,
        plan: await this.#toDto(context, plan.record(), steps),
        stepId: plan.problemId,
      };
    }
    return { ok: true, plan: replanned.plan, stepId: plan.problemId };
  }

  /** Re-derives the plan from the CURRENT problem state (new DRAFT version). */
  async #replanInternal(
    context: RemediationContext,
    plan: RemediationPlan,
    reason?: string,
  ): Promise<
    | { ok: true; plan: RemediationPlanDto }
    | {
        ok: false;
        reason: 'replan-limit' | 'no-agent' | 'no-plan' | 'no-solution' | 'not-replannable';
      }
  > {
    if (plan.replanCount >= MAX_REPLANS) {
      return { ok: false, reason: 'replan-limit' };
    }
    const now = nowIso();
    // The plan is explainably REPLANNING (visible state) before the rebuild.
    plan.transitionTo('REPLANNING', now);
    plan.setReason(reason, now);
    await this.#store.savePlan(plan.record());
    const agent = await this.#agentResolver.resolve(context);
    if (agent === undefined) {
      return { ok: false, reason: 'no-agent' };
    }
    const problem = await this.#problemProvider.getById(context, plan.problemId);
    if (problem === undefined) {
      return { ok: false, reason: 'no-plan' };
    }
    if (problem.status === 'RESOLVED') {
      // The problem resolved itself while we were not executing — complete.
      return { ok: false, reason: 'not-replannable' };
    }
    const solution = this.#selectSolution(problem, undefined);
    if (solution === undefined) {
      return { ok: false, reason: 'no-solution' };
    }
    plan.reopenForReplan(now);
    plan.setReason(undefined, now);
    const blueprint = await this.#builder.build({
      planId: plan.id,
      agent,
      solution,
      remediationCapabilities: problem.remediationCapabilities,
      capabilities: this.#capabilities,
      routing: this.#routing,
    });
    // Replace the step set (old steps are superseded by the new version).
    const oldSteps = await this.#store.listSteps(plan.id);
    for (const old of oldSteps) {
      const hydrated = PlanStep.hydrate(old);
      if (!hydrated.isClaimable()) {
        continue;
      }
      hydrated.transitionTo('SKIPPED', now);
      await this.#store.saveStep(hydrated.record());
    }
    const steps: PlanStep[] = [];
    for (const step of blueprint.steps) {
      await this.#store.saveStep(step.record());
      steps.push(step);
    }
    if (!blueprint.ok) {
      plan.transitionTo('BLOCKED', now);
      plan.setReason(blueprint.reason, now);
      await this.#store.savePlan(plan.record());
      await this.#lifecycle.transition(context, plan.problemId, 'REMEDIATION_BLOCKED', now);
      return { ok: true, plan: await this.#toDto(context, plan.record(), steps) };
    }
    plan.transitionTo('VALIDATED', now);
    const anyApproval = steps.some((step) => step.approvalRequirement === 'REQUIRED');
    plan.transitionTo(anyApproval ? 'AWAITING_APPROVAL' : 'READY', now);
    await this.#store.savePlan(plan.record());
    await this.#lifecycle.transition(context, plan.problemId, 'REMEDIATION_PLANNED', now);
    return { ok: true, plan: await this.#toDto(context, plan.record(), steps) };
  }

  /** Builds a full plan DTO (fresh problem, steps). */
  async #toDto(
    context: RemediationContext,
    plan: RemediationPlanRecord,
    steps: readonly PlanStep[],
  ): Promise<RemediationPlanDto> {
    const problem = await this.#problemProvider.getById(context, plan.problemId);
    return this.#compose(plan, steps, problem);
  }

  /** Composes the typed DTO (display-safe). */
  #compose(
    plan: RemediationPlanRecord,
    steps: readonly PlanStep[],
    problem: BusinessProblemDto | undefined,
  ): RemediationPlanDto {
    return {
      id: plan.id,
      problemId: plan.problemId,
      ...(problem === undefined
        ? {
            problem: {
              id: plan.problemId,
              correlationId: plan.problemId,
              signalId: 'unknown',
              signalName: 'unknown',
              tenantId: plan.tenantId,
              title: 'Problem unavailable',
              description: 'The problem record could not be resolved in this scope.',
              severity: 'low' as const,
              status: 'NO_SOLUTION_FOUND' as const,
              detectedAt: plan.createdAt,
              updatedAt: plan.updatedAt,
              affectedEntities: [],
              remediationCapabilities: [],
              evidence: [],
              rootCauses: [],
              solutions: [],
            },
          }
        : { problem }),
      tenantId: plan.tenantId,
      workspaceId: plan.workspaceId,
      agentId: plan.agentId,
      roleId: plan.roleId,
      title: plan.title,
      objective: plan.objective,
      status: plan.status,
      version: plan.version,
      replanCount: plan.replanCount,
      groundedSolutionId: plan.groundedSolutionId,
      reason: plan.reason,
      steps: steps.map((step) => stepToDto(step)),
      outcome: plan.outcome,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      completedAt: plan.completedAt,
    };
  }
}

/** Handles creating a remediation plan. */
export class CreateRemediationPlanHandler {
  readonly #service: RemediationApplicationService;
  constructor(service: RemediationApplicationService) {
    this.#service = service;
  }
  handle(
    context: RemediationContext,
    request: CreateRemediationPlanRequest,
  ): Promise<CreateRemediationPlanResult> {
    return this.#service.createPlan(context, request);
  }
}

/** Handles advancing a remediation plan (execute the next step). */
export class AdvanceRemediationPlanHandler {
  readonly #service: RemediationApplicationService;
  constructor(service: RemediationApplicationService) {
    this.#service = service;
  }
  handle(context: RemediationContext, planId: string): Promise<AdvanceRemediationPlanResult> {
    return this.#service.advance(context, planId);
  }
}

/** Handles re-planning a remediation plan. */
export class ReplanRemediationPlanHandler {
  readonly #service: RemediationApplicationService;
  constructor(service: RemediationApplicationService) {
    this.#service = service;
  }
  handle(context: RemediationContext, planId: string): Promise<ReplanRemediationPlanResult> {
    return this.#service.replan(context, planId);
  }
}

/** Handles cancelling a remediation plan. */
export class CancelRemediationPlanHandler {
  readonly #service: RemediationApplicationService;
  constructor(service: RemediationApplicationService) {
    this.#service = service;
  }
  handle(context: RemediationContext, planId: string): Promise<CancelRemediationPlanResult> {
    return this.#service.cancel(context, planId);
  }
}

/** Handles listing the scope's remediation plans. */
export class ListRemediationPlansHandler {
  readonly #service: RemediationApplicationService;
  constructor(service: RemediationApplicationService) {
    this.#service = service;
  }
  handle(context: RemediationContext): Promise<readonly RemediationPlanDto[]> {
    return this.#service.list(context);
  }
}

/** Handles resolving one remediation plan by id (tenant-scoped). */
export class GetRemediationPlanHandler {
  readonly #service: RemediationApplicationService;
  constructor(service: RemediationApplicationService) {
    this.#service = service;
  }
  handle(context: RemediationContext, planId: string): Promise<RemediationPlanDto | undefined> {
    return this.#service.getById(context, planId);
  }
}
