/**
 * @nexora/module-detection — the detection snapshot (S27).
 *
 * The TRUSTED data surface every signal evaluator reads. The API layer
 * builds it from the EXISTING tenant/workspace-scoped application handlers
 * (measurements, projects, notifications, activity, agent executions) — the
 * same handlers the S26 agent proposals use. Signal evaluators are pure:
 * they read this snapshot and decide deterministically whether a threshold
 * was crossed. A snapshot source that fails resolves to an empty section
 * (fail safe) — a broken source never invents evidence.
 *
 * Security contract (S27): the snapshot is assembled from TRUSTED context
 * only (tenant from membership, workspace verified against membership).
 * Evaluators cannot reach repositories directly and cannot widen scope.
 */

/** A workflow-health metric the evaluators read (measurements section). */
export interface SnapshotWorkflowHealth {
  /** The stable definition key, e.g. `employee-onboarding`. */
  definitionKey: string;
  /** Terminal instances of the definition in the tenant. */
  total: number;
  /** Instances that reached `failed`. */
  failed: number;
  /** Succeeded / total, 0–100. */
  successRate: number;
  /** Failed / total, 0–100. */
  unrecoverableErrorRate: number;
  /** Cycle time p95 in ms (terminal instances). */
  cycleTimeP95Ms: number | null;
}

/** An onboarding user metric the evaluators read. */
export interface SnapshotOnboardingUser {
  /** The user id. */
  userId: string;
  /** ISO-8601 signup time. */
  signedUpAt: string;
  /** ISO-8601 first succeeded workflow time, when one exists. */
  firstWorkflowAt: string | null;
}

/** A project summary the evaluators read (projects section). */
export interface SnapshotProject {
  /** The persisted project id. */
  id: string;
  /** The project name. */
  name: string;
  /** The project status. */
  status: string;
}

/** An unread notification summary the evaluators read. */
export interface SnapshotNotification {
  /** The notification id. */
  id: string;
  /** The notification title. */
  title: string;
  /** The notification body. */
  body: string;
}

/** A recent activity item the evaluators read. */
export interface SnapshotActivity {
  /** The activity item id. */
  id: string;
  /** The activity type, e.g. `workflow.failed`. */
  type: string;
  /** The activity title. */
  title: string;
  /** ISO-8601 UTC time the activity occurred. */
  occurredAt: string;
}

/**
 * A budget-utilization summary the evaluators read (finance section). The
 * SAME projection the Finance application layer's `listBudgetUtilization`
 * query computes (approved expenses summed per budget) — never recomputed
 * here, only carried through.
 */
export interface SnapshotBudget {
  /** The budget id. */
  budgetId: string;
  /** The budget name. */
  name: string;
  /** The three-letter currency code. */
  currency: string;
  /** The allocated amount, in minor units. */
  allocatedMinorUnits: number;
  /** Approved expenses claimed against this budget, in minor units. */
  spentMinorUnits: number;
  /** The budget's lifecycle status (`active` | `under_review` | `closed`). */
  status: string;
}

/** A recent agent-execution summary the evaluators read (journal). */
export interface SnapshotAgentExecution {
  /** The execution record id. */
  id: string;
  /** The executed agent id. */
  agentId: string;
  /** The execution status. */
  status: string;
  /** The executed proposal action, when the run came from a proposal. */
  proposalAction?: string;
  /** ISO-8601 UTC time the execution was recorded. */
  createdAt: string;
}

/** The full trusted detection snapshot. */
export interface DetectionSnapshot {
  /** The tenant scope. */
  tenantId: string;
  /** The verified workspace scope, when present. */
  workspaceId?: string;
  /** The authenticated user (trusted). */
  userId: string;
  /** ISO-8601 UTC time the snapshot was assembled. */
  generatedAt: string;
  /** Workflow health per definition (bounded). */
  workflowHealth: readonly SnapshotWorkflowHealth[];
  /** Onboarding user metrics (bounded). */
  onboarding: readonly SnapshotOnboardingUser[];
  /** Projects of the tenant (bounded). */
  projects: readonly SnapshotProject[];
  /** The caller's unread notifications (bounded). */
  notifications: readonly SnapshotNotification[];
  /** Recent activity in the scope (bounded). */
  activity: readonly SnapshotActivity[];
  /** Recent agent executions in the scope (journal, bounded). */
  agentExecutions: readonly SnapshotAgentExecution[];
  /** The number of documents indexed in the workspace (when available). */
  documentCount?: number;
  /** Audit-completeness of the tenant's business executions. */
  auditCompleteness?: {
    /** Share of executions with an audit-trail entry, 0–100. */
    traceableShare: number;
    /** Total business executions (workflow instances). */
    totalEvents: number;
  };
  /**
   * Budget utilization in the workspace (finance section, S35). Optional —
   * mirrors `auditCompleteness`: added after the other required sections,
   * so existing snapshot construction sites keep compiling unchanged.
   */
  budgets?: readonly SnapshotBudget[];
}

/**
 * Builds the trusted detection snapshot from the EXISTING application
 * handlers. Implemented by the API layer; sources that fail resolve to
 * empty sections (fail safe).
 */
export interface DetectionSnapshotLoader {
  load(context: {
    tenantId: string;
    workspaceId?: string;
    userId: string;
  }): Promise<DetectionSnapshot>;
}
