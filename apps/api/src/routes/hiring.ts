/**
 * @nexora/app-api — hiring requisition routes.
 *
 * The office hiring chain: a team raises a hiring request, the chief
 * executive decides, then Finance decides; a rejection sends it back to the
 * requester, who revises and resubmits (or withdraws).
 *
 * Authorization, on every endpoint:
 * 1. the caller is a member of the organization AND of the workspace they are
 *    acting from (the scope they name is verified, never trusted);
 * 2. their business role in THAT workspace holds the capability the step needs
 *    (`requisitions.create` to raise, `requisitions.approve_executive` /
 *    `requisitions.approve_finance` to decide a stage, `requisitions.read` to
 *    see everyone's requests);
 * 3. the aggregate enforces the chain itself — the stage must be the one the
 *    request is waiting at, nobody decides their own request, nobody decides
 *    two stages of one round.
 *
 * A request the caller may not see is reported exactly like one that does not
 * exist (404). The decider, the requester and the stage are always derived on
 * the server; nothing in the body can name them.
 */

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import {
  toHiringRequisitionDto,
  toJobOpeningDto,
  type HiringRequisitionApplicationService,
  type HiringRequisitionDto,
  type RecruitingApplicationService,
} from '@nexora/application-hr';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { HiringRequisition, RequisitionDetails, RequisitionStage } from '@nexora/domain-hr';
import type { ProjectRepository } from '@nexora/domain-projects';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  hasPermission,
  resolveEffectivePermissions,
  type EffectivePermissions,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { toHttpError } from '../http/errors.js';
import { sendForbidden } from './permission-response.js';

/** The capability that grants the decision authority of each stage. */
const STAGE_CAPABILITY: Record<RequisitionStage, string> = {
  executive: 'requisitions.approve_executive',
  finance: 'requisitions.approve_finance',
};

const scopeProperties = {
  organizationId: { type: 'string', minLength: 1, maxLength: 64 },
  workspaceId: { type: 'string', minLength: 1, maxLength: 64 },
} as const;

const detailProperties = {
  jobTitle: { type: 'string', minLength: 2, maxLength: 120 },
  department: { type: 'string', minLength: 1, maxLength: 80 },
  projectId: { type: 'string', minLength: 1, maxLength: 64 },
  headcount: { type: 'integer', minimum: 1, maximum: 50 },
  employmentType: { type: 'string', enum: ['full_time', 'part_time', 'contract', 'intern'] },
  salaryMinMinorUnits: { type: 'integer', minimum: 0, maximum: 100_000_000_000 },
  salaryMaxMinorUnits: { type: 'integer', minimum: 0, maximum: 100_000_000_000 },
  currency: { type: 'string', minLength: 3, maxLength: 3 },
  justification: { type: 'string', minLength: 10, maxLength: 2000 },
  urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
  targetStartDate: { type: 'string', minLength: 10, maxLength: 10 },
} as const;

const REQUIRED_DETAILS = [
  'jobTitle',
  'department',
  'headcount',
  'employmentType',
  'salaryMinMinorUnits',
  'salaryMaxMinorUnits',
  'currency',
  'justification',
  'urgency',
] as const;

const idParams = {
  type: 'object',
  required: ['requisitionId'],
  additionalProperties: false,
  properties: { requisitionId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const scopeQuery = {
  type: 'object',
  required: ['organizationId', 'workspaceId'],
  properties: scopeProperties,
} as const;

const submitSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', ...REQUIRED_DETAILS],
    additionalProperties: false,
    properties: { ...scopeProperties, ...detailProperties },
  },
};

const reviseSchema: FastifySchema = { params: idParams, body: submitSchema.body };

const decisionSchema: FastifySchema = {
  params: idParams,
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'decision'],
    additionalProperties: false,
    properties: {
      ...scopeProperties,
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
    properties: { ...scopeProperties, comment: { type: 'string', maxLength: 1000 } },
  },
};

const readSchema: FastifySchema = { params: idParams, querystring: scopeQuery };
const listSchema: FastifySchema = { querystring: scopeQuery };

