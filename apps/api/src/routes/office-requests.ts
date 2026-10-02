/**
 * @nexora/app-api — office request routes.
 *
 * The everyday requests of an office and the chain each one travels:
 *
 *   leave     employee → their manager → HR
 *   purchase  employee → their manager → Finance
 *   access    employee → their manager → IT
 *
 * Who may take a stage is decided here from the caller's resolved role in the
 * workspace they act from (`requests.approve_*`); the manager stage belongs to
 * a manager of the team the request was raised from. The aggregate enforces
 * the order of the stages and that nobody decides their own request. A request
 * the caller may not see is reported as not found.
 */

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import {
  OFFICE_REQUEST_TYPES,
  OfficeRequest,
  OfficeRequestId,
  type OfficeRequestDetails,
  type OfficeRequestRepository,
  type OfficeRequestStage,
} from '@nexora/domain-hr';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  hasPermission,
  resolveEffectivePermissions,
  type EffectivePermissions,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { toHttpError } from '../http/errors.js';
import {
  denyScope,
  officeScopeDenial,
  officeScopeProperties,
  officeScopeQuery,
  roleContextOf,
  type OfficeScope,
} from './office-scope.js';
import { sendForbidden } from './permission-response.js';

/** The capability that grants the decision authority of each stage. */
const STAGE_CAPABILITY: Record<OfficeRequestStage, string> = {
  manager: 'requests.approve_manager',
  hr: 'requests.approve_hr',
  finance: 'requests.approve_finance',
  it: 'requests.approve_it',
};

/** The role with nobody above it: its requests need no manager decision. */
const EXECUTIVE_ROLE_ID = 'executive.ceo';

const idParams = {
  type: 'object',
  required: ['requestId'],
  additionalProperties: false,
  properties: { requestId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const submitSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'type', 'reason'],
    additionalProperties: false,
    properties: {
      ...officeScopeProperties,
      type: { type: 'string', enum: Object.keys(OFFICE_REQUEST_TYPES) },
      reason: { type: 'string', minLength: 5, maxLength: 1000 },
      // leave
      kind: { type: 'string', enum: ['vacation', 'sick', 'personal'] },
      startDate: { type: 'string', minLength: 10, maxLength: 10 },
      endDate: { type: 'string', minLength: 10, maxLength: 10 },
      // purchase
      item: { type: 'string', minLength: 2, maxLength: 160 },
      amountMinorUnits: { type: 'integer', minimum: 1, maximum: 100_000_000_000 },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
      // access
      what: { type: 'string', minLength: 2, maxLength: 160 },
    },
  },
};

const decisionSchema: FastifySchema = {
  params: idParams,
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'decision'],
    additionalProperties: false,
    properties: {
      ...officeScopeProperties,
      decision: { type: 'string', enum: ['approve', 'reject'] },
      comment: { type: 'string', maxLength: 1000 },
    },
  },
};

const withdrawSchema: FastifySchema = {
  params: idParams,
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId'],
    additionalProperties: false,
    properties: officeScopeProperties,
  },
};

const listSchema: FastifySchema = { querystring: officeScopeQuery };

/** Dependencies of the office request routes. */
export interface OfficeRequestRoutesDependencies {
  requests: OfficeRequestRepository;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
  /** Display name of a user of the trusted tenant (never an email or id leak). */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
}

type SubmitBody = OfficeScope & {
  type: string;
  reason: string;
  kind?: string;
  startDate?: string;
  endDate?: string;
  item?: string;
  amountMinorUnits?: number;
  currency?: string;
  what?: string;
};

