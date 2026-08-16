/**
 * @nexora/app-api — PostgreSQL business-problem store (S27).
 *
 * The DURABLE implementation of the `@nexora/module-detection`
 * {@link ProblemStore} port: persists the problem lifecycle into
 * `business_problems` and lists the scope's problems. Reads are ALWAYS
 * tenant + workspace scoped (a forged problem id from another tenant or
 * workspace resolves to nothing — fail closed). Evidence and solution
 * candidates are NOT persisted — they are derived projections recomputed
 * at read time by the engine (S27 §17 minimum persistence).
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { businessProblems, type NexoraDatabase } from '@nexora/persistence';
import type { ProblemStore } from '@nexora/module-detection';
import type { BusinessProblemSnapshot } from '@nexora/module-detection';

type BusinessProblemRow = typeof businessProblems.$inferSelect;

/** Converts a persisted timestamp to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Maps a persisted row to a {@link BusinessProblemSnapshot}. */
function rowToSnapshot(row: BusinessProblemRow): BusinessProblemSnapshot {
  return {
    id: row.id,
    correlationId: row.correlationId,
    signalId: row.signalId,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId ?? undefined,
    title: row.title,
    description: row.description,
    severity: row.severity as BusinessProblemSnapshot['severity'],
    status: row.status as BusinessProblemSnapshot['status'],
    detectedAt: toIso(row.detectedAt),
    updatedAt: toIso(row.updatedAt),
    affectedEntities: row.affectedEntities as BusinessProblemSnapshot['affectedEntities'],
  };
}

/** The PostgreSQL {@link ProblemStore}. */
export class PgBusinessProblemStore implements ProblemStore {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async save(problem: BusinessProblemSnapshot): Promise<void> {
    await this.#db
      .insert(businessProblems)
      .values({
        id: problem.id,
        correlationId: problem.correlationId,
        signalId: problem.signalId,
        tenantId: problem.tenantId,
        workspaceId: problem.workspaceId ?? null,
        title: problem.title,
        description: problem.description,
        severity: problem.severity,
        status: problem.status,
        affectedEntities: problem.affectedEntities,
        detectedAt: new Date(problem.detectedAt),
        updatedAt: new Date(problem.updatedAt),
      })
      .onConflictDoUpdate({
        target: businessProblems.id,
        set: {
          title: problem.title,
          description: problem.description,
          severity: problem.severity,
          status: problem.status,
          affectedEntities: problem.affectedEntities,
          updatedAt: new Date(problem.updatedAt),
        },
      });
  }

  async findById(tenantId: string, problemId: string) {
    const rows = await this.#db
      .select()
      .from(businessProblems)
      .where(and(eq(businessProblems.tenantId, tenantId), eq(businessProblems.id, problemId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToSnapshot(row);
  }

  async listByScope(scope: { tenantId: string; workspaceId?: string; limit: number }) {
    const rows = await this.#db
      .select()
      .from(businessProblems)
      .where(
        and(
          eq(businessProblems.tenantId, scope.tenantId),
          scope.workspaceId === undefined
            ? sql`${businessProblems.workspaceId} IS NULL`
            : eq(businessProblems.workspaceId, scope.workspaceId),
        ),
      )
      .orderBy(desc(businessProblems.detectedAt))
      .limit(scope.limit);
    return rows.map(rowToSnapshot);
  }

  async findByCorrelationId(input: { tenantId: string; correlationId: string }) {
    const rows = await this.#db
      .select()
      .from(businessProblems)
      .where(
        and(
          eq(businessProblems.tenantId, input.tenantId),
          eq(businessProblems.correlationId, input.correlationId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToSnapshot(row);
  }
}
