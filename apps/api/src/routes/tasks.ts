/**
 * @nexora/app-api — project task routes.
 *
 * Project work as it moves between a manager and the person doing it: the
 * manager creates a task on a project and gives it to someone on the team;
 * that person starts it and hands it in; the manager accepts it or sends it
 * back with a reason.
 *
 * `tasks.manage` creates, assigns, sees every task and reviews; `tasks.work`
 * sees and works on one's OWN tasks. The aggregate enforces the rest whoever
 * calls: only the assignee works on a task, and nobody reviews their own work.
 * A task the caller may not see is reported as not found.
 */

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import {
  ProjectTask,
  ProjectTaskId,
  type ProjectRepository,
  type ProjectTaskRepository,
  type TaskPriority,
} from '@nexora/domain-projects';
import type { WorkspaceMembershipRepository } from '@nexora/domain-workspaces';

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

const idParams = {
  type: 'object',
  required: ['taskId'],
  additionalProperties: false,
  properties: { taskId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const createSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'projectId', 'title', 'priority', 'assigneeId'],
    additionalProperties: false,
    properties: {
      ...officeScopeProperties,
      projectId: { type: 'string', minLength: 1, maxLength: 64 },
      title: { type: 'string', minLength: 3, maxLength: 160 },
      description: { type: 'string', maxLength: 2000 },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      dueDate: { type: 'string', minLength: 10, maxLength: 10 },
      assigneeId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
};

const stepSchema = (extra: Record<string, unknown>, required: string[] = []): FastifySchema => ({
  params: idParams,
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', ...required],
    additionalProperties: false,
    properties: { ...officeScopeProperties, ...extra },
  },
});

const startSchema = stepSchema({});
const submitSchema = stepSchema({ comment: { type: 'string', maxLength: 1000 } });
const reviewSchema = stepSchema(
  {
    decision: { type: 'string', enum: ['accept', 'send_back'] },
    comment: { type: 'string', maxLength: 1000 },
  },
  ['decision'],
);
const reassignSchema = stepSchema({ assigneeId: { type: 'string', minLength: 1, maxLength: 64 } }, [
  'assigneeId',
]);
const listSchema: FastifySchema = { querystring: officeScopeQuery };

/** Dependencies of the task routes. */
export interface TaskRoutesDependencies {
  tasks: ProjectTaskRepository;
  projects: ProjectRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
  /** Display name of a user of the trusted tenant (never an email or id leak). */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
}

