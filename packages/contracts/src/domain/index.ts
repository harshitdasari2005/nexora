/**
 * @nexora/contracts — domain definition contracts (S24 Phase 1).
 *
 * The Domain → Role → Capability definition vocabulary for the role-aware AI
 * operating system. These are BUSINESS-CONTEXT definitions, not
 * authorization primitives:
 *
 * - A `DomainDefinition` is an organizational operating domain (e.g.
 *   `finance`, `technology`, `legal`) that owns roles.
 * - A `DomainRoleDefinition` is a business role (e.g. `technology.cto`) that
 *   belongs to exactly one domain and may reference capabilities as business
 *   affinity. A role NEVER grants authorization (ROLE ≠ PERMISSION).
 * - A `CapabilityDefinition` is a stable, machine-readable operation
 *   vocabulary item (e.g. `projects.read`). Capabilities are registered
 *   globally — they span domains and roles — and map to an existing Nexora
 *   operation where one exists.
 *
 * The existing authorization system (`@nexora/contracts/identity`
 * `RoleDefinition` / `PermissionDecision`) remains the SINGLE authority for
 * access control. Nothing in this vocabulary is consulted by the
 * authorization path; it is resolved as definitions only (S24 security
 * contract: the server, never the model, grants access).
 */

/** A stable, machine-readable business domain id, e.g. `technology` (single lowercase segment). */
export type DomainId = string;

/** A stable, machine-readable business role id, namespaced by domain, e.g. `technology.cto`. */
export type DomainRoleId = string;

/** A stable, machine-readable capability id, e.g. `projects.read`. */
export type CapabilityId = string;

/**
 * A registered business domain — the root of the Domain → Role →
 * Capability hierarchy (S24 Phase 1). Domains are organizational operating
 * areas (e.g. `executive`, `finance`, `technology`, `legal`). The platform
 * core is domain-agnostic: it never references a domain by name and renders
 * whatever domains are registered.
 */
export interface DomainDefinition {
  /** Stable, machine-readable domain id, e.g. `technology`. */
  id: DomainId;
  /** Human-readable domain name, e.g. `Technology`. */
  name: string;
  /** Optional description of the domain's purpose. */
  description?: string;
  /** Role ids owned by this domain (each must resolve to a role of this domain). */
  roleIds: readonly string[];
}

/**
 * A business role belonging to exactly one domain (S24 Phase 1). Roles are
 * BUSINESS CONTEXT — `technology.cto`, `finance.cfo` — and are never
 * equivalent to authorization permissions. The `capabilityIds` are business
 * affinity only; nothing grants access through a role (ROLE ≠ PERMISSION).
 */
export interface DomainRoleDefinition {
  /** Stable, machine-readable role id, namespaced by domain, e.g. `technology.cto`. */
  id: DomainRoleId;
  /** Human-readable role name, e.g. `CTO`. */
  name: string;
  /** Optional description of the role's business context. */
  description?: string;
  /** The owning domain id (a role belongs to exactly one domain). */
  domainId: DomainId;
  /** Capability ids the role is associated with (business affinity, never a grant). */
  capabilityIds: readonly string[];
}

/**
 * A stable, machine-readable operation vocabulary item (S24 Phase 1), e.g.
 * `projects.read`. Capabilities are registered globally (they span domains);
 * a capability maps to an existing Nexora operation where one exists and is
 * never presented as executable otherwise. Executability resolution
 * (native tool vs MCP tool) is a later phase.
 */
export interface CapabilityDefinition {
  /** Stable, machine-readable capability id, e.g. `projects.read`. */
  id: CapabilityId;
  /** Human-readable capability name, e.g. `Read Projects`. */
  name: string;
  /** Optional description, including the existing Nexora surface it maps to, when one exists. */
  description?: string;
}
