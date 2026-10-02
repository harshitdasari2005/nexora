/**
 * @nexora/app-api — the weekly review routes.
 *
 *   GET /api/review           the counted facts of the last seven days
 *   GET /api/review/summary   the same facts in a few sentences
 *
 * Read-only. For the roles that read the organization's insights (the chief
 * executive and the heads who hold `insights.read`). The numbers are counted
 * from the records; the assistant only words them.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import { OfficeRequest, type OfficeRequestRepository } from '@nexora/domain-hr';
import { ProjectTask, type ProjectTaskRepository } from '@nexora/domain-projects';

import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import type { OfficeAi } from '../office/office-ai.js';
import {
  buildWeeklyReview,
  reviewByRules,
  spokenHours,
  type WeeklyReview,
} from '../office/review.js';
import { requireAuth } from '../plugins/auth.js';
import { summaryOf } from './office-requests.js';
import {
  denyScope,
  officeScopeDenial,
  officeScopeQuery,
  roleContextOf,
  type OfficeScope,
} from './office-scope.js';
import { sendForbidden } from './permission-response.js';

const schema: FastifySchema = { querystring: officeScopeQuery };

/** Dependencies of the review routes. */
export interface ReviewRoutesDependencies {
  requests: OfficeRequestRepository;
  tasks: ProjectTaskRepository;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  permissions: PermissionResolverDependencies;
  resolveUserName: (userId: string) => Promise<string | undefined>;
  assistant: OfficeAi;
  /** The clock (tests). */
  now?: () => Date;
}

/** The counted facts as lines a person (or the assistant) can read. */
export function reviewFacts(review: WeeklyReview): string[] {
  const { requests, tasks } = review;
  return [
    `Requests raised in the last seven days: ${requests.raised}`,
    `Finished: ${requests.finished}; refused: ${requests.refused}; withdrawn: ${requests.withdrawn}`,
    `Still in motion (waiting for someone): ${requests.inMotion}`,
    ...(requests.typicalHours === undefined
      ? []
      : [`Typical time from raised to finished: ${spokenHours(requests.typicalHours)}`]),
    ...review.waitingAt
      .slice(0, 5)
      .map(
        (step) =>
          `Waiting at "${step.step}" (${step.department}): ${step.count}, longest ${spokenHours(step.longestHours)}`,
      ),
    `Waiting two days or more at one step: ${review.waitingLongest.filter((item) => item.stuck).length}`,
    `Project tasks: ${tasks.done} done this week, ${tasks.inReview} in review, ${tasks.inProgress} in progress, ${tasks.todo} not started, ${tasks.overdue} past the due date`,
    `Requests written with the assistant: ${requests.draftedWithAssistant} of ${requests.raised}`,
  ];
}

/** Registers the weekly review routes. */
export function registerReviewRoutes(
  app: FastifyInstance,
  dependencies: ReviewRoutesDependencies,
): void {
  const read = async (organizationId: string): Promise<WeeklyReview> => {
    const requests = await dependencies.requests.listByOrganization(organizationId as TenantId);
    const tasks = await dependencies.tasks.listByOrganization(organizationId as TenantId);
    return buildWeeklyReview(
      {
        requests: requests.map((request) => OfficeRequest.snapshot(request)),
        tasks: tasks.map((task) => ProjectTask.snapshot(task)),
        summaryOf,
      },
      dependencies.now?.() ?? new Date(),
    );
  };

  app.get('/api/review', { schema }, async (request, reply) => {
    const auth = requireAuth(request);
    const scope = request.query as OfficeScope;
    const denial = await officeScopeDenial(dependencies, auth.userId, scope);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, scope),
      'insights.read',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'read the weekly review');

    const review = await read(scope.organizationId);
    const waitingLongest = [];
    for (const item of review.waitingLongest) {
      const { requestedBy, ...rest } = item;
      const requestedByName = await dependencies.resolveUserName(requestedBy);
      waitingLongest.push({
        ...rest,
        ...(requestedByName === undefined ? {} : { requestedByName }),
      });
    }
    return {
      review: { ...review, waitingLongest },
      summary: reviewByRules(review),
      assistant: dependencies.assistant.status,
    };
  });

  app.get('/api/review/summary', { schema }, async (request, reply) => {
    const auth = requireAuth(request);
    const scope = request.query as OfficeScope;
    const denial = await officeScopeDenial(dependencies, auth.userId, scope);
    if (denial !== undefined) return denyScope(reply, request.id, denial);
    const authz = await authorizePermission(
      dependencies.permissions,
      roleContextOf(auth.userId, scope),
      'insights.read',
    );
    if (!authz.ok) return sendForbidden(reply, request.id, 'read the weekly review');

    const review = await read(scope.organizationId);
    return {
      summary: await dependencies.assistant.summarise(reviewFacts(review), reviewByRules(review)),
    };
  });
}