/** Registers the task routes. */
export function registerTaskRoutes(
  app: FastifyInstance,
  dependencies: TaskRoutesDependencies,
): void {
  const notFound = (reply: FastifyReply, requestId: string) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Task not found', requestId } });
  const badRequest = (reply: FastifyReply, requestId: string, message: string) =>
    reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message, requestId } });
  const conflict = (reply: FastifyReply, requestId: string) =>
    reply.code(409).send({
      error: {
        code: 'CONFLICT',
        message: 'The task was changed by someone else — reload and try again',
        requestId,
      },
    });
  const fail = (reply: FastifyReply, requestId: string, error: unknown) => {
    const http = toHttpError(error, requestId);
    return reply.code(http.statusCode).send(http.body);
  };

  /** Managers see every task; everyone else sees the tasks given to them. */
  const visible = (
    task: ProjectTask,
    userId: string,
    effective: EffectivePermissions | undefined,
  ): boolean =>
    hasPermission(effective, 'tasks.manage') ||
    (hasPermission(effective, 'tasks.work') && task.assigneeId === userId);

  /** Why this person cannot be given tasks from this workspace (undefined when they can). */
  async function assigneeProblem(
    scope: OfficeScope,
    assigneeId: string,
  ): Promise<string | undefined> {
    const membership = await dependencies.workspaceMemberships.findByWorkspaceAndUser(
      scope.workspaceId as WorkspaceId,
      assigneeId as UserId,
    );
    if (membership === undefined) return 'That person is not a member of this team';
    const theirs = await resolveEffectivePermissions(
      dependencies.permissions,
      roleContextOf(assigneeId, scope),
    );
    return hasPermission(theirs, 'tasks.work')
      ? undefined
      : 'That person’s role does not work on project tasks';
  }

  async function view(
    task: ProjectTask,
    userId: string,
    effective: EffectivePermissions | undefined,
    projectNames: Map<string, string>,
  ) {
    const snapshot = ProjectTask.snapshot(task);
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
    const assigneeName = await nameOf(snapshot.assigneeId);
    const createdByName = await nameOf(snapshot.createdBy);
    const projectName = projectNames.get(snapshot.projectId);
    const isAssignee = snapshot.assigneeId === userId;
    const works = hasPermission(effective, 'tasks.work');
    const manages = hasPermission(effective, 'tasks.manage');
    return {
      id: snapshot.id,
      projectId: snapshot.projectId,
      ...(projectName === undefined ? {} : { projectName }),
      title: snapshot.title,
      ...(snapshot.description === undefined ? {} : { description: snapshot.description }),
      priority: snapshot.priority,
      ...(snapshot.dueDate === undefined ? {} : { dueDate: snapshot.dueDate }),
      status: snapshot.status,
      assigneeId: snapshot.assigneeId,
      ...(assigneeName === undefined ? {} : { assigneeName }),
      ...(createdByName === undefined ? {} : { createdByName }),
      mine: isAssignee,
      history,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      actions: {
        canStart: works && isAssignee && snapshot.status === 'todo',
        canSubmit: works && isAssignee && snapshot.status === 'in_progress',
        canReview: manages && !isAssignee && snapshot.status === 'in_review',
        canReassign: manages && snapshot.status !== 'done',
      },
    };
  }

  async function projectNamesOf(organizationId: string): Promise<Map<string, string>> {
    const projects = await dependencies.projects.listByOrganization(organizationId as TenantId);
    return new Map(projects.map((project) => [project.id as string, project.name.value]));
  }

  async function load(organizationId: string, taskId: string): Promise<ProjectTask | undefined> {
    let id: ProjectTaskId;
    try {
      id = ProjectTaskId.from(taskId);
    } catch {
      return undefined;
    }
    const task = await dependencies.tasks.findById(id);
    return task === undefined || task.organizationId !== organizationId ? undefined : task;
  }

  // --- Create --------------------------------------------------------------

  app.post('/api/tasks', { schema: createSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as OfficeScope & {
      projectId: string;
      title: string;
      description?: string;
      priority: TaskPriority;
      dueDate?: string;
      assigneeId: string;
    };
    const denial = await officeScopeDenial(dependencies, auth.userId, body);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, body),
      'tasks.manage',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'create tasks');
    const projectNames = await projectNamesOf(body.organizationId);
    if (!projectNames.has(body.projectId)) {
      return badRequest(
        reply,
        request.id,
        'The selected project does not exist in this organization',
      );
    }
    const problem = await assigneeProblem(body, body.assigneeId);
    if (problem !== undefined) return badRequest(reply, request.id, problem);

    let task: ProjectTask;
    try {
      task = ProjectTask.create({
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        projectId: body.projectId,
        title: body.title,
        ...(body.description === undefined ? {} : { description: body.description }),
        priority: body.priority,
        ...(body.dueDate === undefined ? {} : { dueDate: body.dueDate }),
        assigneeId: body.assigneeId,
        createdBy: auth.userId,
      });
    } catch (error) {
      return fail(reply, request.id, error);
    }
    await dependencies.tasks.insert(task);
    return reply
      .code(201)
      .send({ task: await view(task, auth.userId, authz.effective, projectNames) });
  });

  // --- List ----------------------------------------------------------------

  app.get('/api/tasks', { schema: listSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const scope = request.query as OfficeScope;
    const denial = await officeScopeDenial(dependencies, auth.userId, scope);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const effective = await resolveEffectivePermissions(
      dependencies.permissions,
      roleContextOf(auth.userId, scope),
    );
    const canManage = hasPermission(effective, 'tasks.manage');
    if (!canManage && !hasPermission(effective, 'tasks.work')) {
      return sendForbidden(reply, request.id, 'view tasks');
    }
    const projectNames = await projectNamesOf(scope.organizationId);
    const all = await dependencies.tasks.listByOrganization(scope.organizationId as TenantId);
    const tasks = [];
    for (const task of all) {
      if (visible(task, auth.userId, effective)) {
        tasks.push(await view(task, auth.userId, effective, projectNames));
      }
    }
    // What a manager needs to create a task: the projects, and who on this
    // team can be given work.
    const assignees: { userId: string; name: string }[] = [];
    if (canManage) {
      const members = await dependencies.workspaceMemberships.listByWorkspace(
        scope.workspaceId as WorkspaceId,
      );
      for (const member of members) {
        if ((await assigneeProblem(scope, member.userId)) !== undefined) continue;
        const name = await dependencies.resolveUserName?.(member.userId);
        if (name !== undefined) assignees.push({ userId: member.userId, name });
      }
      assignees.sort((a, b) => a.name.localeCompare(b.name));
    }
    return {
      tasks,
      canManage,
      assignees,
      projects: canManage ? [...projectNames].map(([id, name]) => ({ id, name })) : [],
    };
  });

  // --- The steps -----------------------------------------------------------

  /** Loads a task the caller may see, applies one step and saves it. */
  async function step(
    request: { id: string; body: unknown; params: unknown },
    reply: FastifyReply,
    userId: string,
    effective: EffectivePermissions,
    change: (
      task: ProjectTask,
      scope: OfficeScope,
    ) => Promise<string | undefined> | string | undefined,
  ) {
    const body = request.body as OfficeScope;
    const { taskId } = request.params as { taskId: string };
    const task = await load(body.organizationId, taskId);
    if (task === undefined || !visible(task, userId, effective)) {
      return notFound(reply, request.id);
    }
    const loaded = task.version;
    try {
      const problem = await change(task, body);
      if (problem !== undefined) return badRequest(reply, request.id, problem);
    } catch (error) {
      return fail(reply, request.id, error);
    }
    if (!(await dependencies.tasks.update(task, loaded))) return conflict(reply, request.id);
    return {
      task: await view(task, userId, effective, await projectNamesOf(body.organizationId)),
    };
  }

  app.post('/api/tasks/:taskId/start', { schema: startSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const scope = request.body as OfficeScope;
    const denial = await officeScopeDenial(dependencies, auth.userId, scope);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, scope),
      'tasks.work',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'work on tasks');
    return step(request, reply, auth.userId, authz.effective, (task) => {
      task.start(auth.userId);
      return undefined;
    });
  });

  app.post('/api/tasks/:taskId/submit', { schema: submitSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as OfficeScope & { comment?: string };
    const denial = await officeScopeDenial(dependencies, auth.userId, body);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, body),
      'tasks.work',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'work on tasks');
    return step(request, reply, auth.userId, authz.effective, (task) => {
      task.submit(auth.userId, body.comment);
      return undefined;
    });
  });

  app.post('/api/tasks/:taskId/review', { schema: reviewSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as OfficeScope & {
      decision: 'accept' | 'send_back';
      comment?: string;
    };
    const denial = await officeScopeDenial(dependencies, auth.userId, body);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, body),
      'tasks.manage',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'review tasks');
    return step(request, reply, auth.userId, authz.effective, (task) => {
      task.review({
        actorId: auth.userId,
        decision: body.decision,
        ...(body.comment === undefined ? {} : { comment: body.comment }),
      });
      return undefined;
    });
  });

  app.post('/api/tasks/:taskId/reassign', { schema: reassignSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as OfficeScope & { assigneeId: string };
    const denial = await officeScopeDenial(dependencies, auth.userId, body);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, body),
      'tasks.manage',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'reassign tasks');
    return step(request, reply, auth.userId, authz.effective, async (task, scope) => {
      const problem = await assigneeProblem(scope, body.assigneeId);
      if (problem !== undefined) return problem;
      task.reassign(auth.userId, body.assigneeId);
      return undefined;
    });
  });
}