/** Registers the office request routes. */
export function registerOfficeRequestRoutes(
  app: FastifyInstance,
  dependencies: OfficeRequestRoutesDependencies,
): void {
  const notFound = (reply: FastifyReply, requestId: string) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Request not found', requestId } });
  const fail = (reply: FastifyReply, requestId: string, error: unknown) => {
    const http = toHttpError(error, requestId);
    return reply.code(http.statusCode).send(http.body);
  };

  /** Whether the caller holds a stage's authority for THIS request, from where they act. */
  const holdsStage = (
    request: OfficeRequest,
    stage: OfficeRequestStage,
    scope: OfficeScope,
    effective: EffectivePermissions | undefined,
  ): boolean =>
    hasPermission(effective, STAGE_CAPABILITY[stage]) &&
    // The manager stage belongs to a manager of the team the request came from.
    (stage !== 'manager' || scope.workspaceId === request.workspaceId);

  /** Whether the caller may see this request: their own, one they take part in, or all. */
  const visible = (
    request: OfficeRequest,
    userId: string,
    scope: OfficeScope,
    effective: EffectivePermissions | undefined,
  ): boolean =>
    request.requestedBy === userId ||
    hasPermission(effective, 'requests.read') ||
    request.stages.some((stage) => holdsStage(request, stage, scope, effective));

  async function view(
    request: OfficeRequest,
    userId: string,
    scope: OfficeScope,
    effective: EffectivePermissions | undefined,
  ) {
    const snapshot = OfficeRequest.snapshot(request);
    const names = new Map<string, string | undefined>();
    const nameOf = async (id: string): Promise<string | undefined> => {
      if (!names.has(id)) names.set(id, await dependencies.resolveUserName?.(id));
      return names.get(id);
    };
    const history = [];
    for (const entry of snapshot.history) {
      const actorName = await nameOf(entry.actorId);
      history.push({ ...entry, ...(actorName === undefined ? {} : { actorName }) });
    }
    const requestedByName = await nameOf(snapshot.requestedBy);
    const pending = request.pendingStage;
    const mine = pending !== undefined && holdsStage(request, pending, scope, effective);
    const blocker = mine ? request.decisionBlocker(userId) : undefined;
    const stages = snapshot.stages.map((stage, index) => {
      const entry = snapshot.history.find((item) => item.stage === stage);
      const state =
        entry?.action === 'approved'
          ? 'done'
          : entry?.action === 'not_required'
            ? 'skipped'
            : entry?.action === 'rejected'
              ? 'returned'
              : snapshot.status === 'pending' && index === snapshot.stageIndex
                ? 'current'
                : 'waiting';
      return { stage, state };
    });
    return {
      id: snapshot.id,
      type: snapshot.details.type,
      details: snapshot.details,
      status: snapshot.status,
      ...(pending === undefined ? {} : { pendingStage: pending }),
      stages,
      requestedBy: snapshot.requestedBy,
      ...(requestedByName === undefined ? {} : { requestedByName }),
      mine: snapshot.requestedBy === userId,
      history,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      actions: {
        canDecide: mine && blocker === undefined,
        ...(blocker === undefined || !mine ? {} : { decideBlockedReason: blocker }),
        canWithdraw: snapshot.requestedBy === userId && snapshot.status === 'pending',
      },
    };
  }

  function detailsOf(body: SubmitBody): OfficeRequestDetails {
    switch (body.type) {
      case 'leave':
        return {
          type: 'leave',
          kind: (body.kind ?? 'vacation') as never,
          startDate: body.startDate ?? '',
          endDate: body.endDate ?? '',
          reason: body.reason,
        };
      case 'purchase':
        return {
          type: 'purchase',
          item: body.item ?? '',
          amountMinorUnits: body.amountMinorUnits ?? 0,
          currency: (body.currency ?? '').toUpperCase(),
          reason: body.reason,
        };
      default:
        return { type: 'access', what: body.what ?? '', reason: body.reason };
    }
  }

  async function load(organizationId: string, requestId: string) {
    let id: OfficeRequestId;
    try {
      id = OfficeRequestId.from(requestId);
    } catch {
      return undefined;
    }
    const request = await dependencies.requests.findById(id);
    return request === undefined || request.organizationId !== organizationId ? undefined : request;
  }

  // --- Raise ---------------------------------------------------------------

  app.post('/api/requests', { schema: submitSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as SubmitBody;
    const denial = await officeScopeDenial(dependencies, auth.userId, body);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, body),
      'requests.create',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'raise a request');

    const details = detailsOf(body);
    // A stage the requester would have to decide themselves is not required:
    // the executive has no manager, and a function's own head needs no sign-off
    // from their own function.
    const notRequired = OFFICE_REQUEST_TYPES[details.type].stages.filter((stage) =>
      stage === 'manager'
        ? authz.effective.roleId === EXECUTIVE_ROLE_ID
        : hasPermission(authz.effective, STAGE_CAPABILITY[stage]),
    );
    let created: OfficeRequest;
    try {
      created = OfficeRequest.submit({
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        requestedBy: auth.userId,
        details,
        notRequired,
      });
    } catch (error) {
      return fail(reply, request.id, error);
    }
    await dependencies.requests.insert(created);
    return reply
      .code(201)
      .send({ request: await view(created, auth.userId, body, authz.effective) });
  });

  // --- List ----------------------------------------------------------------

  app.get('/api/requests', { schema: listSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const scope = request.query as OfficeScope;
    const denial = await officeScopeDenial(dependencies, auth.userId, scope);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const effective = await resolveEffectivePermissions(
      dependencies.permissions,
      roleContextOf(auth.userId, scope),
    );
    const all = await dependencies.requests.listByOrganization(scope.organizationId as TenantId);
    const requests = [];
    for (const item of all) {
      if (visible(item, auth.userId, scope, effective)) {
        requests.push(await view(item, auth.userId, scope, effective));
      }
    }
    return { requests, canCreate: hasPermission(effective, 'requests.create') };
  });

  // --- Decide --------------------------------------------------------------

  app.post(
    '/api/requests/:requestId/decision',
    { schema: decisionSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const body = request.body as OfficeScope & {
        decision: 'approve' | 'reject';
        comment?: string;
      };
      const { requestId } = request.params as { requestId: string };
      const denial = await officeScopeDenial(dependencies, auth.userId, body);
      if (denial !== undefined) return denyScope(reply, request.id, denial);
      const effective = await resolveEffectivePermissions(
        dependencies.permissions,
        roleContextOf(auth.userId, body),
      );
      const found = await load(body.organizationId, requestId);
      if (found === undefined || !visible(found, auth.userId, body, effective)) {
        return notFound(reply, request.id);
      }
      const stage = found.pendingStage;
      // The stage's authority: 'requests.approve_manager' (for the request's own
      // team), 'requests.approve_hr', 'requests.approve_finance' or 'requests.approve_it'.
      const authz =
        stage === undefined
          ? { ok: false as const }
          : await authorizePermission(
              dependencies.permissions,
              roleContextOf(auth.userId, body),
              STAGE_CAPABILITY[stage],
            );
      if (stage === undefined || !authz.ok || !holdsStage(found, stage, body, effective)) {
        return sendForbidden(reply, request.id, 'decide this request at its current stage');
      }
      const loaded = found.version;
      try {
        found.decide({
          stage,
          decision: body.decision,
          actorId: auth.userId,
          ...(body.comment === undefined ? {} : { comment: body.comment }),
        });
      } catch (error) {
        return fail(reply, request.id, error);
      }
      if (!(await dependencies.requests.update(found, loaded))) {
        return reply.code(409).send({
          error: {
            code: 'CONFLICT',
            message: 'The request was changed by someone else — reload and try again',
            requestId: request.id,
          },
        });
      }
      return { request: await view(found, auth.userId, body, effective) };
    },
  );

  // --- Withdraw ------------------------------------------------------------

  app.post(
    '/api/requests/:requestId/withdraw',
    { schema: withdrawSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const body = request.body as OfficeScope;
      const { requestId } = request.params as { requestId: string };
      const denial = await officeScopeDenial(dependencies, auth.userId, body);
      if (denial !== undefined) return denyScope(reply, request.id, denial);
      const authz = await authorizePermission(
        dependencies.permissions,
        roleContextOf(auth.userId, body),
        'requests.create',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'withdraw a request');
      const found = await load(body.organizationId, requestId);
      if (found === undefined || !visible(found, auth.userId, body, authz.effective)) {
        return notFound(reply, request.id);
      }
      const loaded = found.version;
      try {
        found.withdraw(auth.userId);
      } catch (error) {
        return fail(reply, request.id, error);
      }
      if (!(await dependencies.requests.update(found, loaded))) {
        return reply.code(409).send({
          error: {
            code: 'CONFLICT',
            message: 'The request was changed by someone else — reload and try again',
            requestId: request.id,
          },
        });
      }
      return { request: await view(found, auth.userId, body, authz.effective) };
    },
  );
}
