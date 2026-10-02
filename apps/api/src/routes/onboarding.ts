/**
 * @nexora/app-api — onboarding routes, and the project assignment that follows.
 *
 * A hired person is onboarded with a checklist whose items belong to different
 * parts of the office (HR, IT, the hiring manager). Each item can only be
 * completed by someone holding THAT owner's capability in the workspace they
 * act from; the manager's items additionally belong to the hiring manager of
 * that hire. When the last item is done the employee becomes active — and only
 * an active employee can be assigned to a project.
 *
 * Visibility: HR and the executive see every onboarding; IT sees them all
 * (they have to equip the person); a hiring manager sees their own hires.
 * Anything a caller may not see is reported like something that does not exist.
 */

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import {
  toOnboardingDto,
  type OnboardingApplicationService,
  type OnboardingDto,
} from '@nexora/application-hr';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { AssignEmployeeToProjectHandler } from '@nexora/application-projects';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { EmployeeRepository, Onboarding, OnboardingOwner } from '@nexora/domain-hr';
import type { ProjectRepository, ResourceAssignmentRepository } from '@nexora/domain-projects';

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

/** The capability that lets a caller act for each checklist owner. */
const OWNER_CAPABILITY: Record<OnboardingOwner, string> = {
  hr: 'onboarding.hr',
  it: 'onboarding.it',
  manager: 'onboarding.manager',
};

const scopeProperties = {
  organizationId: { type: 'string', minLength: 1, maxLength: 64 },
  workspaceId: { type: 'string', minLength: 1, maxLength: 64 },
} as const;
const scopeQuery = {
  type: 'object',
  required: ['organizationId', 'workspaceId'],
  properties: scopeProperties,
} as const;

const startSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'employeeId'],
    additionalProperties: false,
    properties: { ...scopeProperties, employeeId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};
const completeSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['onboardingId', 'item'],
    additionalProperties: false,
    properties: {
      onboardingId: { type: 'string', minLength: 1, maxLength: 64 },
      item: { type: 'string', minLength: 1, maxLength: 32 },
    },
  },
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId'],
    additionalProperties: false,
    properties: { ...scopeProperties, note: { type: 'string', maxLength: 300 } },
  },
};
const assignSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['projectId'],
    additionalProperties: false,
    properties: { projectId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'employeeId'],
    additionalProperties: false,
    properties: { ...scopeProperties, employeeId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

/** Dependencies of the onboarding routes. */
export interface OnboardingRoutesDependencies {
  onboarding: OnboardingApplicationService;
  employees: EmployeeRepository;
  projects: ProjectRepository;
  resourceAssignments: ResourceAssignmentRepository;
  assignEmployeeToProject: AssignEmployeeToProjectHandler;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  permissions: PermissionResolverDependencies;
  resolveUserName?: (userId: string) => Promise<string | undefined>;
}

interface Scope {
  organizationId: string;
  workspaceId: string;
}

type OnboardingView = Omit<OnboardingDto, 'items'> & {
  hiringManagerName?: string;
  /** The employee's current lifecycle status (`onboarding` → `active`). */
  employeeStatus?: string;
  jobTitle?: string;
  startDate?: string;
  /** The project the hire was requested for, with its name. */
  projectName?: string;
  /** Whether the employee is already on that project. */
  assignedToProject: boolean;
  /** Whether the CURRENT caller may assign the (active) employee to the project. */
  canAssign: boolean;
  items: readonly (OnboardingDto['items'][number] & {
    doneByName?: string;
    /** Whether the CURRENT caller may complete this item right now. */
    canComplete: boolean;
  })[];
};

/** Registers the onboarding + assignment routes. */
export function registerOnboardingRoutes(
  app: FastifyInstance,
  dependencies: OnboardingRoutesDependencies,
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
  const fail = (reply: FastifyReply, requestId: string, error: unknown) => {
    const http = toHttpError(error as never, requestId);
    return reply.code(http.statusCode).send(http.body);
  };

  /** Whether the caller may see this onboarding at all. */
  const canSee = (
    onboarding: Onboarding,
    userId: string,
    effective: EffectivePermissions | undefined,
  ): boolean =>
    hasPermission(effective, 'onboarding.read') ||
    hasPermission(effective, 'onboarding.hr') ||
    hasPermission(effective, 'onboarding.it') ||
    (hasPermission(effective, 'onboarding.manager') && onboarding.hiringManagerId === userId);

  /** Whether the caller may act for an item's owner on THIS onboarding. */
  const mayComplete = (
    owner: OnboardingOwner,
    onboarding: Onboarding,
    userId: string,
    effective: EffectivePermissions | undefined,
  ): boolean =>
    hasPermission(effective, OWNER_CAPABILITY[owner]) &&
    // The manager's items belong to the hiring manager of this hire, not to any manager.
    (owner !== 'manager' || onboarding.hiringManagerId === userId);

  async function view(
    onboarding: Onboarding,
    userId: string,
    effective: EffectivePermissions | undefined,
  ): Promise<OnboardingView> {
    const dto = toOnboardingDto(onboarding);
    const employee = await dependencies.employees.findById(dto.employeeId as never);
    const project =
      dto.projectId === undefined
        ? undefined
        : await dependencies.projects.findById(dto.projectId as never).catch(() => undefined);
    const inOrganization =
      project !== undefined && project.organizationId === dto.organizationId ? project : undefined;
    const assignment =
      inOrganization === undefined
        ? undefined
        : await dependencies.resourceAssignments.findByProjectAndEmployee(
            inOrganization.id,
            dto.employeeId,
          );
    const hiringManagerName = await dependencies.resolveUserName?.(dto.hiringManagerId);
    const items = [];
    for (const item of dto.items) {
      const doneByName =
        item.doneBy === undefined ? undefined : await dependencies.resolveUserName?.(item.doneBy);
      items.push({
        ...item,
        ...(doneByName === undefined ? {} : { doneByName }),
        canComplete: !item.done && mayComplete(item.owner, onboarding, userId, effective),
      });
    }
    const profile = employee?.profile;
    return {
      ...dto,
      ...(hiringManagerName === undefined ? {} : { hiringManagerName }),
      ...(employee === undefined ? {} : { employeeStatus: employee.status.value }),
      ...(profile?.jobTitle === undefined ? {} : { jobTitle: profile.jobTitle }),
      ...(profile?.startDate === undefined ? {} : { startDate: profile.startDate }),
      ...(inOrganization === undefined ? {} : { projectName: inOrganization.name.value }),
      assignedToProject: assignment !== undefined,
      canAssign:
        inOrganization !== undefined &&
        assignment === undefined &&
        employee?.isActive() === true &&
        // The general capability, or the hiring manager of this hire.
        (hasPermission(effective, 'projects.assign') ||
          (hasPermission(effective, 'onboarding.manager') &&
            onboarding.hiringManagerId === userId)),
      items,
    };
  }

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

  // --- Read -------------------------------------------------------------------

  app.get('/api/onboarding', { schema: { querystring: scopeQuery } }, async (request, reply) => {
    const auth = requireAuth(request);
    const scope = request.query as Scope;
    const entered = await enter(reply, request.id, auth.userId, scope);
    if (entered === undefined) return reply;
    const { effective } = entered;
    const anyRole = [
      'onboarding.read',
      'onboarding.hr',
      'onboarding.it',
      'onboarding.manager',
    ].some((capability) => hasPermission(effective, capability));
    if (!anyRole) return sendForbidden(reply, request.id, 'view onboarding');

    const onboardings = [];
    for (const onboarding of await dependencies.onboarding.list(scope.organizationId as TenantId)) {
      if (canSee(onboarding, auth.userId, effective)) {
        onboardings.push(await view(onboarding, auth.userId, effective));
      }
    }
    // HR also sees the people who were hired but whose onboarding has not started.
    const canStart = hasPermission(effective, 'onboarding.hr');
    const readyToStart = canStart
      ? (await dependencies.onboarding.listReadyToStart(scope.organizationId as TenantId)).map(
          (employee) => ({
            employeeId: employee.id,
            name: employee.name.value,
            ...(employee.profile?.jobTitle === undefined
              ? {}
              : { jobTitle: employee.profile.jobTitle }),
            ...(employee.profile?.department === undefined
              ? {}
              : { department: employee.profile.department }),
            ...(employee.profile?.startDate === undefined
              ? {}
              : { startDate: employee.profile.startDate }),
          }),
        )
      : [];
    return { onboardings, readyToStart, canStart };
  });

  // --- Start (HR) ---------------------------------------------------------------

  app.post('/api/onboarding', { schema: startSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = request.body as Scope & { employeeId: string };
    const entered = await enter(reply, request.id, auth.userId, input);
    if (entered === undefined) return reply;
    const authz = await authorizePermission(
      dependencies.permissions,
      context(auth.userId, input),
      'onboarding.hr',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'start an onboarding');
    const result = await dependencies.onboarding.start({
      organizationId: input.organizationId as TenantId,
      employeeId: input.employeeId,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) return fail(reply, request.id, result.error);
    return reply
      .code(201)
      .send({ onboarding: await view(result.value, auth.userId, authz.effective) });
  });

  // --- Complete an item (the item's owner) ----------------------------------------

  app.post(
    '/api/onboarding/:onboardingId/items/:item/complete',
    { schema: completeSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { onboardingId, item: itemKey } = request.params as {
        onboardingId: string;
        item: string;
      };
      const input = request.body as Scope & { note?: string };
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      const found = await dependencies.onboarding.get(
        input.organizationId as TenantId,
        onboardingId,
      );
      if (!found.ok || !canSee(found.value, auth.userId, entered.effective)) {
        return notFound(reply, request.id, 'Onboarding');
      }
      const item = found.value.item(itemKey);
      if (item === undefined) return notFound(reply, request.id, 'Onboarding item');
      // The owner is a property of the ITEM (server data), never of the request.
      const authz =
        item.owner === 'hr'
          ? await authorizePermission(
              dependencies.permissions,
              context(auth.userId, input),
              'onboarding.hr',
            )
          : item.owner === 'it'
            ? await authorizePermission(
                dependencies.permissions,
                context(auth.userId, input),
                'onboarding.it',
              )
            : await authorizePermission(
                dependencies.permissions,
                context(auth.userId, input),
                'onboarding.manager',
              );
      if (!authz.ok || !mayComplete(item.owner, found.value, auth.userId, authz.effective)) {
        return sendForbidden(reply, request.id, 'complete this onboarding item');
      }
      const result = await dependencies.onboarding.completeItem({
        organizationId: input.organizationId as TenantId,
        onboardingId,
        item: itemKey,
        ...(input.note === undefined ? {} : { note: input.note }),
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      return { onboarding: await view(result.value, auth.userId, authz.effective) };
    },
  );

  // --- Assign an active employee to a project ---------------------------------------

  app.post(
    '/api/projects/:projectId/assignments',
    { schema: assignSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { projectId } = request.params as { projectId: string };
      const input = request.body as Scope & { employeeId: string };
      const entered = await enter(reply, request.id, auth.userId, input);
      if (entered === undefined) return reply;
      // Two ways to hold the authority: the general `projects.assign` capability,
      // or being the hiring manager of THIS employee (their own onboarded hire).
      const general = await authorizePermission(
        dependencies.permissions,
        context(auth.userId, input),
        'projects.assign',
      );
      if (!general.ok) {
        const manager = await authorizePermission(
          dependencies.permissions,
          context(auth.userId, input),
          'onboarding.manager',
        );
        const onboarding = manager.ok
          ? await dependencies.onboarding.findForEmployee(
              input.organizationId as TenantId,
              input.employeeId,
            )
          : undefined;
        if (onboarding === undefined || onboarding.hiringManagerId !== auth.userId) {
          return sendForbidden(reply, request.id, 'assign this person to a project');
        }
      }

      const project = await dependencies.projects
        .findById(projectId as never)
        .catch(() => undefined);
      if (project === undefined || project.organizationId !== input.organizationId) {
        return notFound(reply, request.id, 'Project');
      }
      const employee = await dependencies.employees
        .findById(input.employeeId as never)
        .catch(() => undefined);
      if (employee === undefined || employee.organizationId !== input.organizationId) {
        return notFound(reply, request.id, 'Employee');
      }
      // Only an ACTIVE employee can be put on a project (onboarding must be finished).
      if (!employee.isActive()) {
        return reply.code(422).send({
          error: {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'Only an active employee can be assigned — finish their onboarding first',
            requestId: request.id,
          },
        });
      }
      const result = await dependencies.assignEmployeeToProject.handle({
        organizationId: input.organizationId as TenantId,
        projectId,
        employeeId: input.employeeId,
        actorId: auth.userId as UserId,
        correlationId: request.id,
      });
      if (!result.ok) return fail(reply, request.id, result.error);
      return reply.code(201).send({
        assignment: {
          projectId,
          employeeId: input.employeeId,
          projectName: project.name.value,
          employeeName: employee.name.value,
        },
      });
    },
  );
}
