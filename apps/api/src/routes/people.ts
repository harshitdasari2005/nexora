/**
 * @nexora/app-api — people and teams.
 *
 * How a real organization fills up: someone allowed to bring people in makes
 * a one-time invite link for one seat in one team; the person who opens it
 * (signed in as themselves) takes that seat. The seat decides the business
 * role, through the same resolver every other surface uses, so the office
 * workflows find the right person at every stage.
 *
 *   GET  /api/people                     who sits where, team by team
 *   POST /api/invites                    make an invite link (shown once)
 *   POST /api/invites/:inviteId/revoke   take an unused link back
 *   GET  /api/invites/preview            what a link would give its opener
 *   POST /api/invites/accept             take the seat
 *
 * Security contract:
 * - Bringing people in needs `members.manage`, as the chief executive of the
 *   organization or from the caller's own seat (HR). Only the chief executive
 *   appoints a team head.
 * - A link carries a random secret; only its hash is stored, it works once,
 *   can be taken back, and stops working after a week.
 * - A link never gives an executive's oversight seat, and nobody is matched to
 *   a link by email: the person who holds the link and is signed in takes it.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import { toOrganizationDto } from '@nexora/application-organizations';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import { toWorkspaceDto } from '@nexora/application-workspaces';
import type {
  MembershipDomainService,
  MembershipRepository,
  OrganizationRepository,
} from '@nexora/domain-organizations';
import {
  INVITE_SEATS,
  inviteExpiry,
  inviteStatus,
  type InviteSeat,
  type WorkspaceInvite,
  type WorkspaceInviteRepository,
  type WorkspaceMembershipRepository,
  type WorkspaceMembershipService,
  type WorkspaceRepository,
} from '@nexora/domain-workspaces';
import type { EventEnvelope } from '@nexora/shared/events';

import { businessRoleForSeat } from '../business-context/business-role-resolver.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { toHttpError } from '../http/errors.js';
import { EXECUTIVE_ROLE_ID } from '../office/request-authority.js';
import { requireAuth } from '../plugins/auth.js';
import { sendForbidden } from './permission-response.js';

/** What each seat is called in an office. */
const SEAT_LABEL: Record<string, string> = {
  owner: 'Team head',
  admin: 'Manager',
  member: 'Team member',
  executive: 'Chief executive (oversight)',
};

const scopeProperties = {
  organizationId: { type: 'string', minLength: 1, maxLength: 64 },
  // The seat the caller acts from (optional: the chief executive needs none).
  workspaceId: { type: 'string', minLength: 1, maxLength: 64 },
} as const;

const listSchema: FastifySchema = {
  querystring: { type: 'object', required: ['organizationId'], properties: scopeProperties },
};
const createSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'teamId', 'seat', 'label'],
    additionalProperties: false,
    properties: {
      ...scopeProperties,
      teamId: { type: 'string', minLength: 1, maxLength: 64 },
      seat: { type: 'string', enum: [...INVITE_SEATS] },
      label: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
};
const revokeSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId'],
    additionalProperties: false,
    properties: scopeProperties,
  },
};
const codeProperty = { type: 'string', minLength: 20, maxLength: 200 } as const;
const previewSchema: FastifySchema = {
  querystring: { type: 'object', required: ['code'], properties: { code: codeProperty } },
};
const acceptSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['code'],
    additionalProperties: false,
    properties: { code: codeProperty },
  },
};

/** Dependencies of the people routes. */
export interface PeopleRoutesDependencies {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  workspaces: WorkspaceRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
  invites: WorkspaceInviteRepository;
  /** Adds a person to the organization (the existing domain service). */
  organizationMembers: MembershipDomainService;
  /** Adds a person to a team and changes seats (the existing domain service). */
  teamMembers: WorkspaceMembershipService;
  listOrganizations: ListOrganizationsHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
  /** Display name of a user (never an email or id leak). */
  resolveUserName: (userId: string) => Promise<string | undefined>;
  publish: (events: readonly EventEnvelope[]) => Promise<void>;
  /** Makes taking a seat all-or-nothing (absent for in-memory fakes). */
  atomically?: <T>(work: () => Promise<T>) => Promise<T>;
}

