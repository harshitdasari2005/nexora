/**
 * @nexora/app-api — proactive detection composition (S27).
 *
 * Wires the GENERIC detection engine (`@nexora/module-detection`) with the
 * API-layer implementations:
 *
 * - The TRUSTED snapshot loader reads the EXISTING tenant/workspace-scoped
 *   application handlers (measurements, projects, notifications, activity)
 *   and the S26 agent-execution journal — the same data surface the S26
 *   agent proposals read. Every source is already scoped by the route's
 *   trusted context; a source that fails resolves to an empty section
 *   (fail safe) — a broken source never invents evidence.
 * - Solution discovery reuses the EXISTING permission-filtered knowledge
 *   retrieval seam (`RetrieveKnowledgeHandler`) and the execution journal
 *   (previous governed runs as precedents) — never a second search
 *   infrastructure.
 * - The problem provider surfaces the detected problems through the
 *   BusinessAgent engine's port: the agent DTO carries them, and their
 *   action proposals merge into the agent's proposal list (execution flows
 *   through the SAME governed proposal-execution path).
 *
 * Pure composition: the engine is unchanged; a new signal is one more
 * registration in the seed.
 */

import type { RetrieveKnowledgeHandler } from '@nexora/application-knowledge';
import type { GetTenantMeasurementsHandler } from '@nexora/module-measurements';
import type { ListProjectsHandler } from '@nexora/application-projects';
import type { ListActivityHandler, ListNotificationsHandler } from '@nexora/module-notifications';
import type { ListBudgetUtilizationHandler } from '@nexora/application-finance';
import type { AgentExecutionRecorder } from '@nexora/module-agents';
import {
  BusinessSignalRegistry,
  DetectionApplicationService,
  GetProblemHandler,
  INITIAL_SIGNALS,
  InvestigationEngine,
  ListProblemsByIdsHandler,
  ListProblemsHandler,
  ReevaluateProblemHandler,
  ScanProblemsHandler,
  SolutionDiscovery,
  type DetectionSnapshot,
  type DetectionSnapshotLoader,
} from '@nexora/module-detection';
import type { EventPublisher } from '@nexora/shared/events';
import { createEventEnvelope } from '@nexora/shared/events';
import type { AgentProblemProvider } from '@nexora/module-agents';
import type { ProblemStore } from '@nexora/module-detection';
import type { ProblemStatus } from '@nexora/contracts/detection';
import { nowIso } from '@nexora/shared/time';

/** The bounds of the snapshot sections (S22 — never full scans). */
const SNAPSHOT_SECTION_LIMIT = 20;

/** Everything the API layer needs to compose the detection surface. */
export interface BuildDetectionOptions {
  /** The tenant measurement snapshot handler (workflow health + onboarding + audit). */
  getTenantMeasurements: GetTenantMeasurementsHandler;
  /** Tenant-scoped project listing handler. */
  listProjects: ListProjectsHandler;
  /** Tenant/workspace-scoped activity feed handler. */
  listActivity: ListActivityHandler;
  /** Recipient-scoped notification inbox handler. */
  listNotifications: ListNotificationsHandler;
  /** Workspace-scoped budget-utilization handler (finance section, S35). */
  listBudgetUtilization?: ListBudgetUtilizationHandler;
  /** The permission-filtered knowledge retrieval handler (existing search seam). */
  retrieveKnowledge: RetrieveKnowledgeHandler;
  /** The S26 execution journal (agent-execution evidence + precedents). */
  executionRecorder?: AgentExecutionRecorder;
  /** The durable problem store (defaults to the PostgreSQL store in app.ts). */
  problemStore: ProblemStore;
  /**
   * The event publisher (S27 §15 proactive notifications). When present, a
   * `problem.detected` event is published ONCE per newly-created problem
   * (the notification consumer's idempotency key dedupes re-detection).
   */
  publisher?: EventPublisher;
}

/** The composed detection surface. */
export interface DetectionSurface {
  /** Scans + lists the scope's problems (used by the agent problem provider). */
  scan: ScanProblemsHandler;
  /** Lists the scope's problems without re-evaluating signals. */
  list: ListProblemsHandler;
  /** Resolves one problem by id (tenant-scoped; forged ids resolve to nothing). */
  getById: GetProblemHandler;
  /** Resolves MANY problems by id in ONE snapshot (Phase 10 plan-list reads). */
  listByIds: ListProblemsByIdsHandler;
  /** Re-evaluates ONE problem deterministically (Phase 10 re-evaluation seam). */
  reevaluate: ReevaluateProblemHandler;
  /**
   * Transitions a problem's lifecycle deterministically (Phase 10 lifecycle
   * port). Returns false for forged/foreign ids or illegal transitions.
   */
  transition: (
    scope: { userId: string; tenantId: string; workspaceId?: string },
    problemId: string,
    status: ProblemStatus,
    now: string,
  ) => Promise<boolean>;
  /** The agent DTO problem provider (S27 agent integration). */
  problems: AgentProblemProvider;
}

