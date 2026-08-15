/**
 * @nexora/app-api — membership business-role resolver (S24 Phase 3).
 *
 * The SINGLE trusted source of business-role resolution: derives the
 * caller's effective BUSINESS role from trusted membership — the workspace
 * membership role when a workspace scope is present, otherwise the
 * organization membership role. A role/domain supplied by the client (URL,
 * query, body, AI, frontend state) is NEVER consulted.
 *
 * Both the Command Center (Phase 2) and the AI Runtime (Phase 3) consume
 * this resolver, so the UI and the AI can never disagree about who the user
 * is — one source of truth (S24 Phase 3 DoD: Command Center role == AI
 * Runtime role).
 *
 * The mapping (owner → executive.ceo, admin → delivery.manager, member →
 * technology.developer) is a deterministic first-party default. It is
 * config here, not in any engine — the engines resolve definitions from the
 * registered Phase 1 catalog and never hard-code a job title.
 */

import type { MembershipRepository } from '@nexora/domain-organizations';
import type { WorkspaceMembershipRepository } from '@nexora/domain-workspaces';

/** The trusted context both consumers resolve a business role from. */
export interface BusinessRoleResolutionContext {
  /** The authenticated user (trusted). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The verified workspace scope, when present (trusted). */
  workspaceId?: string;
}

/** The membership role → business role default mapping (first-party seed). */
const MEMBERSHIP_ROLE_TO_BUSINESS_ROLE: Readonly<Record<string, string>> = {
  owner: 'executive.ceo',
  admin: 'delivery.manager',
  member: 'technology.developer',
};

/** Dependencies of the resolver. */
export interface MembershipBusinessRoleResolverDependencies {
  /** Organization memberships (tenant-level fallback scope). */
  memberships: MembershipRepository;
  /** Workspace memberships (preferred scope when a workspace is present). */
  workspaceMemberships: WorkspaceMembershipRepository;
}

/** Resolves the effective business role from trusted membership. */
export class MembershipBusinessRoleResolver {
  readonly #memberships: MembershipRepository;
  readonly #workspaceMemberships: WorkspaceMembershipRepository;

  constructor(dependencies: MembershipBusinessRoleResolverDependencies) {
    this.#memberships = dependencies.memberships;
    this.#workspaceMemberships = dependencies.workspaceMemberships;
  }

  async resolve(context: BusinessRoleResolutionContext): Promise<string | undefined> {
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
