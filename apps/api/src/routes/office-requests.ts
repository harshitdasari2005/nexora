/**
 * @nexora/app-api — office workflow routes.
 *
 * Every department's everyday work, on one engine: a request follows the
 * chain its workflow defines in the catalog (`@nexora/domain-hr`) — leave to
 * the manager and HR, a campaign to the marketing head, Finance and Legal, a
 * customer problem to support and engineering, and so on.
 *
 * A stage names a SEAT. Who holds a seat is decided here from the caller's
 * resolved role in the workspace they act from (`SEAT_CAPABILITY`); the
 * manager seat belongs to a manager of the team the request was raised from.
 * The aggregate enforces the order of the stages and that nobody decides their
 * own request. A request the caller may not see is reported as not found.
 *
 * The assistant (`/draft`, `/brief`, `/write`) only suggests: it reads what the
 * caller can already see, and what it produces goes back through these same
 * routes and rules when a person submits it.
 */

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import {
  WORKFLOW_CATALOG,
  WORKFLOW_DEPARTMENTS,
  OfficeRequest,
  OfficeRequestId,
  findWorkflow,
  findWorkflowStage,
  type OfficeRequestDetails,
  type OfficeRequestRepository,
  type WorkflowDefinition,
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
import type { BriefFact, OfficeAi, RequestForAi } from '../office/office-ai.js';
import {
  EXECUTIVE_CAPABILITY,
  EXECUTIVE_ROLE_ID,
  SEAT_CAPABILITY,
  createRequestAuthority,
} from '../office/request-authority.js';
import type { Staffing } from '../office/staffing.js';
import {
  denyScope,
  officeScopeDenial,
  officeScopeProperties,
  officeScopeQuery,
  roleContextOf,
  type OfficeScope,
} from './office-scope.js';
import { sendForbidden } from './permission-response.js';

const idParams = {
  type: 'object',
  required: ['requestId'],
  additionalProperties: false,
  properties: { requestId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

// Values are checked by hand below, not by the schema: the validator would
// coerce a number into text (or the reverse), and an amount must stay a number.
const valuesSchema = { type: 'object', maxProperties: 24, additionalProperties: true } as const;

/** The values of a request body: text and numbers only, bounded. */
function cleanValues(raw: unknown): Record<string, string | number> | undefined {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.length <= 4000) out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else return undefined;
  }
  return out;
}

const submitSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'type', 'reason'],
    additionalProperties: false,
    properties: {
      ...officeScopeProperties,
      type: { type: 'string', minLength: 1, maxLength: 32 },
      reason: { type: 'string', minLength: 5, maxLength: 2000 },
      values: valuesSchema,
      draftedWithAssistant: { type: 'boolean' },
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
      comment: { type: 'string', maxLength: 4000 },
    },
  },
};

const scopedBody = (
  extra: Record<string, unknown> = {},
  required: string[] = [],
): FastifySchema => ({
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', ...required],
    additionalProperties: false,
    properties: { ...officeScopeProperties, ...extra },
  },
});

const withdrawSchema: FastifySchema = { params: idParams, ...scopedBody() };
const assistSchema: FastifySchema = { params: idParams, ...scopedBody() };
const draftSchema = scopedBody(
  {
    type: { type: 'string', minLength: 1, maxLength: 32 },
    sentence: { type: 'string', minLength: 5, maxLength: 1000 },
  },
  ['type', 'sentence'],
);
const listSchema: FastifySchema = { querystring: officeScopeQuery };

/** Dependencies of the office workflow routes. */
export interface OfficeRequestRoutesDependencies {
  requests: OfficeRequestRepository;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
  /** Display name of a user of the trusted tenant (never an email or id leak). */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
  /** The assistant inside the workflows (suggests; never decides). */
  assistant: OfficeAi;
  /** Who holds which seat: a seat nobody holds falls to the executive. */
  staffing?: Staffing;
  /**
   * What a finished workflow sets in motion elsewhere (an approved project
   * proposal opens the project). Called once, after the last stage was saved.
   */
  onCompleted?: (request: OfficeRequest, actorId: string, correlationId: string) => Promise<void>;
}

type SubmitBody = OfficeScope & {
  type: string;
  reason: string;
  values?: unknown;
  draftedWithAssistant?: boolean;
};

