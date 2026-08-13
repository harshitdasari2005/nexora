/**
 * @nexora/module-measurements — measurement snapshot contracts.
 *
 * The pilot measurement dashboard read model (PRD §20.4, ROADMAP §23): a
 * tenant-scoped snapshot of the pilot-readiness criteria computed from
 * persisted business data. Metrics are value snapshots — plain records, no
 * lifecycle — derived by the repository port in SQL aggregations (never by
 * loading lists and computing in JS, per the S22 N+1 lesson).
 */

import type { TenantId } from '@nexora/contracts/common';

/** Workflow health per definition (PRD §20.4: success rate, error rate, cycle time). */
export interface WorkflowHealthMetric {
  /** The stable definition key (e.g. `employee-onboarding`). */
  definitionKey: string;
  /** Total terminal instances of this definition in the tenant. */
  total: number;
  /** Instances that reached `succeeded`. */
  succeeded: number;
  /** Instances that reached `failed` (unrecoverable). */
  failed: number;
  /** Succeeded / total, 0–100. */
  successRate: number;
  /** Failed / total, 0–100. */
  unrecoverableErrorRate: number;
  /** Cycle time p50 in ms (started → finished of terminal instances). */
  cycleTimeP50Ms: number | null;
  /** Cycle time p95 in ms (started → finished of terminal instances). */
  cycleTimeP95Ms: number | null;
}

/** Onboarding progress per user (PRD §20.4: time to first workflow). */
export interface OnboardingUserMetric {
  /** The user id. */
  userId: string;
  /** The user email (display only). */
  email: string;
  /** ISO-8601 signup time. */
  signedUpAt: string;
  /** ISO-8601 first succeeded workflow time, when one exists. */
  firstWorkflowAt: string | null;
  /** Milliseconds from signup to first succeeded workflow, when known. */
  timeToFirstWorkflowMs: number | null;
}

/** Audit completeness (PRD §20.4: traceable event share + untraced types). */
export interface AuditCompletenessMetric {
  /** Share of business executions with an audit-trail entry, 0–100. */
  traceableShare: number;
  /** Total business executions (workflow instances). */
  totalEvents: number;
  /** Executions with at least one activity item in the same correlation scope. */
  tracedEvents: number;
  /** Definition keys whose executions have no audit-trail entry. */
  untracedTypes: string[];
}

/** Tenant overview counts (PRD §20.4: active usage across surfaces). */
export interface TenantOverview {
  /** Users registered in the tenant. */
  users: number;
  /** Workspaces in the tenant. */
  workspaces: number;
  /** Projects in the tenant. */
  projects: number;
  /** Documents in the tenant. */
  documents: number;
  /** Knowledge sources (search corpus) in the tenant. */
  knowledgeSources: number;
  /** Calendar events in the tenant. */
  calendarEvents: number;
}

/** The full tenant measurement snapshot returned by the dashboard. */
export interface TenantMeasurementsSnapshot {
  /** The tenant scope the metrics were computed for. */
  tenantId: TenantId;
  /** ISO-8601 UTC time the snapshot was computed. */
  generatedAt: string;
  /** Workflow health per definition. */
  workflowHealth: readonly WorkflowHealthMetric[];
  /** Onboarding progress per user. */
  onboarding: readonly OnboardingUserMetric[];
  /** Audit completeness of the tenant's business executions. */
  auditCompleteness: AuditCompletenessMetric;
  /** Tenant overview counts. */
  overview: TenantOverview;
}
