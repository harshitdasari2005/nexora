/**
 * @nexora/app-api — Runtime observability routes (Prompt 7).
 *
 * `GET /api/ops/runtime/runs` · `/runs/:runId` · `/metrics` — the operator view
 * of HOW the AI runtime performed. It complements the Audit Center (what
 * happened) and Lineage (what data was connected); it reads only the
 * append-only `runtime_runs` records and adds no write path.
 *
 * Security contract (the SAME model as the Audit Center):
 * 1. organization membership, 2. workspace membership, 3. RBAC `audit.read`.
 * Data is tenant-scoped; a run id from another tenant is indistinguishable
 * from a missing one (404). Telemetry is descriptive: nothing here is an
 * input to authorization, policy or approval, and nothing here carries
 * prompts, tool arguments, documents or secrets.
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import {
  RUNTIME_STAGES,
  bottleneckOf,
  summarize,
  type FailureClass,
  type RuntimeOrigin,
  type RuntimeRun,
  type RuntimeRunQuery,
  type RuntimeRunRepository,
  type RuntimeStage,
  type RuntimeStatus,
} from '@nexora/module-observability';

import type { ApprovalEngine } from '@nexora/ai-runtime';
import type { LineageRepository } from '@nexora/module-lineage';

import { buildRunGovernance } from '../observability/run-governance.js';
import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';

const STATUSES: readonly string[] = ['completed', 'failed', 'blocked', 'clarification'];
const ORIGINS: readonly string[] = [
  'chat',
  'agent',
  'mcp',
  'remediation',
  'workflow',
  'orchestrator',
];
const CLASSES: readonly string[] = [
  'DENIED',
  'APPROVAL',
  'INPUT',
  'EXECUTION',
  'VERIFICATION',
  'INFRASTRUCTURE',
  'TIMEOUT',
  'INTERNAL',
];
const METRICS_SAMPLE_CAP = 5000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Dependencies of the runtime observability routes. */
export interface RuntimeOpsRoutesDependencies {
  runs: RuntimeRunRepository;
  /** The approval store joined into the run's `governance` block (tenant-scoped). */
  approvals: ApprovalEngine;
  /** The append-only lineage joined into the run's `governance` block (tenant-scoped). */
  lineage: LineageRepository;
  /** Optional display-name resolver for the governance actors (names only). */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  permissions: PermissionResolverDependencies;
  /** Injectable clock for the default metrics window. */
  now?: () => Date;
}

interface ScopeQuery {
  organizationId?: string;
  workspaceId?: string;
}

async function authorizeScope(
  dependencies: RuntimeOpsRoutesDependencies,
  userId: string,
  organizationId: string,
  workspaceId: string,
): Promise<string | undefined> {
  const membership = await dependencies.listOrganizations.handle({ userId: userId as UserId });
  if (!(membership.ok && membership.value.some((org) => org.id === organizationId))) {
    return 'You are not a member of this organization';
  }
  const workspaces = await dependencies.listMyWorkspaces.handle({
    userId: userId as UserId,
    organizationId: organizationId as TenantId,
  });
  if (!(workspaces.ok && workspaces.value.some((workspace) => workspace.id === workspaceId))) {
    return 'You are not a member of this workspace';
  }
  return undefined;
}

const isoOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

/** One row of the run timeline (a stage, with the ids and safe metadata inside it). */
export interface TimelineEntry {
  stage: RuntimeStage;
  durationMs: number;
  count: number;
  status: 'ok' | 'failed';
  items: readonly Record<string, unknown>[];
}

/** Builds the REQUEST → … → NARRATION timeline from the recorded run only (nothing invented). */
export function buildTimeline(run: RuntimeRun): readonly TimelineEntry[] {
  return RUNTIME_STAGES.flatMap((stage) => {
    const timing = run.stages.find((entry) => entry.stage === stage);
    const failed = run.failure?.stage === stage;
    if (timing === undefined && !failed) {
      return [];
    }
    let items: Record<string, unknown>[] = [];
    if (stage === 'EXECUTION' || stage === 'RETRIEVAL') {
      const retrieval = stage === 'RETRIEVAL';
      items = run.tools
        .filter(
          (tool) =>
            (tool.toolId === 'knowledge.search' || tool.toolId === 'documents.search') ===
            retrieval,
        )
        .map((tool) => ({
          invocationId: tool.invocationId,
          toolId: tool.toolId,
          origin: tool.origin,
          status: tool.status,
          durationMs: tool.durationMs,
          startOffsetMs: tool.startOffsetMs,
          attempts: tool.attempts,
          ...(tool.errorCode === undefined ? {} : { errorCode: tool.errorCode }),
          ...(tool.policy === undefined ? {} : { policy: tool.policy }),
          ...(tool.delegationId === undefined ? {} : { delegationId: tool.delegationId }),
          ...(tool.approvalId === undefined ? {} : { approvalId: tool.approvalId }),
          verified: tool.verified,
        }));
    } else if (stage === 'POLICY') {
      items = run.policies.map((policy) => ({ ...policy }));
    } else if (stage === 'APPROVAL' && run.approval !== undefined) {
      items = [{ ...run.approval }];
    } else if (stage === 'NARRATION') {
      items = run.models.map((model) => ({ ...model }));
    }
    return [
      {
        stage,
        durationMs: timing?.durationMs ?? 0,
        count: timing?.count ?? 0,
        status: failed ? ('failed' as const) : ('ok' as const),
        items,
      },
    ];
  });
}

