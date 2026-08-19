/**
 * @nexora/app-api — PostgreSQL remediation plan store (Phase 10).
 *
 * The DURABLE implementation of the `@nexora/module-remediation`
 * {@link PlanStore} port: persists plans + steps into
 * `remediation_plans` / `remediation_plan_steps` and resolves them scoped
 * by tenant (and workspace where present) — a forged plan id from another
 * tenant resolves to nothing (fail closed).
 *
 * The step EXECUTION CLAIM is a conditional update
 * (`PENDING`/`AWAITING_APPROVAL` → `RUNNING`) restricted to steps whose
 * dependencies are VERIFIED — the atomic exactly-once guarantee: a
 * duplicate or concurrent advance of the same step can never claim it
 * twice, so the action can never execute twice.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { remediationPlanSteps, remediationPlans, type NexoraDatabase } from '@nexora/persistence';
import type { PlanStore } from '@nexora/module-remediation';
import type { RemediationPlanRecord, RemediationStepRecord } from '@nexora/contracts/remediation';
import { PlanStep } from '@nexora/module-remediation';

type PlanRow = typeof remediationPlans.$inferSelect;
type StepRow = typeof remediationPlanSteps.$inferSelect;

/** Converts a persisted timestamp to an ISO string. */
function toIso(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

/** Maps a persisted plan row to a {@link RemediationPlanRecord}. */
function rowToPlan(row: PlanRow): RemediationPlanRecord {
  return {
    id: row.id,
    problemId: row.problemId,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId ?? undefined,
    agentId: row.agentId,
    roleId: row.roleId,
    title: row.title,
    objective: row.objective,
    status: row.status as RemediationPlanRecord['status'],
    version: row.version,
    replanCount: row.replanCount,
    groundedSolutionId: row.groundedSolutionId ?? undefined,
    reason: row.reason ?? undefined,
    outcome: (row.outcome ?? undefined) as RemediationPlanRecord['outcome'],
    createdAt: toIso(row.createdAt) as string,
    updatedAt: toIso(row.updatedAt) as string,
    completedAt: toIso(row.completedAt),
  };
}

/** Maps a persisted step row to a {@link RemediationStepRecord}. */
function rowToStep(row: StepRow): RemediationStepRecord {
  return {
    id: row.id,
    planId: row.planId,
    sequence: row.sequence,
    action: row.action,
    capabilityId: row.capabilityId,
    description: row.description,
    rationale: row.rationale,
    dependencies: row.dependencies as readonly string[],
    approvalRequirement: row.approvalRequirement as RemediationStepRecord['approvalRequirement'],
    requiredApproverRoleId: row.requiredApproverRoleId ?? undefined,
    verificationRequirement: row.verificationRequirement,
    status: row.status as RemediationStepRecord['status'],
    result: row.result ?? undefined,
    evidence: (row.evidence ?? undefined) as readonly string[] | undefined,
    approvalId: row.approvalId ?? undefined,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    updatedAt: toIso(row.updatedAt) as string,
  };
}

/** The PostgreSQL {@link PlanStore}. */
export class PgPlanStore implements PlanStore {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async savePlan(plan: RemediationPlanRecord): Promise<void> {
    await this.#db
      .insert(remediationPlans)
      .values({
        id: plan.id,
        problemId: plan.problemId,
        tenantId: plan.tenantId,
        workspaceId: plan.workspaceId ?? null,
        agentId: plan.agentId,
        roleId: plan.roleId,
        title: plan.title,
        objective: plan.objective,
        status: plan.status,
        version: plan.version,
        replanCount: plan.replanCount,
        groundedSolutionId: plan.groundedSolutionId ?? null,
        reason: plan.reason ?? null,
        outcome: (plan.outcome ?? null) as never,
        createdAt: new Date(plan.createdAt),
        updatedAt: new Date(plan.updatedAt),
        completedAt: plan.completedAt === undefined ? null : new Date(plan.completedAt),
      })
      .onConflictDoUpdate({
        target: remediationPlans.id,
        set: {
          status: plan.status,
          version: plan.version,
          replanCount: plan.replanCount,
          groundedSolutionId: plan.groundedSolutionId ?? null,
          reason: plan.reason ?? null,
          outcome: (plan.outcome ?? null) as never,
          updatedAt: new Date(plan.updatedAt),
          completedAt: plan.completedAt === undefined ? null : new Date(plan.completedAt),
        },
      });
  }

  async saveStep(step: RemediationStepRecord): Promise<void> {
    // The step row is tenant-scoped in persistence; the step record carries
    // its plan id, so the tenant is resolved from the owning plan (one
    // bounded lookup per step save — plan creation writes ≤ 6 steps).
    const tenantId = await this.#tenantOf(step.planId);
    if (tenantId === undefined) {
      // The owning plan is gone — nothing to attach the step to (fail safe;
      // the engine never observes the step without its plan).
      return;
    }
    await this.#db
      .insert(remediationPlanSteps)
      .values({
        id: step.id,
        planId: step.planId,
        tenantId,
        sequence: step.sequence,
        action: step.action,
        capabilityId: step.capabilityId,
        description: step.description,
        rationale: step.rationale,
        dependencies: step.dependencies,
        approvalRequirement: step.approvalRequirement,
        requiredApproverRoleId: step.requiredApproverRoleId ?? null,
        verificationRequirement: step.verificationRequirement,
        status: step.status,
        result: step.result as never,
        evidence: step.evidence as never,
        approvalId: step.approvalId ?? null,
        startedAt: step.startedAt === undefined ? null : new Date(step.startedAt),
        completedAt: step.completedAt === undefined ? null : new Date(step.completedAt),
        createdAt: new Date(step.updatedAt),
        updatedAt: new Date(step.updatedAt),
      })
      .onConflictDoUpdate({
        target: remediationPlanSteps.id,
        set: {
          status: step.status,
          result: step.result as never,
          evidence: step.evidence as never,
          approvalId: step.approvalId ?? null,
          startedAt: step.startedAt === undefined ? null : new Date(step.startedAt),
          completedAt: step.completedAt === undefined ? null : new Date(step.completedAt),
          updatedAt: new Date(step.updatedAt),
        },
      });
  }

  async findPlanById(tenantId: string, planId: string): Promise<RemediationPlanRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(remediationPlans)
      .where(and(eq(remediationPlans.tenantId, tenantId), eq(remediationPlans.id, planId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToPlan(row);
  }

  async listPlans(scope: {
    tenantId: string;
    workspaceId?: string;
    limit: number;
  }): Promise<readonly RemediationPlanRecord[]> {
    const rows = await this.#db
      .select()
      .from(remediationPlans)
      .where(
        and(
          eq(remediationPlans.tenantId, scope.tenantId),
          scope.workspaceId === undefined
            ? sql`${remediationPlans.workspaceId} IS NULL`
            : eq(remediationPlans.workspaceId, scope.workspaceId),
        ),
      )
      .orderBy(desc(remediationPlans.updatedAt))
      .limit(scope.limit);
    return rows.map(rowToPlan);
  }

  async listSteps(planId: string): Promise<readonly RemediationStepRecord[]> {
    const rows = await this.#db
      .select()
      .from(remediationPlanSteps)
      .where(eq(remediationPlanSteps.planId, planId))
      .orderBy(asc(remediationPlanSteps.sequence));
    return rows.map(rowToStep);
  }

  async listPlansByProblem(scope: {
    tenantId: string;
    problemId: string;
    limit: number;
  }): Promise<readonly RemediationPlanRecord[]> {
    const rows = await this.#db
      .select()
      .from(remediationPlans)
      .where(
        and(
          eq(remediationPlans.tenantId, scope.tenantId),
          eq(remediationPlans.problemId, scope.problemId),
        ),
      )
      .orderBy(desc(remediationPlans.updatedAt))
      .limit(scope.limit);
    return rows.map(rowToPlan);
  }

  async claimStep(planId: string, stepId: string): Promise<PlanStep | undefined> {
    // Pre-check: the step must be claimable AND its dependencies VERIFIED
    // (the engine already selects only dependency-satisfied steps; this is
    // the store's second, independent check).
    const rows = await this.#db
      .select()
      .from(remediationPlanSteps)
      .where(
        and(
          eq(remediationPlanSteps.planId, planId),
          eq(remediationPlanSteps.id, stepId),
          sql`${remediationPlanSteps.status} IN ('PENDING', 'AWAITING_APPROVAL')`,
        ),
      )
      .limit(1);
    const record = rows[0];
    if (record === undefined) {
      return undefined;
    }
    const dependencies = (record.dependencies as readonly string[]) ?? [];
    if (dependencies.length > 0) {
      const deps = await this.#db
        .select({ id: remediationPlanSteps.id, status: remediationPlanSteps.status })
        .from(remediationPlanSteps)
        .where(
          and(
            eq(remediationPlanSteps.planId, planId),
            inArray(remediationPlanSteps.id, [...dependencies]),
          ),
        );
      if (deps.some((dep) => dep.status !== 'VERIFIED')) {
        return undefined;
      }
    }
    // The ATOMIC claim: PENDING/AWAITING_APPROVAL → RUNNING via a
    // conditional update. A duplicate/concurrent advance of the same step
    // sees zero affected rows and can never claim it twice (exactly-once
    // execution) — the browser refresh can never re-run the action.
    const claimed = await this.#db
      .update(remediationPlanSteps)
      .set({ status: 'RUNNING', startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(remediationPlanSteps.id, stepId),
          eq(remediationPlanSteps.planId, planId),
          sql`${remediationPlanSteps.status} IN ('PENDING', 'AWAITING_APPROVAL')`,
        ),
      )
      .returning();
    const row = claimed[0];
    return row === undefined ? undefined : PlanStep.hydrate(rowToStep(row));
  }

  /** Resolves the tenant id of a plan (scoped read). */
  async #tenantOf(planId: string): Promise<string | undefined> {
    const rows = await this.#db
      .select({ tenantId: remediationPlans.tenantId })
      .from(remediationPlans)
      .where(eq(remediationPlans.id, planId))
      .limit(1);
    return rows[0]?.tenantId;
  }
}
