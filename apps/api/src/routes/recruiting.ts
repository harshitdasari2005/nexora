/**
 * @nexora/app-api — recruiting routes (HR's side of hiring).
 *
 * After a hiring request is approved by the chief executive and by Finance, HR
 * opens the position, runs candidates through the pipeline, makes an offer
 * inside the approved terms and records the answer; an accepted offer creates
 * the employee record.
 *
 * Authorization, on every endpoint:
 * 1. membership of the organization AND of the workspace the caller acts from;
 * 2. the capability the step needs, resolved from the caller's role in THAT
 *    workspace: `recruiting.manage` for every HR action, `recruiting.interview`
 *    to give feedback, `recruiting.read`/`recruiting.manage` to see everything;
 * 3. visibility: a hiring manager (`recruiting.interview`) sees only the
 *    openings they raised the request for — and never offer amounts. Anything a
 *    caller may not see is reported exactly like something that does not exist.
 */

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import {
  toCandidateDto,
  toJobOpeningDto,
  type CandidateDto,
  type HiringRequisitionApplicationService,
  type JobOpeningDto,
  type RecruitingApplicationService,
} from '@nexora/application-hr';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { Candidate, CandidateSource, JobOpening, Recommendation } from '@nexora/domain-hr';

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
import { authorizeScope } from './scope.js';

const scopeProperties = {
  organizationId: { type: 'string', minLength: 1, maxLength: 64 },
  workspaceId: { type: 'string', minLength: 1, maxLength: 64 },
} as const;
const SCOPE = ['organizationId', 'workspaceId'] as const;
const scopeQuery = { type: 'object', required: [...SCOPE], properties: scopeProperties } as const;
const params = (name: string) =>
  ({
    type: 'object',
    required: [name],
    additionalProperties: false,
    properties: { [name]: { type: 'string', minLength: 1, maxLength: 64 } },
  }) as const;
const body = (required: readonly string[], properties: Record<string, unknown>) =>
  ({
    type: 'object',
    required: [...SCOPE, ...required],
    additionalProperties: false,
    properties: { ...scopeProperties, ...properties },
  }) as const;

const openSchema: FastifySchema = {
  body: body(['requisitionId', 'description'], {
    requisitionId: { type: 'string', minLength: 1, maxLength: 64 },
    description: { type: 'string', minLength: 10, maxLength: 4000 },
  }),
};
const statusSchema: FastifySchema = {
  params: params('openingId'),
  body: body(['action'], {
    action: { type: 'string', enum: ['hold', 'resume', 'close'] },
    reason: { type: 'string', maxLength: 500 },
  }),
};
const addCandidateSchema: FastifySchema = {
  params: params('openingId'),
  body: body(['name', 'email', 'source'], {
    name: { type: 'string', minLength: 2, maxLength: 160 },
    email: { type: 'string', minLength: 3, maxLength: 254 },
    phone: { type: 'string', maxLength: 40 },
    source: { type: 'string', enum: ['referral', 'job_board', 'agency', 'internal', 'other'] },
    resumeNotes: { type: 'string', maxLength: 4000 },
  }),
};
const candidateOnlySchema: FastifySchema = { params: params('candidateId'), body: body([], {}) };
const feedbackSchema: FastifySchema = {
  params: params('candidateId'),
  body: body(['rating', 'recommendation', 'notes'], {
    rating: { type: 'integer', minimum: 1, maximum: 5 },
    recommendation: { type: 'string', enum: ['strong_yes', 'yes', 'no', 'strong_no'] },
    notes: { type: 'string', minLength: 5, maxLength: 2000 },
  }),
};
const offerSchema: FastifySchema = {
  params: params('candidateId'),
  body: body(['salaryMinorUnits', 'startDate'], {
    salaryMinorUnits: { type: 'integer', minimum: 0, maximum: 100_000_000_000 },
    startDate: { type: 'string', minLength: 10, maxLength: 10 },
  }),
};
const offerResponseSchema: FastifySchema = {
  params: params('candidateId'),
  body: body(['response'], {
    response: { type: 'string', enum: ['accept', 'decline'] },
    note: { type: 'string', maxLength: 500 },
  }),
};
const closeSchema: FastifySchema = {
  params: params('candidateId'),
  body: body(['outcome', 'reason'], {
    outcome: { type: 'string', enum: ['reject', 'withdraw'] },
    reason: { type: 'string', minLength: 3, maxLength: 500 },
  }),
};