/** Dependencies of the hiring routes. */
export interface HiringRoutesDependencies {
  requisitions: HiringRequisitionApplicationService;
  /** HR's progress on an approved request (the opening and how many are hired). */
  recruiting?: RecruitingApplicationService;
  /** Validates an optional target project belongs to the organization. */
  projects: ProjectRepository;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
  /** Display name of a user of the trusted tenant (never an email or id leak). */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
}

/** What the caller may do with a requisition right now (computed on the server). */
interface RequisitionActions {
  canDecide: boolean;
  /** Why the caller cannot decide although it is waiting for their role. */
  decideBlockedReason?: string;
  canRevise: boolean;
  canWithdraw: boolean;
}

/** A requisition as returned to the browser. */
type RequisitionView = HiringRequisitionDto & {
  requestedByName?: string;
  history: readonly (HiringRequisitionDto['history'][number] & { actorName?: string })[];
  /** HR's progress, once a position has been opened for an approved request. */
  recruiting?: { openingId: string; status: string; hiredCount: number; headcount: number };
  actions: RequisitionActions;
};

interface Scope {
  organizationId: string;
  workspaceId: string;
}

/** Registers the hiring requisition routes. */
export function registerHiringRoutes(
  app: FastifyInstance,
  dependencies: HiringRoutesDependencies,
): void {
  /** Verifies the named scope against the caller's memberships (403 otherwise). */
  async function scopeDenial(userId: string, scope: Scope): Promise<string | undefined> {
    const organizations = await dependencies.listOrganizations.handle({ userId: userId as UserId });
    if (!organizations.ok || !organizations.value.some((org) => org.id === scope.organizationId)) {
      return 'You are not a member of this organization';
    }
    const workspaces = await dependencies.listMyWorkspaces.handle({
      userId: userId as UserId,
      organizationId: scope.organizationId as TenantId,
    });
    if (!workspaces.ok || !workspaces.value.some((ws) => ws.id === scope.workspaceId)) {
      return 'You are not a member of this workspace';
    }
    return undefined;
  }

  const deny = (reply: FastifyReply, requestId: string, message: string) =>
    reply.code(403).send({ error: { code: 'AUTHORIZATION_ERROR', message, requestId } });

  const notFound = (reply: FastifyReply, requestId: string) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Hiring request not found', requestId },
    });

  const context = (userId: string, scope: Scope) => ({
    userId,
    tenantId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });

  /** Whether the caller may see this requisition (all of them, or only their own). */
  const visible = (
    requisition: HiringRequisition,
    userId: string,
    effective: EffectivePermissions | undefined,
  ): boolean =>
    hasPermission(effective, 'requisitions.read') ||
    (hasPermission(effective, 'requisitions.create') && requisition.requestedBy === userId);

  /** Builds the browser view: names resolved, the caller's actions computed. */
  async function view(
    requisition: HiringRequisition,
    userId: string,
    effective: EffectivePermissions | undefined,
  ): Promise<RequisitionView> {
    const dto = toHiringRequisitionDto(requisition);
    const names = new Map<string, string | undefined>();
    const nameOf = async (id: string): Promise<string | undefined> => {
      if (!names.has(id)) names.set(id, await dependencies.resolveUserName?.(id));
      return names.get(id);
    };
    const history = [];
    for (const entry of dto.history) {
      const actorName = await nameOf(entry.actorId);
      history.push({ ...entry, ...(actorName === undefined ? {} : { actorName }) });
    }
    const requestedByName = await nameOf(dto.requestedBy);
    const stage = requisition.pendingStage;
    const holdsStage = stage !== undefined && hasPermission(effective, STAGE_CAPABILITY[stage]);
    const blocker = holdsStage ? requisition.decisionBlocker(stage, userId) : undefined;
    const isRequester = requisition.requestedBy === userId;
    const opening =
      requisition.status === 'approved'
        ? await dependencies.recruiting?.findOpeningForRequisition(
            requisition.organizationId,
            requisition.id,
          )
        : undefined;
    const progress =
      opening === undefined || opening === null ? undefined : toJobOpeningDto(opening);
    return {
      ...dto,
      ...(requestedByName === undefined ? {} : { requestedByName }),
      ...(progress === undefined
        ? {}
        : {
            recruiting: {
              openingId: progress.id,
              status: progress.status,
              hiredCount: progress.hiredCount,
              headcount: progress.headcount,
            },
          }),
      history,
      actions: {
        canDecide: holdsStage && blocker === undefined,
        ...(blocker === undefined ? {} : { decideBlockedReason: blocker }),
        canRevise: isRequester && requisition.status === 'changes_requested',
        canWithdraw:
          isRequester && requisition.status !== 'approved' && requisition.status !== 'withdrawn',
      },
    };
  }

  /** Extracts the requester-supplied details from a validated body. */
  function detailsOf(body: RequisitionDetails & Scope): RequisitionDetails {
    return {
      jobTitle: body.jobTitle,
      department: body.department,
      ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
      headcount: body.headcount,
      employmentType: body.employmentType,
      salaryMinMinorUnits: body.salaryMinMinorUnits,
      salaryMaxMinorUnits: body.salaryMaxMinorUnits,
      currency: body.currency,
      justification: body.justification,
      urgency: body.urgency,
      ...(body.targetStartDate === undefined ? {} : { targetStartDate: body.targetStartDate }),
    };
  }

  /** A named project must be one of this organization's projects. */
  async function projectProblem(
    organizationId: string,
    projectId: string | undefined,
  ): Promise<string | undefined> {
    if (projectId === undefined) return undefined;
    const project = await dependencies.projects.findById(projectId as never).catch(() => undefined);
    return project === undefined || project.organizationId !== organizationId
      ? 'The selected project does not exist in this organization'
      : undefined;
  }

  const badRequest = (reply: FastifyReply, requestId: string, message: string) =>
    reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message, requestId } });

  // --- Raise ---------------------------------------------------------------

  app.post('/api/hiring/requisitions', { schema: submitSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as RequisitionDetails & Scope;
    const denial = await scopeDenial(auth.userId, body);
    if (denial !== undefined) return deny(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      context(auth.userId, body),
      'requisitions.create',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'raise a hiring request');
    const problem = await projectProblem(body.organizationId, body.projectId);
    if (problem !== undefined) return badRequest(reply, request.id, problem);

    const result = await dependencies.requisitions.submit({
      organizationId: body.organizationId as TenantId,
      workspaceId: body.workspaceId as WorkspaceId,
      actorId: auth.userId,
      correlationId: request.id,
      details: detailsOf(body),
      // A requester who holds the executive authority needs no executive sign-off.
      requesterIsExecutive: hasPermission(authz.effective, STAGE_CAPABILITY.executive),
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply
      .code(201)
      .send({ requisition: await view(result.value, auth.userId, authz.effective) });
  });

  // --- Read ----------------------------------------------------------------

  app.get('/api/hiring/requisitions', { schema: listSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const scope = request.query as Scope;
    const denial = await scopeDenial(auth.userId, scope);
    if (denial !== undefined) return deny(reply, request.id, denial);
    const effective = await resolveEffectivePermissions(
      dependencies.permissions,
      context(auth.userId, scope),
    );
    if (
      !hasPermission(effective, 'requisitions.read') &&
      !hasPermission(effective, 'requisitions.create')
    ) {
      return sendForbidden(reply, request.id, 'view hiring requests');
    }
    const all = await dependencies.requisitions.list(scope.organizationId as TenantId);
    const requisitions = [];
    for (const requisition of all) {
      if (visible(requisition, auth.userId, effective)) {
        requisitions.push(await view(requisition, auth.userId, effective));
      }
    }
    return {
      requisitions,
      canCreate: hasPermission(effective, 'requisitions.create'),
    };
  });

  app.get(
    '/api/hiring/requisitions/:requisitionId',
    { schema: readSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { requisitionId } = request.params as { requisitionId: string };
      const scope = request.query as Scope;
      const denial = await scopeDenial(auth.userId, scope);
      if (denial !== undefined) return deny(reply, request.id, denial);
      const effective = await resolveEffectivePermissions(
        dependencies.permissions,
        context(auth.userId, scope),
      );
      const found = await dependencies.requisitions.get(
        scope.organizationId as TenantId,
        requisitionId,
      );
      if (!found.ok || !visible(found.value, auth.userId, effective)) {
        return notFound(reply, request.id);
      }
      return { requisition: await view(found.value, auth.userId, effective) };
    },
  );

  // --- Decide --------------------------------------------------------------

  app.post(
    '/api/hiring/requisitions/:requisitionId/decision',
    { schema: decisionSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { requisitionId } = request.params as { requisitionId: string };
      const body = request.body as Scope & { decision: 'approve' | 'reject'; comment?: string };
      const denial = await scopeDenial(auth.userId, body);
      if (denial !== undefined) return deny(reply, request.id, denial);
      const effective = await resolveEffectivePermissions(
        dependencies.permissions,
        context(auth.userId, body),
      );
      const found = await dependencies.requisitions.get(
        body.organizationId as TenantId,
        requisitionId,
      );
      if (!found.ok || !visible(found.value, auth.userId, effective)) {
        return notFound(reply, request.id);
      }
      // The stage is whatever the request is WAITING at — never a body field —
      // and the caller must hold THAT stage's authority in their own role.
      const stage = found.value.pendingStage;
      if (stage === undefined) {
        return reply.code(409).send({
          error: {
            code: 'CONFLICT',
            message: 'This hiring request is not waiting for a decision',
            requestId: request.id,
          },
        });
      }
      const authz =
        stage === 'executive'
          ? await authorizePermission(
              dependencies.permissions,
              context(auth.userId, body),
              'requisitions.approve_executive',
            )
          : await authorizePermission(
              dependencies.permissions,
              context(auth.userId, body),
              'requisitions.approve_finance',
            );
      if (!authz.ok) {
        return sendForbidden(reply, request.id, `take the ${stage} decision on a hiring request`);
      }
      const result = await dependencies.requisitions.decide({
        organizationId: body.organizationId as TenantId,
        requisitionId,
        stage,
        decision: body.decision,
        ...(body.comment === undefined ? {} : { comment: body.comment }),
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return { requisition: await view(result.value, auth.userId, authz.effective) };
    },
  );

  // --- Revise + resubmit (requester) -----------------------------------------

  app.put(
    '/api/hiring/requisitions/:requisitionId',
    { schema: reviseSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { requisitionId } = request.params as { requisitionId: string };
      const body = request.body as RequisitionDetails & Scope;
      const denial = await scopeDenial(auth.userId, body);
      if (denial !== undefined) return deny(reply, request.id, denial);
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, body),
        'requisitions.create',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'revise a hiring request');
      const found = await dependencies.requisitions.get(
        body.organizationId as TenantId,
        requisitionId,
      );
      if (!found.ok || !visible(found.value, auth.userId, authz.effective)) {
        return notFound(reply, request.id);
      }
      const problem = await projectProblem(body.organizationId, body.projectId);
      if (problem !== undefined) return badRequest(reply, request.id, problem);
      const result = await dependencies.requisitions.revise({
        organizationId: body.organizationId as TenantId,
        requisitionId,
        details: detailsOf(body),
        requesterIsExecutive: hasPermission(authz.effective, STAGE_CAPABILITY.executive),
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return { requisition: await view(result.value, auth.userId, authz.effective) };
    },
  );

  // --- Withdraw (requester) --------------------------------------------------

  app.post(
    '/api/hiring/requisitions/:requisitionId/withdraw',
    { schema: withdrawSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { requisitionId } = request.params as { requisitionId: string };
      const body = request.body as Scope & { comment?: string };
      const denial = await scopeDenial(auth.userId, body);
      if (denial !== undefined) return deny(reply, request.id, denial);
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, body),
        'requisitions.create',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'withdraw a hiring request');
      const found = await dependencies.requisitions.get(
        body.organizationId as TenantId,
        requisitionId,
      );
      if (!found.ok || !visible(found.value, auth.userId, authz.effective)) {
        return notFound(reply, request.id);
      }
      const result = await dependencies.requisitions.withdraw({
        organizationId: body.organizationId as TenantId,
        requisitionId,
        ...(body.comment === undefined ? {} : { comment: body.comment }),
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return { requisition: await view(result.value, auth.userId, authz.effective) };
    },
  );
}
