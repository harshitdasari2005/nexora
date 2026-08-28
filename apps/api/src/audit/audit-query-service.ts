/**
 * @nexora/app-api — Audit Center query service.
 *
 * A READ-ONLY view over four EXISTING persisted journals — never a second
 * execution engine, approval system, or audit log. Every fact shown here is
 * read straight from a table another feature already writes as a normal
 * part of doing its job:
 *
 * - `agent_executions` — one row per governed AI/business-agent run
 *   (`PgAgentExecutionRecorder` / `AgentExecutionRecorder`).
 * - `approval_requests` — one row per human approval gate
 *   (`PgApprovalEngine` / `ApprovalEngine`).
 * - `workflow_step_executions` — one row per workflow step attempt
 *   (`PgWorkflowStepExecutionRepository`).
 * - `activity_items` — the existing workspace activity feed
 *   (`PgActivityRepository`), already covering project/employee/document/
 *   knowledge/calendar/marketplace/connector events the other three sources
 *   don't.
 *
 * This module adds exactly one thing beyond what already existed: a
 * `listByTenant` read method on the `AgentExecutionRecorder` and
 * `ApprovalEngine` ports (the other two already had a tenant-wide list).
 * Every write path — `record`, `open`, `decide`, `claim`, `recordOutcome`,
 * step execution `save` — is untouched.
 *
 * Field honesty (do not invent audit events, do not fabricate fields):
 * - `roleName` is populated ONLY for agent-execution events, the one source
 *   that persists a `roleId` directly. The other three sources never stored
 *   a role at write time, so role is `undefined` there rather than a
 *   best-effort live lookup that could misrepresent the role the actor
 *   actually held at the time of the event.
 * - `verification result` (mentioned as an example field in the product
 *   brief) is NOT surfaced: the AI runtime computes per-step verification
 *   in memory but never persists it, so there is nothing to read. See the
 *   Audit Center report for this as a documented limitation.
 * - Actor/workspace names are resolved from the SAME `users`/`workspaces`
 *   tables every other page reads, batched to avoid one query per row.
 */

import type { AgentExecutionRecord } from '@nexora/contracts/agent';
import type { AgentExecutionRecorder } from '@nexora/module-agents';
import type { ApprovalEngine, ApprovalRequestRecord } from '@nexora/ai-runtime';
import type {
  WorkflowInstanceRepository,
  WorkflowStepExecutionRepository,
} from '@nexora/module-workflow';
import type { ActivityRepository } from '@nexora/module-notifications';
import type { UserRepository } from '@nexora/domain-identity';
import type { WorkspaceRepository } from '@nexora/domain-workspaces';
import type { DomainCatalog } from '@nexora/module-domains';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

/** The four underlying journals a unified event can come from. */
export type AuditEventSource = 'agent_execution' | 'approval' | 'workflow_step' | 'activity';

/**
 * One unified audit event row — carries everything the list AND the detail
 * view need (no separate detail fetch; the list response is already
 * complete). Fields absent for a given source are `undefined`, never a
 * fabricated placeholder.
 */
export interface AuditEventDto {
  /** Stable id, prefixed by source so ids never collide across journals. */
  id: string;
  source: AuditEventSource;
  /** ISO-8601 UTC. */
  occurredAt: string;
  /** The trusted actor user id, when the event was caused by a human. */
  actorId?: string;
  /** Resolved display name ("System" when no human actor; "Unknown user" on a lookup miss). */
  actorName: string;
  /** The effective business role id — agent-execution events only (directly persisted). */
  roleId?: string;
  /** The role's display name (from the SAME domain catalog every RBAC check uses). */
  roleName?: string;
  /** A human-readable grouping label (domain name, or a humanized capability/type prefix). */
  module: string;
  /** What happened, in a human sentence — never a raw enum or id. */
  action: string;
  /** The concrete object/target affected, when the source data names one. */
  object?: string;
  /** The raw status/lifecycle value. */
  status: string;
  /** A human-readable status label. */
  statusLabel: string;
  workspaceId?: string;
  /** Resolved workspace display name. */
  workspaceName?: string;
  /** Whether this action required a human approval gate. */
  approvalRequired: boolean;
  /** The correlated approval's outcome, when one was found (agent_execution events, via the shared runId). */
  approvalOutcome?: {
    status: string;
    statusLabel: string;
    decidedByName?: string;
    decisionReason?: string;
  };
  /** Free-text detail (the fuller narrative/body, when the source has one). */
  detail?: string;
  /** A failure/error message, when the event recorded one. */
  error?: string;
  /**
   * Technical reference ids (run/plan/problem/approval/workflow ids) —
   * shown in the detail panel only, for cross-referencing other Nexora
   * surfaces. Never used as the primary label.
   */
  references?: Record<string, string>;
}