/** Dependencies of the recruiting routes. */
export interface RecruitingRoutesDependencies {
  recruiting: RecruitingApplicationService;
  /** Approved hiring requests waiting for HR to open the position. */
  requisitions: HiringRequisitionApplicationService;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  permissions: PermissionResolverDependencies;
  /** Display name of a user of the trusted tenant (never an email or id leak). */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
}

interface Scope {
  organizationId: string;
  workspaceId: string;
}

type OpeningView = JobOpeningDto & { hiringManagerName?: string; canManage: boolean };

type CandidateView = Omit<CandidateDto, 'feedback' | 'history'> & {
  feedback: readonly (CandidateDto['feedback'][number] & { byName?: string })[];
  history: readonly (CandidateDto['history'][number] & { actorName?: string })[];
  /** What the CURRENT caller may do with this candidate right now. */
  actions: {
    canAdvance: boolean;
    canGiveFeedback: boolean;
    canOffer: boolean;
    canRecordResponse: boolean;
    canClose: boolean;
  };
};

/** Registers the recruiting routes. */
export function registerRecruitingRoutes(
  app: FastifyInstance,
  dependencies: RecruitingRoutesDependencies,
): void {
  const deny = (reply: FastifyReply, requestId: string, message: string) =>
    reply.code(403).send({ error: { code: 'AUTHORIZATION_ERROR', message, requestId } });
  const notFound = (reply: FastifyReply, requestId: string, what: string) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: `${what} not found`, requestId } });
  const context = (userId: string, scope: Scope) => ({
    userId,
    tenantId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
  const names = async (ids: readonly string[]): Promise<Map<string, string | undefined>> => {
    const resolved = new Map<string, string | undefined>();
    for (const id of new Set(ids)) resolved.set(id, await dependencies.resolveUserName?.(id));
    return resolved;
  };

  /** HR and the executive see every opening and every offer. */
  const seesEverything = (effective: EffectivePermissions | undefined): boolean =>
    hasPermission(effective, 'recruiting.manage') || hasPermission(effective, 'recruiting.read');

  /** Whether the caller may see this opening at all. */
  const canSee = (
    opening: JobOpening,
    userId: string,
    effective: EffectivePermissions | undefined,
  ): boolean =>
    seesEverything(effective) ||
    (hasPermission(effective, 'recruiting.interview') && opening.hiringManagerId === userId);

  async function openingView(
    opening: JobOpening,
    effective: EffectivePermissions | undefined,
  ): Promise<OpeningView> {
    const dto = toJobOpeningDto(opening);
    const hiringManagerName = await dependencies.resolveUserName?.(dto.hiringManagerId);
    return {
      ...dto,
      ...(hiringManagerName === undefined ? {} : { hiringManagerName }),
      canManage: hasPermission(effective, 'recruiting.manage'),
    };
  }

  async function candidateView(
    candidate: Candidate,
    opening: JobOpening,
    userId: string,
    effective: EffectivePermissions | undefined,
  ): Promise<CandidateView> {
    const dto = toCandidateDto(candidate, { includeCompensation: seesEverything(effective) });
    const resolved = await names([
      ...dto.feedback.map((entry) => entry.by),
      ...dto.history.map((entry) => entry.actorId),
    ]);
    const withName = (id: string): { name?: string } => {
      const name = resolved.get(id);
      return name === undefined ? {} : { name };
    };
    const manages = hasPermission(effective, 'recruiting.manage');
    const recruiting = opening.isRecruiting;
    const inInterviewLoop = candidate.stage === 'screening' || candidate.stage === 'interview';
    const alreadyGave = dto.feedback.some(
      (entry) => entry.by === userId && entry.stage === candidate.stage,
    );
    return {
      ...dto,
      feedback: dto.feedback.map((entry) => {
        const { name } = withName(entry.by);
        return { ...entry, ...(name === undefined ? {} : { byName: name }) };
      }),
      history: dto.history.map((entry) => {
        const { name } = withName(entry.actorId);
        return { ...entry, ...(name === undefined ? {} : { actorName: name }) };
      }),
      actions: {
        canAdvance: manages && recruiting && candidate.nextStage !== undefined,
        canGiveFeedback:
          hasPermission(effective, 'recruiting.interview') &&
          recruiting &&
          inInterviewLoop &&
          !alreadyGave,
        canOffer:
          manages &&
          recruiting &&
          candidate.stage === 'interview' &&
          dto.feedback.some((entry) => entry.stage === 'interview') &&
          opening.seatsAvailable > 0,
        canRecordResponse: manages && candidate.hasOpenOffer,
        canClose: manages && candidate.isActive,
      },
    };
  }

  /** Scope + role for a request; sends the 403 itself when the scope is not the caller's. */
  async function enter(
    reply: FastifyReply,
    requestId: string,
    userId: string,
    scope: Scope,
  ): Promise<{ effective: EffectivePermissions | undefined } | undefined> {
    const denial = await authorizeScope(
      dependencies,
      userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      await deny(reply, requestId, denial);
      return undefined;
    }
    return {
      effective: await resolveEffectivePermissions(
        dependencies.permissions,
        context(userId, scope),
      ),
    };
  }

  const fail = (reply: FastifyReply, requestId: string, error: unknown) => {
    const http = toHttpError(error as never, requestId);
    return reply.code(http.statusCode).send(http.body);
  };

  // --- Openings ---------------------------------------------------------------

  app.get(
    '/api/recruiting/openings',
    { schema: { querystring: scopeQuery } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const scope = request.query as Scope;
      const entered = await enter(reply, request.id, auth.userId, scope);
      if (entered === undefined) return reply;
      const { effective } = entered;
      if (!seesEverything(effective) && !hasPermission(effective, 'recruiting.interview')) {
        return sendForbidden(reply, request.id, 'view recruiting');
      }
      const all = await dependencies.recruiting.listOpenings(scope.organizationId as TenantId);
      const openings = [];
      for (const opening of all) {
        if (canSee(opening, auth.userId, effective)) {
          openings.push(await openingView(opening, effective));
        }
      }
      // HR also sees the approved hiring requests still waiting for a position to be opened.
      const readyRequisitions = [];
      if (hasPermission(effective, 'recruiting.manage')) {
        const opened = new Set(all.map((opening) => opening.requisitionId));
        for (const requisition of await dependencies.requisitions.list(
          scope.organizationId as TenantId,
        )) {
          if (requisition.status !== 'approved' || opened.has(requisition.id)) continue;
          const details = requisition.details;
          const requestedByName = await dependencies.resolveUserName?.(requisition.requestedBy);
          readyRequisitions.push({
            id: requisition.id,
            jobTitle: details.jobTitle,
            department: details.department,
            headcount: details.headcount,
            employmentType: details.employmentType,
            salaryMinMinorUnits: details.salaryMinMinorUnits,
            salaryMaxMinorUnits: details.salaryMaxMinorUnits,
            currency: details.currency,
            justification: details.justification,
            ...(requestedByName === undefined ? {} : { requestedByName }),
          });
        }
      }
      return {
        openings,
        readyRequisitions,
        canManage: hasPermission(effective, 'recruiting.manage'),
      };
    },
  );

  app.post('/api/recruiting/openings', { schema: openSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = request.body as Scope & { requisitionId: string; description: string };
    const entered = await enter(reply, request.id, auth.userId, input);
    if (entered === undefined) return reply;
    const authz = await authorizePermission(
      dependencies.permissions,
      context(auth.userId, input),
      'recruiting.manage',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'open a position');
    const result = await dependencies.recruiting.openPosition({
      organizationId: input.organizationId as TenantId,
      requisitionId: input.requisitionId,
      description: input.description,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) return fail(reply, request.id, result.error);
    return reply.code(201).send({ opening: await openingView(result.value, authz.effective) });
  });

  app.post(
    '/api/recruiting/openings/:openingId/status',
    { schema: statusSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { openingId } = request.params as { openingId: string };
      const input = request.body as Scope & {
        action: 'hold' | 'resume' | 'close';
        reason?: string;
      };
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, input),
        'recruiting.manage',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'change a job opening');
      const result = await dependencies.recruiting.changeOpening({
        organizationId: input.organizationId as TenantId,
        openingId,
        action: input.action,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      return { opening: await openingView(result.value, authz.effective) };
    },
  );

  app.get(
    '/api/recruiting/openings/:openingId',
    { schema: { params: params('openingId'), querystring: scopeQuery } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { openingId } = request.params as { openingId: string };
      const scope = request.query as Scope;
      const entered = await enter(reply, request.id, auth.userId, scope);
      if (entered === undefined) return reply;
      const { effective } = entered;
      const found = await dependencies.recruiting.getOpening(
        scope.organizationId as TenantId,
        openingId,
      );
      if (!found.ok || !canSee(found.value, auth.userId, effective)) {
        return notFound(reply, request.id, 'Job opening');
      }
      const candidates = [];
      for (const candidate of await dependencies.recruiting.listCandidates(
        scope.organizationId as TenantId,
        found.value.id,
      )) {
        candidates.push(await candidateView(candidate, found.value, auth.userId, effective));
      }
      return { opening: await openingView(found.value, effective), candidates };
    },
  );

  // --- Candidates -------------------------------------------------------------

  app.post(
    '/api/recruiting/openings/:openingId/candidates',
    { schema: addCandidateSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { openingId } = request.params as { openingId: string };
      const input = request.body as Scope & {
        name: string;
        email: string;
        phone?: string;
        source: CandidateSource;
        resumeNotes?: string;
      };
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, input),
        'recruiting.manage',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'add a candidate');
      const result = await dependencies.recruiting.addCandidate({
        organizationId: input.organizationId as TenantId,
        openingId,
        name: input.name,
        email: input.email,
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        source: input.source,
        ...(input.resumeNotes === undefined ? {} : { resumeNotes: input.resumeNotes }),
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      const opening = await dependencies.recruiting.getOpening(
        input.organizationId as TenantId,
        openingId,
      );
      if (!opening.ok) return fail(reply, request.id, opening.error);
      return reply.code(201).send({
        candidate: await candidateView(result.value, opening.value, auth.userId, authz.effective),
      });
    },
  );

  /** Loads a candidate the caller may see (404 otherwise), with their opening. */
  async function visibleCandidate(
    reply: FastifyReply,
    requestId: string,
    userId: string,
    scope: Scope,
    candidateId: string,
    effective: EffectivePermissions | undefined,
  ): Promise<{ candidate: Candidate; opening: JobOpening } | undefined> {
    const found = await dependencies.recruiting.getCandidate(
      scope.organizationId as TenantId,
      candidateId,
    );
    if (!found.ok || !canSee(found.value.opening, userId, effective)) {
      await notFound(reply, requestId, 'Candidate');
      return undefined;
    }
    return found.value;
  }

  /** Sends the refreshed candidate view after a successful change. */
  async function sendCandidate(
    reply: FastifyReply,
    requestId: string,
    userId: string,
    scope: Scope,
    candidate: Candidate,
    effective: EffectivePermissions | undefined,
    extra: Record<string, unknown> = {},
  ) {
    const opening = await dependencies.recruiting.getOpening(
      scope.organizationId as TenantId,
      candidate.openingId,
    );
    if (!opening.ok) return fail(reply, requestId, opening.error);
    return reply.send({
      candidate: await candidateView(candidate, opening.value, userId, effective),
      opening: await openingView(opening.value, effective),
      ...extra,
    });
  }

  app.post(
    '/api/recruiting/candidates/:candidateId/advance',
    { schema: candidateOnlySchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { candidateId } = request.params as { candidateId: string };
      const input = request.body as Scope;
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, input),
        'recruiting.manage',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'move a candidate');
      const result = await dependencies.recruiting.advanceCandidate({
        organizationId: input.organizationId as TenantId,
        candidateId,
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      return sendCandidate(reply, request.id, auth.userId, input, result.value, authz.effective);
    },
  );

  app.post(
    '/api/recruiting/candidates/:candidateId/feedback',
    { schema: feedbackSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { candidateId } = request.params as { candidateId: string };
      const input = request.body as Scope & {
        rating: number;
        recommendation: Recommendation;
        notes: string;
      };
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, input),
        'recruiting.interview',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'give interview feedback');
      // An interviewer only reaches the candidates of openings they may see.
      const visible = await visibleCandidate(
        reply,
        request.id,
        auth.userId,
        input,
        candidateId,
        authz.effective,
      );
      if (visible === undefined) return reply;
      const result = await dependencies.recruiting.recordFeedback({
        organizationId: input.organizationId as TenantId,
        candidateId,
        rating: input.rating,
        recommendation: input.recommendation,
        notes: input.notes,
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      return sendCandidate(reply, request.id, auth.userId, input, result.value, authz.effective);
    },
  );

  app.post(
    '/api/recruiting/candidates/:candidateId/offer',
    { schema: offerSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { candidateId } = request.params as { candidateId: string };
      const input = request.body as Scope & { salaryMinorUnits: number; startDate: string };
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, input),
        'recruiting.manage',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'make an offer');
      const result = await dependencies.recruiting.extendOffer({
        organizationId: input.organizationId as TenantId,
        candidateId,
        salaryMinorUnits: input.salaryMinorUnits,
        startDate: input.startDate,
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      return sendCandidate(reply, request.id, auth.userId, input, result.value, authz.effective);
    },
  );

  app.post(
    '/api/recruiting/candidates/:candidateId/offer/response',
    { schema: offerResponseSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { candidateId } = request.params as { candidateId: string };
      const input = request.body as Scope & { response: 'accept' | 'decline'; note?: string };
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, input),
        'recruiting.manage',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, "record a candidate's answer");
      const command = {
        organizationId: input.organizationId as TenantId,
        candidateId,
        actorId: auth.userId,
        correlationId: request.id,
      };
      if (input.response === 'accept') {
        const result = await dependencies.recruiting.acceptOffer(command);
        if (!result.ok) return fail(reply, request.id, result.error);
        return sendCandidate(
          reply,
          request.id,
          auth.userId,
          input,
          result.value.candidate,
          authz.effective,
          { employeeId: result.value.employee.id },
        );
      }
      const result = await dependencies.recruiting.declineOffer({
        ...command,
        ...(input.note === undefined ? {} : { note: input.note }),
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      return sendCandidate(reply, request.id, auth.userId, input, result.value, authz.effective);
    },
  );

  app.post(
    '/api/recruiting/candidates/:candidateId/close',
    { schema: closeSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { candidateId } = request.params as { candidateId: string };
      const input = request.body as Scope & { outcome: 'reject' | 'withdraw'; reason: string };
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      const authz = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, input),
        'recruiting.manage',
      );
      if (!authz.ok) return sendForbidden(reply, request.id, 'close a candidate');
      const result = await dependencies.recruiting.closeCandidate({
        organizationId: input.organizationId as TenantId,
        candidateId,
        outcome: input.outcome,
        reason: input.reason,
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      return sendCandidate(reply, request.id, auth.userId, input, result.value, authz.effective);
    },
  );
}