/** Builds the proactive detection surface (generic engine + API implementations). */
export function buildDetection(options: BuildDetectionOptions): DetectionSurface {
  const registry = new BusinessSignalRegistry();
  for (const definition of INITIAL_SIGNALS) {
    registry.register(definition);
  }
  const snapshotLoader: DetectionSnapshotLoader = new ApiDetectionSnapshotLoader({
    getTenantMeasurements: options.getTenantMeasurements,
    listProjects: options.listProjects,
    listActivity: options.listActivity,
    listNotifications: options.listNotifications,
    listBudgetUtilization: options.listBudgetUtilization,
    executionRecorder: options.executionRecorder,
  });
  const service = new DetectionApplicationService({
    registry,
    snapshotLoader,
    investigation: new InvestigationEngine(),
    discovery: new SolutionDiscovery({
      // EXISTING knowledge seam: permission-filtered, workspace-scoped.
      // Fails safe on error (the discovery engine catches).
      searchKnowledge: async (context) => {
        const result = await options.retrieveKnowledge.handle({
          tenantId: context.tenantId as never,
          workspaceId: context.workspaceId as never,
          query: context.query,
          limit: context.limit,
        });
        return result.ok
          ? result.value.references.map((reference) => ({
              sourceId: reference.sourceId,
              title: reference.title,
              snippet: reference.snippet,
              kind: reference.kind,
            }))
          : [];
      },
      listExecutions: async (context) => {
        if (options.executionRecorder === undefined) {
          return [];
        }
        return options.executionRecorder.listRecent(context, context.limit);
      },
    }),
    store: options.problemStore,
    onProblemCreated:
      options.publisher === undefined
        ? undefined
        : async (problem) => {
            // The actor is the TRUSTED user whose scope detected the
            // problem (the notification policy notifies the event actor —
            // never a client/AI-chosen recipient). The correlation id IS
            // the problem's deterministic identity, so the consumer's
            // (tenant, source_event, recipient) idempotency key makes a
            // re-detected problem a no-op — never infinite notifications.
            await options.publisher?.publish([
              createEventEnvelope({
                // Deterministic event id from the problem identity: the
                // notification consumer's (tenant, source_event, recipient)
                // idempotency key then makes even a re-published event a
                // no-op — a re-detected problem can never re-notify.
                id: `evt_${problem.correlationId.slice(-48)}`,
                type: 'problem.detected',
                version: 1,
                tenantId: problem.tenantId,
                workspaceId: problem.workspaceId,
                correlationId: problem.correlationId,
                actor: { kind: 'user', id: problem.userId },
                payload: {
                  problemId: problem.id,
                  title: problem.title,
                  severity: problem.severity,
                },
                metadata: {
                  version: 1,
                  category: 'platform',
                  priority: problem.severity === 'high' ? 'high' : 'normal',
                  deliverySemantics: 'at_least_once',
                },
              }),
            ]);
          },
  });
  return {
    scan: new ScanProblemsHandler(service),
    list: new ListProblemsHandler(service),
    getById: new GetProblemHandler(service),
    listByIds: new ListProblemsByIdsHandler(service),
    reevaluate: new ReevaluateProblemHandler(service),
    transition: (scope, problemId, status, now) =>
      service.transition(scope, problemId, status, now),
    // The agent DTO problem provider: scans on every agent resolve so the
    // problems console is always current (dedupe keeps it idempotent). The
    // agent's registered capability set bounds the problem-derived action
    // proposals (fail closed — a problem can never recommend an action
    // beyond the caller's agent set).
    problems: {
      list: async (context, agent) => {
        const result = await service.scan({
          userId: context.userId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          agentCapabilityIds: agent.capabilityIds,
        });
        return result.ok ? result.problems : [];
      },
    },
  };
}

/** Dependencies of the {@link ApiDetectionSnapshotLoader}. */
interface SnapshotLoaderDependencies {
  getTenantMeasurements: GetTenantMeasurementsHandler;
  listProjects: ListProjectsHandler;
  listActivity: ListActivityHandler;
  listNotifications: ListNotificationsHandler;
  listBudgetUtilization?: ListBudgetUtilizationHandler;
  executionRecorder?: AgentExecutionRecorder;
}

