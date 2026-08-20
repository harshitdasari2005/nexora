/**
 * @nexora/app-api — membership business-role resolver (S24 Phase 3; S27
 * Phase 6 added workspace-type-aware resolution for role switching).
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
 * The default mapping (owner → executive.ceo, admin → delivery.manager,
 * member → technology.developer) is a deterministic first-party default,
 * used whenever the workspace has no type-specific override (including the
 * organization-scoped fallback, which has no workspace at all). It is
 * config here, not in any engine — the engines resolve definitions from the
 * registered Phase 1 catalog and never hard-code a job title.
 *
 * Workspace TYPE (WS-R4) is itself trusted, server-controlled data — set at
 * workspace creation, never supplied per-request — so keying an override off
 * it does not introduce a second authorization system: the membership role
 * (owner/admin/member) is still the sole authorization level being resolved,
 * only the BUSINESS ROLE label attached to it becomes workspace-aware. Every
 * override still resolves to an id already present in the Phase 1 catalog —
 * never a fabricated role. Workspace types absent from the table (including
 * `engineering`/`general`, used by existing seed data and tests) fall
 * through to the exact original default mapping — zero behavior change for
 * pre-existing callers.
 */

import type { MembershipRepository } from '@nexora/domain-organizations';
import type { WorkspaceMembershipRepository, WorkspaceRepository } from '@nexora/domain-workspaces';

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

/**
 * Per-workspace-type overrides of the default mapping, keyed by
 * {@link WorkspaceTypeValue}. Every value is an id already registered in the
 * Phase 1 domain/role catalog (never fabricated). Types not listed here
 * (notably `engineering` and `general`, which existing tests and seed data
 * already depend on) keep the original default mapping untouched.
 */
const WORKSPACE_TYPE_ROLE_OVERRIDE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  executive: { owner: 'executive.ceo', admin: 'executive.ceo', member: 'executive.ceo' },
  finance: { owner: 'finance.cfo', admin: 'finance.cfo', member: 'finance.cfo' },
  hr: { owner: 'people.hr', admin: 'people.hr', member: 'people.hr' },
  sales: {
    owner: 'growth.sales_manager',
    admin: 'growth.sales_manager',
    member: 'growth.sales_manager',
  },
  marketing: {
    owner: 'growth.marketing_manager',
    admin: 'growth.marketing_manager',
    member: 'growth.marketing_manager',
  },
  product: {
    owner: 'product.product_lead',
    admin: 'product.product_manager',
    member: 'product.product_manager',
  },
  legal: {
    owner: 'legal.general_counsel',
    admin: 'legal.compliance_manager',
    member: 'legal.compliance_manager',
  },
  operations: {
    owner: 'operations.head',
    admin: 'operations.manager',
    member: 'operations.manager',
  },
  customer_success: {
    owner: 'customersuccess.manager',
    admin: 'customersuccess.support_manager',
    member: 'customersuccess.support_manager',
  },
  procurement: {
    owner: 'procurement.manager',
    admin: 'procurement.vendor_manager',
    member: 'procurement.vendor_manager',
  },
  // `general` had no prior override (fell through to the unconditional
  // default). S33 spends its three membership tiers on the technology
  // domain's own hierarchy — CTO at the top, Engineering Manager in the
  // middle, Developer at the base — so the demo's three technology-domain
  // workspaces (Technology/Engineering/Developer) each resolve to a
  // genuinely different, already-cataloged role rather than all three
  // collapsing onto the generic owner/admin/member default.
  general: {
    owner: 'technology.cto',
    admin: 'technology.engineering_manager',
    member: 'technology.developer',
  },
};

/** Dependencies of the resolver. */
export interface MembershipBusinessRoleResolverDependencies {
  /** Organization memberships (tenant-level fallback scope). */
  memberships: MembershipRepository;
  /** Workspace memberships (preferred scope when a workspace is present). */
  workspaceMemberships: WorkspaceMembershipRepository;
  /**
   * Workspaces (read the trusted TYPE for the workspace-aware override
   * above). Optional so existing tests/composition sites that never pass it
   * keep resolving through the unconditional default mapping.
   */
  workspaces?: WorkspaceRepository;
}

/** Resolves the effective business role from trusted membership. */
export class MembershipBusinessRoleResolver {
  readonly #memberships: MembershipRepository;
  readonly #workspaceMemberships: WorkspaceMembershipRepository;
  readonly #workspaces: WorkspaceRepository | undefined;

  constructor(dependencies: MembershipBusinessRoleResolverDependencies) {
    this.#memberships = dependencies.memberships;
    this.#workspaceMemberships = dependencies.workspaceMemberships;
    this.#workspaces = dependencies.workspaces;
  }

  async resolve(context: BusinessRoleResolutionContext): Promise<string | undefined> {
    if (context.workspaceId !== undefined) {
      const membership = await this.#workspaceMemberships.findByWorkspaceAndUser(
        context.workspaceId as never,
        context.userId as never,
      );
      if (membership === undefined) {
        return undefined;
      }
      const workspace =
        this.#workspaces === undefined
          ? undefined
          : await this.#workspaces.findById(context.workspaceId as never);
      const override =
        workspace === undefined ? undefined : WORKSPACE_TYPE_ROLE_OVERRIDE[workspace.type.value];
      return override?.[membership.role] ?? MEMBERSHIP_ROLE_TO_BUSINESS_ROLE[membership.role];
    }
    const membership = await this.#memberships.findByOrganizationAndUser(
      context.tenantId as never,
      context.userId as never,
    );
    return membership === undefined ? undefined : MEMBERSHIP_ROLE_TO_BUSINESS_ROLE[membership.role];
  }
}