/** Filters accepted by {@link AuditQueryService.listEvents}. */
export interface AuditEventFilters {
  source?: AuditEventSource;
  status?: string;
  actorId?: string;
  /** ISO-8601 UTC lower bound (inclusive). */
  from?: string;
  /** ISO-8601 UTC upper bound (inclusive). */
  to?: string;
  /** Case-insensitive substring match over action/object/detail/actorName. */
  q?: string;
}

/** Dependencies of {@link AuditQueryService} — every one an EXISTING port. */
export interface AuditQueryServiceDependencies {
  /**
   * Optional for the SAME reason it's optional everywhere else it's
   * threaded through (`buildAgent`/`buildDetection`): only absent when the
   * app is composed with neither a database nor an explicit recorder. When
   * absent, agent-execution events are simply not part of the merged feed
   * (never an error — the other three sources still work).
   */
  agentExecutions?: AgentExecutionRecorder;
  approvals: ApprovalEngine;
  workflowStepExecutions: WorkflowStepExecutionRepository;
  workflowInstances: WorkflowInstanceRepository;
  activity: ActivityRepository;
  users: UserRepository;
  workspaces: WorkspaceRepository;
  catalog: DomainCatalog;
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  blocked: 'Blocked',
  failed: 'Failed',
  clarification: 'Needs clarification',
  rejected: 'Rejected',
  proposed: 'Proposed',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  executing: 'Executing',
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  skipped: 'Skipped',
};

/** Humanizes a status value not in the fixed label table (fallback only). */
function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

