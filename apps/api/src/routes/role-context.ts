/**
 * @nexora/app-api — role-context route (S27 Phase 6).
 *
 * `GET /api/role-context` — the CURRENT resolved business role plus every
 * OTHER (organization, workspace) the caller is a genuine member of, each
 * annotated with the role it resolves to. This is the read model behind the
 * role/context switcher: it exposes what {@link MembershipBusinessRoleResolver}
 * already resolves trustedly, one workspace at a time, as a single list — it
 * introduces no new authorization concept and grants nothing itself.
 *
 * Security contract (the same model as Command Center / the Agent surface):
 * - Every option comes from the caller's OWN membership read models
 *   (`listOrganizations`, `listMyWorkspaces`) — never a client-supplied list.
 * - The role attached to each option is resolved the SAME way the Command
 *   Center and AI Runtime resolve it (the shared `roleResolver` + catalog) —
 *   never fabricated, never guessed from a workspace name.
 * - A (organization, workspace) pair with no resolvable business role is
 *   silently dropped — the switcher only ever offers roles the caller is
 *   actually entitled to use.
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { DomainCatalog } from '@nexora/module-domains';

import { requireAuth } from '../plugins/auth.js';
import type { MembershipBusinessRoleResolver } from '../business-context/business-role-resolver.js';

/** One switchable (organization, workspace) → resolved role option. */
export interface RoleContextOption {
  organizationId: string;
  organizationName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceType: string;
  domainId: string;
  domainName: string;
  roleId: string;
  roleName: string;
}

/** Dependencies of the role-context route. */
export interface RoleContextRoutesDependencies {
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** The SAME trusted resolver the Command Center and AI Runtime use. */
  roleResolver: MembershipBusinessRoleResolver;
  /** The SAME Phase 1 catalog (role/domain display names). */
  catalog: DomainCatalog;
}

/** Registers the role-context route. */
export function registerRoleContextRoutes(
  app: FastifyInstance,
  dependencies: RoleContextRoutesDependencies,
): void {
  app.get('/api/role-context', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };

    const organizations = await dependencies.listOrganizations.handle({ userId: auth.userId });
    if (!organizations.ok || organizations.value.length === 0) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }

    const options: RoleContextOption[] = [];
    for (const organization of organizations.value) {
      const workspaces = await dependencies.listMyWorkspaces.handle({
        userId: auth.userId,
        organizationId: organization.id as TenantId,
      });
      if (!workspaces.ok) {
        continue;
      }
      for (const workspace of workspaces.value) {
        const roleId = await dependencies.roleResolver.resolve({
          userId: auth.userId as UserId,
          tenantId: organization.id,
          workspaceId: workspace.id,
        });
        if (roleId === undefined) {
          continue;
        }
        const role = dependencies.catalog.roles.get(roleId);
        const domain =
          role === undefined ? undefined : dependencies.catalog.domains.get(role.domainId);
        options.push({
          organizationId: organization.id,
          organizationName: organization.name,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          workspaceType: workspace.type,
          domainId: role?.domainId ?? '',
          domainName: domain?.name ?? '',
          roleId,
          roleName: role?.name ?? roleId,
        });
      }
    }

    const current =
      (query.workspaceId !== undefined
        ? options.find((option) => option.workspaceId === query.workspaceId)
        : query.organizationId !== undefined
          ? options.find((option) => option.organizationId === query.organizationId)
          : undefined) ??
      options[0] ??
      null;

    return { current, options };
  });
}
