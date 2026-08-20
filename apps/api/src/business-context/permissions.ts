/**
 * @nexora/app-api — RBAC permission resolution (S34).
 *
 * The ONE authoritative permission-resolution seam: trusted membership →
 * effective business role (the SAME {@link MembershipBusinessRoleResolver}
 * every other surface uses) → the Phase 1 catalog's `role.capabilityIds`,
 * read here as the role's REAL permission set, not merely its AI discovery
 * affinity.
 *
 * This module introduces no second authorization system: it is a thin read
 * over the EXISTING Domain → Role → Capability catalog
 * (`@nexora/module-domains`), consumed by route guards
 * ({@link authorizePermission}), by the AI Runtime wiring (the API layer
 * passes the SAME resolved set as `allowedCapabilityIds`), and by the
 * business-agent service (which intersects it against each agent's own
 * static capability set — see `platform/agents`).
 *
 * Semantics, deliberately asymmetric from the existing AI discovery affinity
 * filter: a route guard that REQUIRES a permission treats an empty or
 * unresolvable set as "no permission" (fail closed — a route explicitly
 * asking "can this role do X" must see an explicit grant). The pre-existing
 * AI discovery affinity filter is UNCHANGED and keeps its own semantics (an
 * empty set there still means "unrestricted focus", the S24 default for any
 * role not yet given a real RBAC set here) — the two consumers read the same
 * field but answer different questions, exactly as the S34 catalog comment
 * documents.
 */

import type { DomainCatalog } from '@nexora/module-domains';

import type {
  BusinessRoleResolutionContext,
  MembershipBusinessRoleResolver,
} from './business-role-resolver.js';

/** The caller's effective RBAC permission set, resolved from trusted membership. */
export interface EffectivePermissions {
  /** The resolved business role id (e.g. `executive.ceo`). */
  roleId: string;
  /** The role's owning domain id. */
  domainId: string;
  /**
   * The role's permission set — the SAME `capabilityIds` the Phase 1 catalog
   * already carries, read here as the authoritative answer to "is this role
   * allowed to do X" (never a client-supplied claim).
   */
  permissions: readonly string[];
}

/** Dependencies of {@link resolveEffectivePermissions}. */
export interface PermissionResolverDependencies {
  /** The SAME trusted role resolver every other surface uses. */
  roleResolver: MembershipBusinessRoleResolver;
  /** The SAME Phase 1 Domain → Role → Capability catalog. */
  catalog: DomainCatalog;
}

/**
 * Resolves the caller's effective permission set from TRUSTED membership —
 * never from a client-supplied role, domain, or capability claim. Returns
 * `undefined` when no business role resolves (no membership, or an
 * unrecognized role id) — callers must treat `undefined` the same as "no
 * permissions" for any `authorizePermission` check.
 */
export async function resolveEffectivePermissions(
  dependencies: PermissionResolverDependencies,
  context: BusinessRoleResolutionContext,
): Promise<EffectivePermissions | undefined> {
  const roleId = await dependencies.roleResolver.resolve(context);
  if (roleId === undefined) {
    return undefined;
  }
  const role = dependencies.catalog.roles.get(roleId);
  if (role === undefined) {
    return undefined;
  }
  return { roleId, domainId: role.domainId, permissions: role.capabilityIds };
}

/**
 * The route-guard question: does the caller's EFFECTIVE (trusted) permission
 * set include the required permission? Fail closed — `undefined` or an empty
 * set both mean "no", never "unrestricted" (that fail-open behavior belongs
 * only to the AI discovery affinity filter, a soft focus, never a grant).
 */
export function hasPermission(
  effective: EffectivePermissions | undefined,
  required: string,
): boolean {
  return effective !== undefined && effective.permissions.includes(required);
}

/**
 * Authorizes one required permission for a trusted (user, tenant, workspace)
 * context. This is the single seam every protected route should call —
 * never a bespoke inline role/capability check. A forged role, domain, or
 * capability claim in the request is irrelevant: only the trusted
 * membership → role → catalog path above ever produces `effective`.
 */
export async function authorizePermission(
  dependencies: PermissionResolverDependencies,
  context: BusinessRoleResolutionContext,
  required: string,
): Promise<
  { ok: true; effective: EffectivePermissions } | { ok: false; reason: 'no-role' | 'forbidden' }
> {
  const effective = await resolveEffectivePermissions(dependencies, context);
  if (effective === undefined) {
    return { ok: false, reason: 'no-role' };
  }
  if (!hasPermission(effective, required)) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: true, effective };
}