/** Title-cases a dotted/underscored identifier segment for a module label. */
function humanizeModule(value: string): string {
  const segment = value.includes('.') ? (value.split('.')[0] ?? value) : value;
  return segment
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Title-cases a dotted.snake_case identifier's last segment into a phrase. */
function humanizeAction(value: string): string {
  const segment = value.includes('.') ? (value.split('.').pop() ?? value) : value;
  return segment
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The unified, read-only Audit Center query surface over four existing journals. */
export class AuditQueryService {
  readonly #deps: AuditQueryServiceDependencies;

  constructor(dependencies: AuditQueryServiceDependencies) {
    this.#deps = dependencies;
  }

  /**
   * Lists the tenant's (optionally workspace-scoped) unified audit events,
   * newest first, bounded by `limit`. The caller's authorization has
   * already been established by the route (`audit.read` + trusted scope) —
   * this method trusts `tenantId`/`workspaceId` as given.
   */
  async listEvents(
    scope: { tenantId: TenantId; workspaceId?: WorkspaceId },
    filters: AuditEventFilters,
    limit = 200,
  ): Promise<readonly AuditEventDto[]> {
    // Fetch generously per source (more than the final page size) so
    // filtering + merge-sort across sources doesn't starve any one journal.
    const fetchLimit = Math.max(limit * 2, 200);
    const [agentRows, approvalRows, stepRows, activityRows, workflowInstances] = await Promise.all([
      this.#deps.agentExecutions === undefined
        ? Promise.resolve([] as readonly AgentExecutionRecord[])
        : this.#deps.agentExecutions.listByTenant(scope.tenantId, {
            workspaceId: scope.workspaceId,
            limit: fetchLimit,
          }),
      Promise.resolve(
        this.#deps.approvals.listByTenant(scope.tenantId, {
          workspaceId: scope.workspaceId,
          limit: fetchLimit,
        }),
      ),
      this.#deps.workflowStepExecutions.listByTenant(scope.tenantId, fetchLimit),
      this.#deps.activity.listByWorkspace(scope.tenantId, {
        workspaceId: scope.workspaceId,
        limit: fetchLimit,
      }),
      this.#deps.workflowInstances.listByTenant(scope.tenantId, 500),
    ]);

    const instanceByWorkflowId = new Map(
      workflowInstances.map((instance) => [instance.id, instance]),
    );
    // The correlation key an agent execution's approval gate shares with its
    // approval_requests row — both come from the SAME governed run.
    const approvalByRunId = new Map(
      approvalRows.filter((row) => row.runId !== undefined).map((row) => [row.runId, row]),
    );

    const events: AuditEventDto[] = [];

    for (const row of agentRows) {
      events.push(this.#agentExecutionToEvent(row, approvalByRunId));
    }
    for (const row of approvalRows) {
      events.push(this.#approvalToEvent(row));
    }
    for (const row of stepRows) {
      const instance = instanceByWorkflowId.get(row.workflowId);
      if (
        scope.workspaceId !== undefined &&
        instance?.workspaceId !== undefined &&
        instance.workspaceId !== scope.workspaceId
      ) {
        continue;
      }
      events.push(this.#workflowStepToEvent(row, instance));
    }
    for (const row of activityRows) {
      events.push(this.#activityToEvent(row));
    }

    // Batch-resolve actor + workspace display names (one query per UNIQUE
    // id across the whole page, never per row).
    await this.#resolveActorNames(events);
    await this.#resolveWorkspaceNames(events);

    const filtered = events.filter((event) => this.#matchesFilters(event, filters));
    filtered.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return filtered.slice(0, limit);
  }

  #matchesFilters(event: AuditEventDto, filters: AuditEventFilters): boolean {
    if (filters.source !== undefined && event.source !== filters.source) return false;
    if (filters.status !== undefined && event.status !== filters.status) return false;
    if (filters.actorId !== undefined && event.actorId !== filters.actorId) return false;
    if (filters.from !== undefined && event.occurredAt < filters.from) return false;
    if (filters.to !== undefined && event.occurredAt > filters.to) return false;
    if (filters.q !== undefined && filters.q.trim().length > 0) {
      const needle = filters.q.trim().toLowerCase();
      const haystack = [event.action, event.object, event.detail, event.actorName, event.module]
        .filter((value): value is string => value !== undefined)
        .join(' \n ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }

  #agentExecutionToEvent(
    record: AgentExecutionRecord,
    approvalByRunId: Map<string | undefined, ApprovalRequestRecord>,
  ): AuditEventDto {
    const correlatedApproval =
      record.runId === undefined ? undefined : approvalByRunId.get(record.runId);
    const role = this.#deps.catalog.roles.get(record.roleId);
    const domain = this.#deps.catalog.domains.get(record.domainId);
    const references: Record<string, string> = {
      runId: record.runId ?? '',
      agentId: record.agentId,
    };
    if (record.proposalId !== undefined) references.proposalId = record.proposalId;
    if (record.planId !== undefined) references.planId = record.planId;
    if (record.problemId !== undefined) references.problemId = record.problemId;

    return {
      id: `agx:${record.id}`,
      source: 'agent_execution',
      occurredAt: record.createdAt,
      actorId: record.userId,
      actorName: '',
      roleId: record.roleId,
      roleName: role?.name,
      module: domain?.name ?? humanizeModule(record.domainId),
      action: record.proposalAction ?? `Agent run (${record.agentId})`,
      object: record.planId !== undefined ? `Remediation plan step` : undefined,
      status: record.status,
      statusLabel: statusLabel(record.status),
      workspaceId: record.workspaceId,
      workspaceName: undefined,
      approvalRequired: correlatedApproval !== undefined,
      approvalOutcome:
        correlatedApproval === undefined
          ? undefined
          : {
              status: correlatedApproval.status,
              statusLabel: statusLabel(correlatedApproval.status),
              decidedByName: correlatedApproval.decidedBy,
              decisionReason: correlatedApproval.decisionReason,
            },
      detail: record.reason,
      error: record.status === 'failed' ? record.reason : undefined,
      references,
    };
  }

  #approvalToEvent(record: ApprovalRequestRecord): AuditEventDto {
    const references: Record<string, string> = {
      runId: record.runId,
      stepId: record.stepId,
      conversationId: record.conversationId,
    };
    return {
      id: `apr:${record.id}`,
      source: 'approval',
      occurredAt: record.decidedAt ?? record.createdAt,
      actorId: record.userId,
      actorName: '',
      module: humanizeModule(record.capabilityId),
      action: record.intent,
      object: humanizeAction(record.toolId),
      status: record.status,
      statusLabel: statusLabel(record.status),
      workspaceId: record.workspaceId,
      workspaceName: undefined,
      approvalRequired: true,
      approvalOutcome: {
        status: record.status,
        statusLabel: statusLabel(record.status),
        decidedByName: record.decidedBy,
        decisionReason: record.decisionReason,
      },
      detail: record.reason,
      error: record.error,
      references,
    };
  }

  #workflowStepToEvent(
    row: {
      id: string;
      workflowId: string;
      stepId: string;
      name: string;
      capabilityId: string;
      toolId: string;
      status: string;
      attempt: number;
      approvalId?: string;
      startedAt: string;
      finishedAt?: string;
      error?: string;
    },
    instance: { userId: string; workspaceId?: string; definitionKey: string } | undefined,
  ): AuditEventDto {
    const references: Record<string, string> = {
      workflowId: row.workflowId,
      stepId: row.stepId,
    };
    if (row.approvalId !== undefined) references.approvalId = row.approvalId;
    return {
      id: `wfs:${row.id}`,
      source: 'workflow_step',
      occurredAt: row.finishedAt ?? row.startedAt,
      actorId: instance?.userId,
      actorName: '',
      module:
        instance !== undefined
          ? humanizeModule(instance.definitionKey)
          : humanizeModule(row.capabilityId),
      action: row.name,
      object: humanizeAction(row.toolId),
      status: row.status,
      statusLabel: statusLabel(row.status),
      workspaceId: instance?.workspaceId,
      workspaceName: undefined,
      approvalRequired: row.approvalId !== undefined,
      detail: row.attempt > 1 ? `Attempt ${row.attempt}` : undefined,
      error: row.error,
      references,
    };
  }

  #activityToEvent(item: {
    id: string;
    type: string;
    title: string;
    body: string;
    actorId?: string;
    workspaceId?: string;
    occurredAt: string;
  }): AuditEventDto {
    return {
      id: `act:${item.id}`,
      source: 'activity',
      occurredAt: item.occurredAt,
      actorId: item.actorId,
      actorName: '',
      module: humanizeModule(item.type),
      action: item.title,
      status: 'recorded',
      statusLabel: 'Recorded',
      workspaceId: item.workspaceId,
      workspaceName: undefined,
      approvalRequired: false,
      detail: item.body,
      references: { sourceEventId: item.id },
    };
  }

  /**
   * Batch-resolves actor display names for a page of events — both the
   * requesting actor (`actorId`) AND, when an approval outcome is present,
   * the deciding actor (`approvalOutcome.decidedByName`, which arrives here
   * holding the RAW `decidedBy` user id until this pass rewrites it — never
   * shown to the client unresolved).
   */
  async #resolveActorNames(events: AuditEventDto[]): Promise<void> {
    const ids = new Set<string>();
    for (const event of events) {
      if (event.actorId !== undefined) ids.add(event.actorId);
      if (event.approvalOutcome?.decidedByName !== undefined) {
        ids.add(event.approvalOutcome.decidedByName);
      }
    }
    const names = new Map<string, string>();
    await Promise.all(
      [...ids].map(async (id) => {
        const user = await this.#deps.users.findById(id as UserId);
        if (user !== undefined) {
          const displayName = user.profile.displayName.value;
          names.set(id, displayName.length > 0 ? displayName : user.email.value);
        }
      }),
    );
    for (const event of events) {
      event.actorName =
        event.actorId === undefined ? 'System' : (names.get(event.actorId) ?? 'Unknown user');
      if (event.approvalOutcome?.decidedByName !== undefined) {
        event.approvalOutcome.decidedByName =
          names.get(event.approvalOutcome.decidedByName) ?? 'Unknown user';
      }
    }
  }

  /** Batch-resolves workspace display names for a page of events. */
  async #resolveWorkspaceNames(events: AuditEventDto[]): Promise<void> {
    const workspaceIds = [
      ...new Set(
        events.map((event) => event.workspaceId).filter((id): id is string => id !== undefined),
      ),
    ];
    const workspaceNames = new Map<string, string>();
    await Promise.all(
      workspaceIds.map(async (id) => {
        const workspace = await this.#deps.workspaces.findById(id as WorkspaceId);
        if (workspace !== undefined) {
          workspaceNames.set(id, workspace.name.value);
        }
      }),
    );
    for (const event of events) {
      if (event.workspaceId !== undefined) {
        event.workspaceName = workspaceNames.get(event.workspaceId);
      }
    }
  }
}