/** Registers the runtime observability routes. */
export function registerRuntimeOpsRoutes(
  app: FastifyInstance,
  dependencies: RuntimeOpsRoutesDependencies,
): void {
  const authorize = async (
    request: Parameters<typeof requireAuth>[0],
    reply: { code(code: number): { send(payload: unknown): unknown } },
    query: ScopeQuery,
  ): Promise<{ tenantId: string } | undefined> => {
    const auth = requireAuth(request);
    if (query.organizationId === undefined || query.workspaceId === undefined) {
      reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameters: organizationId, workspaceId',
          requestId: request.id,
        },
      });
      return undefined;
    }
    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      query.organizationId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
      return undefined;
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      'audit.read',
    );
    if (!authz.ok) {
      sendForbidden(reply as never, request.id, 'view runtime telemetry');
      return undefined;
    }
    return { tenantId: query.organizationId };
  };

  const readFilters = (query: Record<string, string | undefined>): RuntimeRunQuery => {
    const from = isoOrUndefined(query['from']);
    const to = isoOrUndefined(query['to']);
    return {
      ...(query['filterWorkspaceId'] ? { workspaceId: query['filterWorkspaceId'] } : {}),
      ...(query['status'] !== undefined && STATUSES.includes(query['status'])
        ? { status: query['status'] as RuntimeStatus }
        : {}),
      ...(query['failureStage'] !== undefined &&
      (RUNTIME_STAGES as readonly string[]).includes(query['failureStage'])
        ? { failureStage: query['failureStage'] as RuntimeStage }
        : {}),
      ...(query['failureClass'] !== undefined && CLASSES.includes(query['failureClass'])
        ? { failureClass: query['failureClass'] as FailureClass }
        : {}),
      ...(query['origin'] !== undefined && ORIGINS.includes(query['origin'])
        ? { origin: query['origin'] as RuntimeOrigin }
        : {}),
      ...(query['provider'] ? { provider: query['provider'] } : {}),
      ...(query['model'] ? { model: query['model'] } : {}),
      ...(query['agentId'] ? { agentId: query['agentId'] } : {}),
      ...(query['actorId'] ? { actorId: query['actorId'] } : {}),
      ...(query['requestId'] ? { requestId: query['requestId'] } : {}),
      // Correlation filters: the run that opened/resumed/executed under an approval,
      // or that executed a given tool invocation.
      ...(query['approvalId'] ? { approvalId: query['approvalId'] } : {}),
      ...(query['invocationId'] ? { invocationId: query['invocationId'] } : {}),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    };
  };

  app.get('/api/ops/runtime/runs', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const scope = await authorize(request, reply, query);
    if (scope === undefined) return reply;
    const limitRaw = query['limit'] === undefined ? undefined : Number(query['limit']);
    const limit =
      limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, 200)
        : 50;
    const runs = await dependencies.runs.list(scope.tenantId, { ...readFilters(query), limit });
    return { runs };
  });

  app.get('/api/ops/runtime/runs/:runId', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const scope = await authorize(request, reply, query);
    if (scope === undefined) return reply;
    const { runId } = request.params as { runId: string };
    const run = await dependencies.runs.get(scope.tenantId, runId);
    if (run === undefined) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'No runtime run found', requestId: request.id },
      });
    }
    const governance = await buildRunGovernance(
      {
        approvals: dependencies.approvals,
        lineage: dependencies.lineage,
        ...(dependencies.resolveUserName === undefined
          ? {}
          : { resolveUserName: dependencies.resolveUserName }),
      },
      scope.tenantId,
      run,
    );
    return { run, timeline: buildTimeline(run), bottleneck: bottleneckOf(run), governance };
  });

  app.get('/api/ops/runtime/metrics', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const scope = await authorize(request, reply, query);
    if (scope === undefined) return reply;
    const now = (dependencies.now ?? (() => new Date()))();
    const filters = readFilters(query);
    const to = filters.to ?? now.toISOString();
    const from = filters.from ?? new Date(new Date(to).getTime() - DEFAULT_WINDOW_MS).toISOString();
    const runs = await dependencies.runs.list(scope.tenantId, {
      ...filters,
      from,
      to,
      limit: METRICS_SAMPLE_CAP,
    });
    return {
      window: { from, to },
      scope: {
        tenantId: scope.tenantId,
        ...(filters.workspaceId === undefined ? {} : { workspaceId: filters.workspaceId }),
      },
      // The sample is capped; when it is reached the window is truncated (newest runs win).
      truncated: runs.length >= METRICS_SAMPLE_CAP,
      summary: summarize(runs),
    };
  });
}
