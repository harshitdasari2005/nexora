/**
 * @nexora/persistence — measurement repository.
 *
 * Drizzle implementation of the measurements module repository port
 * (`@nexora/module-measurements`). Computes the PRD §20.4 pilot dashboard
 * metrics as tenant-scoped SQL aggregations — one query per metric group,
 * never list-loading + JS aggregation (the S22 N+1 lesson).
 *
 * Every query filters by `tenant_id` in SQL FIRST (defense-in-depth): a
 * caller can never derive another tenant's numbers from this repository.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { TenantId } from '@nexora/contracts/common';
import type {
  AuditCompletenessMetric,
  MeasurementRepository,
  OnboardingUserMetric,
  TenantMeasurementsSnapshot,
  TenantOverview,
  WorkflowHealthMetric,
} from '@nexora/module-measurements';
import { nowIso } from '@nexora/shared/time';

import type { NexoraDatabase } from '../db.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** A raw aggregate row (typed loosely; keys are SQL aliases). */
interface AggregateRow {
  [column: string]: unknown;
}

/** Reads a number-or-string count from an aggregate row. */
function toCount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return 0;
}

/** Reads a nullable number (percentile) from an aggregate row. */
function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Drizzle {@link MeasurementRepository} implementation. */
export class PgMeasurementRepository implements MeasurementRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async loadTenantMeasurements(tenantId: TenantId): Promise<TenantMeasurementsSnapshot> {
    const [workflowHealth, onboarding, auditCompleteness, overview] = await Promise.all([
      this.#workflowHealth(tenantId),
      this.#onboarding(tenantId),
      this.#auditCompleteness(tenantId),
      this.#overview(tenantId),
    ]);
    return {
      tenantId,
      generatedAt: nowIso(),
      workflowHealth,
      onboarding,
      auditCompleteness,
      overview,
    };
  }

  /** Workflow health per definition: totals, rates, cycle-time percentiles. */
  async #workflowHealth(tenantId: TenantId): Promise<readonly WorkflowHealthMetric[]> {
    // Percentiles are computed over terminal instances (succeeded/failed):
    // an instance still running has no completed cycle to measure.
    const rows = await this.#execute(sql`
      SELECT
        definition_key AS key,
        count(*) AS total,
        count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
        count(*) FILTER (WHERE status = 'failed') AS failed,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY (extract(epoch FROM (finished_at - started_at)) * 1000))
          FILTER (WHERE status IN ('succeeded', 'failed')) AS cycle_p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (extract(epoch FROM (finished_at - started_at)) * 1000))
          FILTER (WHERE status IN ('succeeded', 'failed')) AS cycle_p95_ms
      FROM workflow_instances
      WHERE tenant_id = ${tenantId}
      GROUP BY definition_key
      ORDER BY total DESC, key ASC
    `);
    return rows.map((row) => {
      const total = toCount(row['total']);
      const succeeded = toCount(row['succeeded']);
      const failed = toCount(row['failed']);
      return {
        definitionKey: String(row['key'] ?? ''),
        total,
        succeeded,
        failed,
        successRate: total === 0 ? 0 : Math.round((succeeded / total) * 10_000) / 100,
        unrecoverableErrorRate: total === 0 ? 0 : Math.round((failed / total) * 10_000) / 100,
        cycleTimeP50Ms: toNullableNumber(row['cycle_p50_ms']),
        cycleTimeP95Ms: toNullableNumber(row['cycle_p95_ms']),
      };
    });
  }

  /**
   * Onboarding per user: org membership (signup) → first succeeded workflow.
   * Users are platform-scoped (users.tenant_id is the platform tenant); the
   * ORG membership is the tenant boundary — a tenant's users are the users
   * of its organization_memberships, with joined_at as the onboarding time.
   */
  async #onboarding(tenantId: TenantId): Promise<readonly OnboardingUserMetric[]> {
    const rows = await this.#execute(sql`
      SELECT
        u.id AS user_id,
        u.email AS email,
        om.joined_at AS signed_up_at,
        (
          SELECT min(w.created_at)
          FROM workflow_instances w
          WHERE w.tenant_id = ${tenantId} AND w.user_id = u.id AND w.status = 'succeeded'
        ) AS first_workflow_at
      FROM organization_memberships om
      JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = ${tenantId}
      ORDER BY om.joined_at ASC
    `);
    return rows.map((row) => {
      const signedUpAt = toIso(row['signed_up_at'] as Date | string);
      const firstWorkflowAtValue = row['first_workflow_at'];
      const firstWorkflowAt =
        firstWorkflowAtValue === null || firstWorkflowAtValue === undefined
          ? null
          : toIso(firstWorkflowAtValue as Date | string);
      return {
        userId: String(row['user_id'] ?? ''),
        email: String(row['email'] ?? ''),
        signedUpAt,
        firstWorkflowAt,
        timeToFirstWorkflowMs:
          firstWorkflowAt === null
            ? null
            : Math.max(0, Date.parse(firstWorkflowAt) - Date.parse(signedUpAt)),
      };
    });
  }

  /** Audit completeness: share of executions with an audit-trail entry. */
  async #auditCompleteness(tenantId: TenantId): Promise<AuditCompletenessMetric> {
    const [summary, untracedRows] = await Promise.all([
      this.#execute(sql`
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE t.correlation_id IS NOT NULL) AS traced
        FROM workflow_instances wi
        LEFT JOIN (
          SELECT DISTINCT correlation_id
          FROM activity_items
          WHERE tenant_id = ${tenantId}
        ) t ON t.correlation_id = wi.correlation_id
        WHERE wi.tenant_id = ${tenantId}
      `),
      this.#execute(sql`
        SELECT DISTINCT wi.definition_key AS key
        FROM workflow_instances wi
        LEFT JOIN (
          SELECT DISTINCT correlation_id
          FROM activity_items
          WHERE tenant_id = ${tenantId}
        ) t ON t.correlation_id = wi.correlation_id
        WHERE wi.tenant_id = ${tenantId} AND t.correlation_id IS NULL
        ORDER BY key ASC
      `),
    ]);
    const total = toCount(summary[0]?.['total']);
    const traced = toCount(summary[0]?.['traced']);
    return {
      traceableShare: total === 0 ? 100 : Math.round((traced / total) * 10_000) / 100,
      totalEvents: total,
      tracedEvents: traced,
      untracedTypes: untracedRows
        .map((row) => String(row['key'] ?? ''))
        .filter((key) => key.length > 0),
    };
  }

  /** Tenant overview counts across surfaces. */
  async #overview(tenantId: TenantId): Promise<TenantOverview> {
    const rows = await this.#execute(sql`
      SELECT
        (SELECT count(*) FROM organization_memberships WHERE organization_id = ${tenantId}) AS users,
        (SELECT count(*) FROM workspaces WHERE organization_id = ${tenantId}) AS workspaces,
        (SELECT count(*) FROM projects WHERE organization_id = ${tenantId}) AS projects,
        (SELECT count(*) FROM documents WHERE organization_id = ${tenantId}) AS documents,
        (SELECT count(*) FROM knowledge_sources WHERE tenant_id = ${tenantId}) AS knowledge_sources,
        (SELECT count(*) FROM calendar_events WHERE organization_id = ${tenantId}) AS calendar_events
    `);
    const row = rows[0] ?? {};
    return {
      users: toCount(row['users']),
      workspaces: toCount(row['workspaces']),
      projects: toCount(row['projects']),
      documents: toCount(row['documents']),
      knowledgeSources: toCount(row['knowledge_sources']),
      calendarEvents: toCount(row['calendar_events']),
    };
  }

  /** Runs a parameterized SQL statement and returns the raw rows. */
  async #execute(query: SQL): Promise<AggregateRow[]> {
    const result = await this.#db.execute(query);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    return rows as AggregateRow[];
  }
}