/**
 * Builds the TRUSTED detection snapshot from the EXISTING application
 * handlers. Every source is called with the trusted scope; a failing source
 * resolves to an empty section (fail safe) — the engine never sees
 * fabricated data.
 */
class ApiDetectionSnapshotLoader implements DetectionSnapshotLoader {
  readonly #deps: SnapshotLoaderDependencies;

  constructor(dependencies: SnapshotLoaderDependencies) {
    this.#deps = dependencies;
  }

  async load(context: {
    tenantId: string;
    workspaceId?: string;
    userId: string;
  }): Promise<DetectionSnapshot> {
    const [measurements, projects, notifications, activity, budgetUtilization, executions] =
      await Promise.all([
        this.#safe(() =>
          this.#deps.getTenantMeasurements.handle({ tenantId: context.tenantId as never }),
        ),
        this.#safe(async () => {
          const result = await this.#deps.listProjects.handle({
            organizationId: context.tenantId as never,
          });
          return result.ok ? result.value.slice(0, SNAPSHOT_SECTION_LIMIT) : [];
        }),
        this.#safe(async () => {
          const result = await this.#deps.listNotifications.handle({
            userId: context.userId as never,
            tenantId: context.tenantId as never,
            ...(context.workspaceId === undefined
              ? {}
              : { workspaceId: context.workspaceId as never }),
            limit: SNAPSHOT_SECTION_LIMIT,
          });
          return result.ok
            ? result.value.notifications
                .filter((notification) => notification.status === 'unread')
                .slice(0, SNAPSHOT_SECTION_LIMIT)
            : [];
        }),
        this.#safe(async () => {
          const result = await this.#deps.listActivity.handle({
            tenantId: context.tenantId as never,
            ...(context.workspaceId === undefined
              ? {}
              : { workspaceId: context.workspaceId as never }),
            limit: SNAPSHOT_SECTION_LIMIT,
          });
          return result.ok ? result.value.activity.slice(0, SNAPSHOT_SECTION_LIMIT) : [];
        }),
        this.#deps.listBudgetUtilization === undefined || context.workspaceId === undefined
          ? Promise.resolve([])
          : this.#safe(async () => {
              if (
                this.#deps.listBudgetUtilization === undefined ||
                context.workspaceId === undefined
              ) {
                return [];
              }
              const result = await this.#deps.listBudgetUtilization.handle({
                organizationId: context.tenantId as never,
                workspaceId: context.workspaceId as never,
              });
              return result.ok ? result.value.slice(0, SNAPSHOT_SECTION_LIMIT) : [];
            }),
        this.#deps.executionRecorder === undefined
          ? Promise.resolve([])
          : this.#safe(async () => {
              if (this.#deps.executionRecorder === undefined) {
                return [];
              }
              return this.#deps.executionRecorder.listRecent(
                {
                  userId: context.userId,
                  tenantId: context.tenantId,
                  workspaceId: context.workspaceId,
                },
                SNAPSHOT_SECTION_LIMIT,
              );
            }),
      ]);

    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      generatedAt: nowIso(),
      workflowHealth: (measurements?.workflowHealth ?? []).slice(0, SNAPSHOT_SECTION_LIMIT),
      onboarding: (measurements?.onboarding ?? []).slice(0, SNAPSHOT_SECTION_LIMIT),
      auditCompleteness:
        measurements === undefined
          ? undefined
          : {
              traceableShare: measurements.auditCompleteness.traceableShare,
              totalEvents: measurements.auditCompleteness.totalEvents,
            },
      projects: projects ?? [],
      notifications: notifications ?? [],
      activity: activity ?? [],
      agentExecutions: (executions ?? []).map((run) => ({
        id: run.id,
        agentId: run.agentId,
        status: run.status,
        proposalAction: run.proposalAction,
        createdAt: run.createdAt,
      })),
      documentCount: measurements?.overview.documents,
      budgets: (budgetUtilization ?? []).map((entry) => ({
        budgetId: entry.budgetId,
        name: entry.name,
        currency: entry.currency,
        allocatedMinorUnits: entry.allocatedMinorUnits,
        spentMinorUnits: entry.spentMinorUnits,
        status: entry.status,
      })),
    };
  }

  /** Runs a source handler; failures resolve to `undefined` (fail safe). */
  async #safe<T>(run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run();
    } catch {
      return undefined;
    }
  }
}
