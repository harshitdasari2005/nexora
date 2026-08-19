/**
 * @nexora/module-remediation — PlanStore (Phase 10 durability).
 *
 * The persistence port for {@link RemediationPlan}s + {@link PlanStep}s.
 * Implemented by the API layer over the persistence seam
 * (`remediation_plans` + `remediation_plan_steps`); in-memory in hermetic
 * module tests. Reads are ALWAYS tenant/workspace-scoped — a forged plan id
 * from another tenant resolves to nothing (fail closed).
 *
 * The plan store also owns the step EXECUTION CLAIM: `claimStepForExecution`
 * must be atomic (check + transition) so a duplicate or concurrent advance
 * of the same step can never execute the action twice. The in-memory
 * implementation is synchronous within the event loop; durable stores use a
 * conditional update (PENDING/AWAITING_APPROVAL → RUNNING).
 */

import type { RemediationPlanRecord, RemediationStepRecord } from '@nexora/contracts/remediation';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';

import { PlanStep } from '../domain/plan.js';

/** The plan store port (durability + the atomic step claim). */
export interface PlanStore {
  /** Persists a plan (insert or update by id). */
  savePlan(plan: RemediationPlanRecord): Promise<void>;
  /** Persists a step (insert or update by id). */
  saveStep(step: RemediationStepRecord): Promise<void>;
  /** Resolves a plan by id within the trusted tenant scope, or `undefined`. */
  findPlanById(tenantId: string, planId: string): Promise<RemediationPlanRecord | undefined>;
  /** Lists the scope's plans, newest first (bounded). */
  listPlans(scope: {
    tenantId: string;
    workspaceId?: string;
    limit: number;
  }): Promise<readonly RemediationPlanRecord[]>;
  /** Lists a plan's steps in sequence order. */
  listSteps(planId: string): Promise<readonly RemediationStepRecord[]>;
  /** Lists the plans of one problem (tenant-scoped, newest first). */
  listPlansByProblem(scope: {
    tenantId: string;
    problemId: string;
    limit: number;
  }): Promise<readonly RemediationPlanRecord[]>;
  /**
   * Atomically claims ONE step for execution (`PENDING`/`AWAITING_APPROVAL`
   * → `RUNNING`) when its dependencies are satisfied (VERIFIED). Returns
   * the claimed step, or `undefined` when the step is not claimable — a
   * duplicate or concurrent advance of the same step can never claim it
   * twice (exactly-once execution).
   */
  claimStep(planId: string, stepId: string): Promise<PlanStep | undefined>;
}

/** An in-memory {@link PlanStore} (hermetic module tests + dev). */
export class InMemoryPlanStore implements PlanStore {
  readonly #plans = new Map<string, RemediationPlanRecord>();
  readonly #steps = new Map<string, RemediationStepRecord>();

  async savePlan(plan: RemediationPlanRecord): Promise<void> {
    this.#plans.set(plan.id, { ...plan });
  }

  async saveStep(step: RemediationStepRecord): Promise<void> {
    this.#steps.set(step.id, { ...step });
  }

  async findPlanById(tenantId: string, planId: string): Promise<RemediationPlanRecord | undefined> {
    const plan = this.#plans.get(planId);
    if (plan === undefined || plan.tenantId !== tenantId) {
      return undefined;
    }
    return { ...plan };
  }

  async listPlans(scope: {
    tenantId: string;
    workspaceId?: string;
    limit: number;
  }): Promise<readonly RemediationPlanRecord[]> {
    return [...this.#plans.values()]
      .filter(
        (plan) =>
          plan.tenantId === scope.tenantId &&
          (scope.workspaceId === undefined || plan.workspaceId === scope.workspaceId),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, scope.limit)
      .map((plan) => ({ ...plan }));
  }

  async listSteps(planId: string): Promise<readonly RemediationStepRecord[]> {
    return [...this.#steps.values()]
      .filter((step) => step.planId === planId)
      .sort((a, b) => a.sequence - b.sequence)
      .map((step) => ({ ...step }));
  }

  async listPlansByProblem(scope: {
    tenantId: string;
    problemId: string;
    limit: number;
  }): Promise<readonly RemediationPlanRecord[]> {
    return [...this.#plans.values()]
      .filter((plan) => plan.tenantId === scope.tenantId && plan.problemId === scope.problemId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, scope.limit)
      .map((plan) => ({ ...plan }));
  }

  async claimStep(planId: string, stepId: string): Promise<PlanStep | undefined> {
    // Check-and-transition is synchronous — atomic within the event loop.
    const record = this.#steps.get(stepId);
    if (record === undefined || record.planId !== planId) {
      return undefined;
    }
    if (record.status !== 'PENDING' && record.status !== 'AWAITING_APPROVAL') {
      return undefined;
    }
    const completed = new Set(
      [...this.#steps.values()]
        .filter((step) => step.planId === planId && step.status === 'VERIFIED')
        .map((step) => step.id),
    );
    const dependenciesMet = (record.dependencies ?? []).every((id) => completed.has(id));
    if (!dependenciesMet) {
      return undefined;
    }
    const step = PlanStep.hydrate(record);
    step.transitionTo('RUNNING', nowIso());
    this.#steps.set(step.id, step.record());
    return step;
  }

  /** Test helper: generates a fresh plan id. */
  static newPlanId(): string {
    return prefixedId('rpl');
  }

  /** Test helper: generates a fresh step id. */
  static newStepId(): string {
    return prefixedId('rst');
  }
}