/** Thrown inside the accept transaction when the link was used meanwhile. */
class InviteGoneError extends Error {}

const hashOf = (code: string): string => createHash('sha256').update(code).digest('hex');

/** Registers the people and invite routes. */
export function registerPeopleRoutes(
  app: FastifyInstance,
  dependencies: PeopleRoutesDependencies,
): void {
  const roleOf = (teamType: string, seat: string) => {
    const roleId = businessRoleForSeat(teamType, seat);
    const role =
      roleId === undefined ? undefined : dependencies.permissions.catalog.roles.get(roleId);
    return { roleId: roleId ?? '', roleName: role?.name ?? SEAT_LABEL[seat] ?? seat };
  };

  const isMember = async (userId: string, organizationId: string): Promise<boolean> => {
    const organizations = await dependencies.listOrganizations.handle({ userId: userId as UserId });
    return organizations.ok && organizations.value.some((org) => org.id === organizationId);
  };

  const notMember = (reply: FastifyReply, requestId: string) =>
    reply.code(403).send({
      error: {
        code: 'AUTHORIZATION_ERROR',
        message: 'You are not a member of this organization',
        requestId,
      },
    });
  const gone = (reply: FastifyReply, requestId: string) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'This invite link is not valid any more. Ask for a new one.',
        requestId,
      },
    });

  /** The team, only when it belongs to the organization. */
  const teamOf = async (organizationId: string, teamId: string) => {
    const team = await dependencies.workspaces.findById(teamId as never);
    return team === undefined || team.organizationId !== organizationId ? undefined : team;
  };

  /**
   * The caller's `members.manage` from their own seat (HR), when that seat is
   * in this organization. The chief executive's organization-wide authority
   * is checked by each handler itself.
   */
  const fromSeat = async (userId: string, organizationId: string, workspaceId?: string) => {
    if (workspaceId === undefined || (await teamOf(organizationId, workspaceId)) === undefined) {
      return { ok: false as const };
    }
    return authorizePermission(
      dependencies.permissions,
      { userId, tenantId: organizationId, workspaceId },
      'members.manage',
    );
  };

  const inviteView = (invite: WorkspaceInvite, teamName: string, teamType: string) => ({
    id: invite.id,
    teamId: invite.workspaceId,
    teamName,
    seat: invite.seat,
    seatLabel: SEAT_LABEL[invite.seat] ?? invite.seat,
    roleName: roleOf(teamType, invite.seat).roleName,
    label: invite.label,
    status: inviteStatus(invite),
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
  });

  // --- Who sits where --------------------------------------------------------

  app.get('/api/people', { schema: listSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId: string; workspaceId?: string };
    if (!(await isMember(auth.userId, query.organizationId))) {
      return notMember(reply, request.id);
    }
    const asExecutive = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId },
      'members.manage',
    );
    const seat = asExecutive.ok
      ? asExecutive
      : await fromSeat(auth.userId, query.organizationId, query.workspaceId);
    const canAddTeam = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId },
      'workspaces.create',
    );

    const teams = [];
    const teamInfo = new Map<string, { name: string; type: string }>();
    const all = await dependencies.workspaces.listByOrganization(query.organizationId as TenantId);
    for (const workspace of all) {
      const team = toWorkspaceDto(workspace);
      if (team.status !== 'active') continue;
      teamInfo.set(team.id, { name: team.name, type: team.type });
      const members = [];
      for (const membership of await dependencies.workspaceMemberships.listByWorkspace(
        workspace.id,
      )) {
        members.push({
          userId: membership.userId,
          name: (await dependencies.resolveUserName(membership.userId)) ?? 'Unnamed person',
          seat: membership.role,
          seatLabel: SEAT_LABEL[membership.role] ?? membership.role,
          ...roleOf(team.type, membership.role),
          you: membership.userId === auth.userId,
        });
      }
      teams.push({
        id: team.id,
        name: team.name,
        type: team.type,
        members,
        // What each seat of this team means, before anyone is invited to it.
        seats: INVITE_SEATS.map((value) => ({
          seat: value,
          label: SEAT_LABEL[value],
          roleName: roleOf(team.type, value).roleName,
        })),
      });
    }

    const invites = [];
    if (seat.ok) {
      for (const invite of await dependencies.invites.listByOrganization(
        query.organizationId as TenantId,
      )) {
        const team = teamInfo.get(invite.workspaceId);
        if (team !== undefined && inviteStatus(invite) === 'open') {
          invites.push(inviteView(invite, team.name, team.type));
        }
      }
    }

    return {
      teams,
      invites,
      can: {
        invite: seat.ok,
        appointHeads: seat.ok && seat.effective.roleId === EXECUTIVE_ROLE_ID,
        addTeam: canAddTeam.ok,
      },
    };
  });

  // --- Make an invite link ---------------------------------------------------

  app.post('/api/invites', { schema: createSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
      workspaceId?: string;
      teamId: string;
      seat: InviteSeat;
      label: string;
    };
    if (!(await isMember(auth.userId, body.organizationId))) {
      return notMember(reply, request.id);
    }
    const asExecutive = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: body.organizationId },
      'members.manage',
    );
    const authz = asExecutive.ok
      ? asExecutive
      : await fromSeat(auth.userId, body.organizationId, body.workspaceId);
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'bring people into the organization');
    }
    if (body.seat === 'owner' && authz.effective.roleId !== EXECUTIVE_ROLE_ID) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'Only the chief executive can appoint a team head',
          requestId: request.id,
        },
      });
    }
    const team = await teamOf(body.organizationId, body.teamId);
    if (team === undefined) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Team not found', requestId: request.id },
      });
    }
    const label = body.label.trim();
    if (label.length === 0) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Say who this invite is for',
          requestId: request.id,
        },
      });
    }

    // The secret is shown once, here; only its hash is kept.
    const code = randomBytes(24).toString('base64url');
    const createdAt = new Date().toISOString();
    const invite: WorkspaceInvite = {
      id: randomUUID(),
      organizationId: body.organizationId as TenantId,
      workspaceId: team.id,
      seat: body.seat,
      tokenHash: hashOf(code),
      label,
      createdBy: auth.userId,
      createdAt,
      expiresAt: inviteExpiry(createdAt),
    };
    await dependencies.invites.insert(invite);
    const dto = toWorkspaceDto(team);
    return reply.code(201).send({ invite: { ...inviteView(invite, dto.name, dto.type), code } });
  });

  // --- Take a link back ------------------------------------------------------

  app.post('/api/invites/:inviteId/revoke', { schema: revokeSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const { inviteId } = request.params as { inviteId: string };
    const body = request.body as { organizationId: string; workspaceId?: string };
    if (!(await isMember(auth.userId, body.organizationId))) {
      return notMember(reply, request.id);
    }
    const asExecutive = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: body.organizationId },
      'members.manage',
    );
    const authz = asExecutive.ok
      ? asExecutive
      : await fromSeat(auth.userId, body.organizationId, body.workspaceId);
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'bring people into the organization');
    }
    const invite = await dependencies.invites.findById(inviteId);
    if (invite === undefined || invite.organizationId !== body.organizationId) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Invite not found', requestId: request.id },
      });
    }
    const revoked = await dependencies.invites.revoke(invite.id, new Date().toISOString());
    if (!revoked) {
      return reply.code(409).send({
        error: {
          code: 'CONFLICT',
          message: 'This invite was already used or taken back',
          requestId: request.id,
        },
      });
    }
    return { revoked: true };
  });

  // --- What a link would give ------------------------------------------------

  const openInvite = async (code: string) => {
    const invite = await dependencies.invites.findByTokenHash(hashOf(code));
    if (invite === undefined || inviteStatus(invite) !== 'open') return undefined;
    const team = await teamOf(invite.organizationId, invite.workspaceId);
    const organization = await dependencies.organizations.findById(invite.organizationId as never);
    if (team === undefined || organization === undefined) return undefined;
    return { invite, team, organization };
  };

  app.get('/api/invites/preview', { schema: previewSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const found = await openInvite((request.query as { code: string }).code);
    if (found === undefined) return gone(reply, request.id);
    const team = toWorkspaceDto(found.team);
    const already = await dependencies.workspaceMemberships.findByWorkspaceAndUser(
      found.team.id,
      auth.userId as UserId,
    );
    return {
      organizationId: found.invite.organizationId,
      organizationName: toOrganizationDto(found.organization).name,
      teamId: team.id,
      teamName: team.name,
      seatLabel: SEAT_LABEL[found.invite.seat] ?? found.invite.seat,
      roleName: roleOf(team.type, found.invite.seat).roleName,
      alreadyInTeam: already !== undefined,
    };
  });

  // --- Take the seat ---------------------------------------------------------

  app.post('/api/invites/accept', { schema: acceptSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const found = await openInvite((request.body as { code: string }).code);
    if (found === undefined) return gone(reply, request.id);
    const { invite, team } = found;
    const userId = auth.userId as UserId;
    if (
      (await dependencies.workspaceMemberships.findByWorkspaceAndUser(team.id, userId)) !==
      undefined
    ) {
      return reply.code(409).send({
        error: {
          code: 'CONFLICT',
          message: 'You are already in this team',
          requestId: request.id,
        },
      });
    }

    const actor = { kind: 'user' as const, id: auth.userId };
    const teamContext = { actor, correlationId: request.id, organizationId: invite.organizationId };
    const run = dependencies.atomically ?? (<T>(work: () => Promise<T>) => work());
    let events: EventEnvelope[];
    try {
      events = await run(async () => {
        const emitted: EventEnvelope[] = [];
        // First, so that of two people opening the same link exactly one goes on.
        if (!(await dependencies.invites.markUsed(invite.id, userId, new Date().toISOString()))) {
          throw new InviteGoneError();
        }
        const inOrganization = await dependencies.memberships.findByOrganizationAndUser(
          invite.organizationId as never,
          userId,
        );
        if (inOrganization === undefined) {
          const joinedOrganization = await dependencies.organizationMembers.addMember(
            invite.organizationId as never,
            userId,
            'member',
            { actor, correlationId: request.id },
          );
          if (!joinedOrganization.ok) throw joinedOrganization.error;
          emitted.push(...joinedOrganization.value.events);
        }
        const joined = await dependencies.teamMembers.addMember(
          team.id,
          userId,
          invite.seat,
          teamContext,
        );
        if (!joined.ok) throw joined.error;
        emitted.push(...joined.value.events);

        // A founder runs a new team until its head arrives. Once the head has
        // joined, the founder keeps an oversight seat there: they still see the
        // team, and stay the chief executive instead of being its head too.
        if (invite.seat === 'owner') {
          for (const other of await dependencies.workspaceMemberships.listByWorkspace(team.id)) {
            if (other.userId === userId || other.role !== 'owner') continue;
            const inOrg = await dependencies.memberships.findByOrganizationAndUser(
              invite.organizationId as never,
              other.userId,
            );
            if (inOrg?.role !== 'owner') continue;
            const stepped = await dependencies.teamMembers.changeRole(
              team.id,
              other.userId,
              'executive',
              teamContext,
            );
            if (!stepped.ok) throw stepped.error;
            emitted.push(...stepped.value.events);
          }
        }
        return emitted;
      });
    } catch (error) {
      if (error instanceof InviteGoneError) return gone(reply, request.id);
      const http = toHttpError(error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    await dependencies.publish(events);

    const dto = toWorkspaceDto(team);
    return {
      organizationId: invite.organizationId,
      workspaceId: team.id,
      teamName: dto.name,
      seatLabel: SEAT_LABEL[invite.seat] ?? invite.seat,
      roleName: roleOf(dto.type, invite.seat).roleName,
    };
  });
}