function money(minorUnits: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(minorUnits / 100);
}

function day(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A field's value as a person reads it. */
function show(
  definition: WorkflowDefinition,
  key: string,
  value: string | number | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const field = definition.fields.find((entry) => entry.key === key);
  if (field?.type === 'money' && typeof value === 'number') return money(value);
  if (field?.type === 'date' && typeof value === 'string') return day(value);
  if (field?.type === 'number' && key.toLowerCase().includes('percent')) return `${value}%`;
  return String(value);
}

/** What a request asks for, in one line. */
function summaryOf(definition: WorkflowDefinition, details: OfficeRequestDetails): string {
  return definition.summaryFields
    .map((key) => show(definition, key, details[key]))
    .filter((part): part is string => part !== undefined)
    .join(', ');
}

/** Registers the office workflow routes. */
export function registerOfficeRequestRoutes(
  app: FastifyInstance,
  dependencies: OfficeRequestRoutesDependencies,
): void {
  const notFound = (reply: FastifyReply, requestId: string) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Request not found', requestId } });
  const conflict = (reply: FastifyReply, requestId: string) =>
    reply.code(409).send({
      error: {
        code: 'CONFLICT',
        message: 'The request was changed by someone else — reload and try again',
        requestId,
      },
    });
  const fail = (reply: FastifyReply, requestId: string, error: unknown) => {
    const http = toHttpError(error, requestId);
    return reply.code(http.statusCode).send(http.body);
  };

  const { holdsSeat, escalatesToExecutive, seatIsVacant, mayTakePending } = createRequestAuthority(
    dependencies.permissions,
    dependencies.staffing,
  );

  /** Whether the caller may see this request: their own, one they take part in, or all. */
  const visible = (
    request: OfficeRequest,
    userId: string,
    scope: OfficeScope,
    effective: EffectivePermissions | undefined,
  ): boolean =>
    request.requestedBy === userId ||
    hasPermission(effective, 'requests.read') ||
    (request.workflow?.stages ?? []).some(
      (stage) =>
        stage.seat !== 'requester' && holdsSeat(request, stage.seat, scope, effective, userId),
    );

  async function view(
    request: OfficeRequest,
    userId: string,
    scope: OfficeScope,
    effective: EffectivePermissions | undefined,
  ) {
    const snapshot = OfficeRequest.snapshot(request);
    const definition = request.workflow;
    const names = new Map<string, string | undefined>();
    const nameOf = async (id: string): Promise<string | undefined> => {
      if (!names.has(id)) names.set(id, await dependencies.resolveUserName?.(id));
      return names.get(id);
    };
    const history = [];
    for (const entry of snapshot.history) {
      const actorName = await nameOf(entry.actorId);
      const stageLabel =
        entry.stage === undefined || definition === undefined
          ? undefined
          : findWorkflowStage(definition, entry.stage)?.label;
      history.push({
        ...entry,
        ...(actorName === undefined ? {} : { actorName }),
        ...(stageLabel === undefined ? {} : { stageLabel }),
      });
    }
    const requestedByName = await nameOf(snapshot.requestedBy);
    const pending = request.pendingStageDefinition;
    const mine = pending !== undefined && (await mayTakePending(request, scope, effective, userId));
    const blocker = mine ? request.decisionBlocker(userId) : undefined;
    const vacant = pending !== undefined && (await seatIsVacant(request, pending.seat, effective));
    const stages = request.stageStates().map(({ key, state }) => {
      const stage = definition === undefined ? undefined : findWorkflowStage(definition, key);
      return { key, label: stage?.label ?? key, kind: stage?.kind ?? 'decide', state };
    });
    return {
      id: snapshot.id,
      type: snapshot.details.type,
      workflow: definition?.name ?? snapshot.details.type,
      department: definition?.department ?? 'Other',
      summary: definition === undefined ? '' : summaryOf(definition, snapshot.details),
      reasonLabel: definition?.reasonLabel ?? 'Why',
      reason: snapshot.details.reason,
      fields:
        definition === undefined
          ? []
          : definition.fields
              .map((field) => ({
                label: field.label,
                value: show(definition, field.key, snapshot.details[field.key]),
                long: field.type === 'longtext',
              }))
              .filter((field) => field.value !== undefined),
      status: snapshot.status,
      ...(pending === undefined
        ? {}
        : {
            pending: {
              key: pending.key,
              label: pending.label,
              kind: pending.kind,
              noteRequired: pending.noteRequired === true,
              ...(pending.noteLabel === undefined ? {} : { noteLabel: pending.noteLabel }),
              // Nobody holds this seat yet: it falls to the chief executive.
              ...(vacant ? { vacant: true } : {}),
            },
          }),
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

  /** What the assistant is told about a request the caller can already see. */
  async function forAssistant(request: OfficeRequest): Promise<RequestForAi | undefined> {
    const definition = request.workflow;
    if (definition === undefined) return undefined;
    const snapshot = OfficeRequest.snapshot(request);
    const history: string[] = [];
    for (const entry of snapshot.history) {
      if (entry.action === 'assisted' || entry.action === 'submitted') continue;
      const who = (await dependencies.resolveUserName?.(entry.actorId)) ?? 'Someone';
      const stage =
        entry.stage === undefined ? '' : (findWorkflowStage(definition, entry.stage)?.label ?? '');
      history.push(
        `${stage}: ${entry.action} by ${who}${entry.comment === undefined ? '' : ` — ${entry.comment}`}`,
      );
    }
    return {
      definition,
      details: snapshot.details,
      requestedByName:
        (await dependencies.resolveUserName?.(snapshot.requestedBy)) ?? 'A colleague',
      history,
    };
  }

  /** The checked facts a decision brief is built on (computed here, never generated). */
  async function factsFor(request: OfficeRequest): Promise<BriefFact[]> {
    const definition = request.workflow;
    if (definition === undefined) return [];
    const snapshot = OfficeRequest.snapshot(request);
    const facts: BriefFact[] = [];
    const others = (await dependencies.requests.listByOrganization(request.organizationId)).filter(
      (other) => other.id !== request.id,
    );

    // The requester's record with this kind of request.
    const earlier = others.filter(
      (other) => other.requestedBy === request.requestedBy && other.type === request.type,
    );
    const rejected = earlier.filter((other) => other.status === 'rejected').length;
    facts.push({
      label: 'Earlier requests of this kind by the same person',
      value:
        earlier.length === 0
          ? 'None: this is their first'
          : `${earlier.length} (${earlier.filter((other) => other.status === 'approved').length} completed, ${rejected} refused)`,
      tone: rejected > 0 ? 'warn' : 'info',
    });

    // Money.
    for (const field of definition.fields.filter((entry) => entry.type === 'money')) {
      const amount = snapshot.details[field.key];
      if (typeof amount !== 'number') continue;
      const pendingElsewhere = others
        .filter((other) => other.status === 'pending')
        .reduce((total, other) => {
          const theirs = OfficeRequest.snapshot(other).details;
          return (
            total +
            (other.workflow?.fields ?? [])
              .filter((entry) => entry.type === 'money')
              .reduce(
                (sum, entry) =>
                  sum + (typeof theirs[entry.key] === 'number' ? (theirs[entry.key] as number) : 0),
                0,
              )
          );
        }, 0);
      facts.push({
        label: field.label,
        value: amount >= 50_000_000 ? `${money(amount)} — a large amount` : `${money(amount)}`,
        tone: amount >= 50_000_000 ? 'warn' : 'ok',
      });
      if (pendingElsewhere > 0) {
        facts.push({
          label: 'Other money waiting for approval in the company',
          value: money(pendingElsewhere),
          tone: 'info',
        });
      }
    }

    // People away at the same time (leave, travel).
    for (const [start, end] of [
      ['startDate', 'endDate'],
      ['from', 'to'],
    ] as const) {
      const from = snapshot.details[start];
      const to = snapshot.details[end];
      if (typeof from !== 'string' || typeof to !== 'string') continue;
      const overlapping: string[] = [];
      for (const other of others) {
        if (other.type !== request.type || other.workspaceId !== request.workspaceId) continue;
        if (other.status !== 'pending' && other.status !== 'approved') continue;
        const theirs = OfficeRequest.snapshot(other).details;
        const theirFrom = theirs[start];
        const theirTo = theirs[end];
        if (typeof theirFrom !== 'string' || typeof theirTo !== 'string') continue;
        if (theirFrom <= to && theirTo >= from) {
          overlapping.push(
            `${(await dependencies.resolveUserName?.(other.requestedBy)) ?? 'A colleague'} (${day(theirFrom)} to ${day(theirTo)})`,
          );
        }
      }
      facts.push({
        label: 'Others on the same team away in those days',
        value: overlapping.length === 0 ? 'Nobody' : overlapping.join('; '),
        tone: overlapping.length === 0 ? 'ok' : 'warn',
      });
    }

    // The workflow's own danger signs.
    const severity = snapshot.details['severity'];
    if (severity === 'critical' || severity === 'high') {
      facts.push({ label: 'Severity', value: `${severity} — treat as urgent`, tone: 'warn' });
    }
    const discount = snapshot.details['discountPercent'];
    if (typeof discount === 'number') {
      facts.push({
        label: 'Discount',
        value: discount > 20 ? `${discount}% — above the usual 20%` : `${discount}%`,
        tone: discount > 20 ? 'warn' : 'ok',
      });
    }
    if (snapshot.details['reversible'] === 'no') {
      facts.push({
        label: 'Reversibility',
        value: 'Cannot be undone — worth taking time over',
        tone: 'warn',
      });
    }

    const waitingHours = Math.round(
      (Date.now() - new Date(snapshot.updatedAt).getTime()) / 3_600_000,
    );
    facts.push({
      label: 'Waiting at this step',
      value:
        waitingHours < 1
          ? 'Less than an hour'
          : waitingHours < 48
            ? `${waitingHours} hours`
            : `${Math.round(waitingHours / 24)} days`,
      tone: waitingHours >= 72 ? 'warn' : 'info',
    });
    return facts;
  }

  // --- The catalog -----------------------------------------------------------

  app.get('/api/requests/catalog', { schema: listSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const scope = request.query as OfficeScope;
    const denial = await officeScopeDenial(dependencies, auth.userId, scope);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    return {
      departments: WORKFLOW_DEPARTMENTS.map((department) => ({
        name: department,
        workflows: WORKFLOW_CATALOG.filter((entry) => entry.department === department).map(
          (entry) => ({
            key: entry.key,
            name: entry.name,
            description: entry.description,
            reasonLabel: entry.reasonLabel,
            fields: entry.fields,
            stages: entry.stages.map((stage) => ({ label: stage.label, kind: stage.kind })),
          }),
        ),
      })),
      assistant: dependencies.assistant.status,
    };
  });

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

    const values = cleanValues(body.values);
    if (values === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Values must be text or numbers',
          requestId: request.id,
        },
      });
    }
    const definition = findWorkflow(body.type);
    // The stages whose seat the requester holds themselves. Their own decisions
    // are not required (the executive has no manager; a function's own head
    // needs no sign-off from their own function); their own work stays theirs.
    const heldByRequester = (definition?.stages ?? [])
      .filter((stage) => stage.seat !== 'requester')
      .filter((stage) =>
        stage.seat === 'manager'
          ? authz.effective.roleId === EXECUTIVE_ROLE_ID
          : hasPermission(authz.effective, SEAT_CAPABILITY[stage.seat as 'hr']),
      )
      .map((stage) => stage.key);
    let created: OfficeRequest;
    try {
      created = OfficeRequest.submit({
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        requestedBy: auth.userId,
        // `type` and `reason` are set last: a value can never overwrite them.
        details: { ...values, type: body.type, reason: body.reason },
        heldByRequester,
        ...(body.draftedWithAssistant === true ? { draftedWithAssistant: true } : {}),
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

  // --- Take a stage ----------------------------------------------------------

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
      const stage = found.pendingStageDefinition;
      // The authority of the stage: the seat's own capability
      // ('requests.approve_manager' for the request's own team,
      // 'requests.approve_hr', 'requests.approve_finance', …), 'requests.create'
      // for a step that belongs to the requester, or the executive's when the
      // decision would otherwise fall to the requester themselves.
      const escalated =
        stage !== undefined && (await escalatesToExecutive(found, stage, effective, auth.userId));
      const authz =
        stage === undefined
          ? { ok: false as const }
          : await authorizePermission(
              dependencies.permissions,
              roleContextOf(auth.userId, body),
              stage.seat === 'requester'
                ? 'requests.create'
                : escalated && !holdsSeat(found, stage.seat, body, effective, auth.userId)
                  ? EXECUTIVE_CAPABILITY
                  : SEAT_CAPABILITY[stage.seat],
            );
      if (
        stage === undefined ||
        !authz.ok ||
        !(await mayTakePending(found, body, effective, auth.userId))
      ) {
        return sendForbidden(reply, request.id, 'take this request at its current stage');
      }
      const loaded = found.version;
      try {
        found.decide({
          stage: stage.key,
          decision: body.decision,
          actorId: auth.userId,
          ...(body.comment === undefined ? {} : { comment: body.comment }),
        });
      } catch (error) {
        return fail(reply, request.id, error);
      }
      if (!(await dependencies.requests.update(found, loaded))) return conflict(reply, request.id);
      if (found.status === 'approved') {
        await dependencies.onCompleted?.(found, auth.userId, request.id);
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
      if (!(await dependencies.requests.update(found, loaded))) return conflict(reply, request.id);
      return { request: await view(found, auth.userId, body, authz.effective) };
    },
  );

  // --- The assistant: it suggests, a person decides ---------------------------

  /** One sentence in, a filled-in request out — for the person to check and send. */
  app.post('/api/requests/draft', { schema: draftSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as OfficeScope & { type: string; sentence: string };
    const denial = await officeScopeDenial(dependencies, auth.userId, body);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, body),
      'requests.create',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'raise a request');
    const definition = findWorkflow(body.type);
    if (definition === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Choose one of the office workflows',
          requestId: request.id,
        },
      });
    }
    return { draft: await dependencies.assistant.draft(definition, body.sentence) };
  });

  /** Prepares the person whose turn it is: checked facts and a recommendation. */
  app.post('/api/requests/:requestId/brief', { schema: assistSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as OfficeScope;
    const { requestId } = request.params as { requestId: string };
    const denial = await officeScopeDenial(dependencies, auth.userId, body);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    // Help with a stage is for whoever may take it: 'requests.create' is the
    // floor every office role holds; the stage's own authority is checked below.
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, body),
      'requests.create',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'use the assistant here');
    const found = await load(body.organizationId, requestId);
    if (found === undefined || !visible(found, auth.userId, body, authz.effective)) {
      return notFound(reply, request.id);
    }
    const stage = found.pendingStageDefinition;
    const about = await forAssistant(found);
    if (
      stage === undefined ||
      about === undefined ||
      !(await mayTakePending(found, body, authz.effective, auth.userId))
    ) {
      return sendForbidden(reply, request.id, 'take this request at its current stage');
    }
    const brief = await dependencies.assistant.brief(about, stage, await factsFor(found));
    const loaded = found.version;
    found.noteAssistance(auth.userId, `prepared a brief for "${stage.label}" (${brief.source})`);
    // Best effort: the brief is still useful if someone else changed the request meanwhile.
    await dependencies.requests.update(found, loaded);
    return { brief };
  });

  /** Drafts the written part of the pending step, for the person to edit. */
  app.post('/api/requests/:requestId/write', { schema: assistSchema }, async (request, reply) => {
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
    if (!authz.ok) return sendForbidden(reply, request.id, 'use the assistant here');
    const found = await load(body.organizationId, requestId);
    if (found === undefined || !visible(found, auth.userId, body, authz.effective)) {
      return notFound(reply, request.id);
    }
    const stage = found.pendingStageDefinition;
    const about = await forAssistant(found);
    if (
      stage === undefined ||
      about === undefined ||
      !(await mayTakePending(found, body, authz.effective, auth.userId))
    ) {
      return sendForbidden(reply, request.id, 'take this request at its current stage');
    }
    const written = await dependencies.assistant.write(about, stage);
    const loaded = found.version;
    found.noteAssistance(
      auth.userId,
      `drafted "${stage.noteLabel ?? stage.label}" (${written.source})`,
    );
    await dependencies.requests.update(found, loaded);
    return { written };
  });
}
