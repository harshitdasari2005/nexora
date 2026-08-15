/**
 * @nexora/app-api — membership command-center role resolver.
 *
 * The S24 Phase 2 {@link CommandCenterRoleResolver} implementation: derives
 * the caller's EFFECTIVE BUSINESS role from TRUSTED membership — the
 * workspace membership role when a workspace scope is present, otherwise the
 * organization membership role. A role/domain supplied by the client (URL,
 * query, body, AI, frontend state) is NEVER consulted: the resolver reads
 * only the repository records for the authenticated user.
 *
 * The mapping (owner → executive.ceo, admin → delivery.manager, member →
 * technology.developer) is a deterministic first-party default for the
 * initial three command centers. It is config here, not in the engine —
 * the engine resolves definitions from the registered Phase 1 catalog and
 * never hard-codes a job title.
 */

import type { MembershipRepository } from '@nexora/domain-organizations';
import type { WorkspaceMembershipRepository } from '@nexora/domain-workspaces';
import type {
  CommandCenterContext,
  CommandCenterRoleResolver,
} from '@nexora/module-command-center';

/** The membership role → business role default mapping (first-party seed). */
const MEMBERSHIP_ROLE_TO_BUSINESS_ROLE: Readonly<Record<string, string>> = {
  owner: 'executive.ceo',
  admin: 'delivery.manager',
  member: 'technology.developer',
};

/** Dependencies of the resolver. */
export interface MembershipCommandCenterRoleResolverDependencies {
  /** Organization memberships (tenant-level fallback scope). */
  memberships: MembershipRepository;
  /** Workspace memberships (preferred scope when a workspace is present). */
  workspaceMemberships: WorkspaceMembershipRepository;
}

/** Resolves the effective business role from trusted membership. */
export class MembershipCommandCenterRoleResolver implements CommandCenterRoleResolver {
  readonly #memberships: MembershipRepository;
  readonly #workspaceMemberships: WorkspaceMembershipRepository;

  constructor(dependencies: MembershipCommandCenterRoleResolverDependencies) {
    this.#memberships = dependencies.memberships;
    this.#workspaceMemberships = dependencies.workspaceMemberships;
  }

  async resolve(context: CommandCenterContext): Promise<string | undefined> {
    if (context.workspaceId !== undefined) {
      const membership = await this.#workspaceMemberships.findByWorkspaceAndUser(
        context.workspaceId as never,
        context.userId as never,
      );
      return membership === undefined
        ? undefined
        : MEMBERSHIP_ROLE_TO_BUSINESS_ROLE[membership.role];
    }
    const membership = await this.#memberships.findByOrganizationAndUser(
      context.tenantId as never,
      context.userId as never,
    );
    return membership === undefined ? undefined : MEMBERSHIP_ROLE_TO_BUSINESS_ROLE[membership.role];
  }
}
