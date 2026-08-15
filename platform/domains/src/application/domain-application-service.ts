/**
 * @nexora/module-domains — DomainApplicationService.
 *
 * The read-only application surface of the domain catalog (S24 Phase 1):
 * one query returning the registered domains (with their roles) and the
 * global capability vocabulary. The service exposes DEFINITIONS only — it
 * contains no authorization logic, no tenant/workspace/user context, and no
 * mutation. The existing authorization system remains authoritative; this
 * surface is the discovery seam future phases (Command Center, role-aware
 * AI) consume.
 */

import type { CapabilityDefinition, DomainRoleDefinition } from '@nexora/contracts/domain';
import type { DomainCatalog } from '../seed/domain-catalog.js';

/** A capability as exposed to consumers (definition only). */
export interface CapabilityDto {
  /** Stable capability id, e.g. `projects.read`. */
  id: string;
  /** Human-readable capability name. */
  name: string;
  /** Optional description. */
  description?: string;
}

/** A role as exposed to consumers (business context, never a grant). */
export interface DomainRoleDto {
  /** Stable role id, e.g. `technology.cto`. */
  id: string;
  /** Human-readable role name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Capability ids associated with the role (business affinity). */
  capabilityIds: readonly string[];
}

/** A domain as exposed to consumers, with its roles resolved. */
export interface DomainDto {
  /** Stable domain id, e.g. `technology`. */
  id: string;
  /** Human-readable domain name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** The roles owned by the domain. */
  roles: readonly DomainRoleDto[];
}

/** The full read-only catalog view. */
export interface DomainCatalogView {
  /** All registered domains (with their roles). */
  domains: readonly DomainDto[];
  /** The global capability vocabulary. */
  capabilities: readonly CapabilityDto[];
}

/** The domain catalog application service. */
export class DomainApplicationService {
  readonly #catalog: DomainCatalog;

  constructor(catalog: DomainCatalog) {
    this.#catalog = catalog;
  }

  /** Returns the registered domains (with roles) and capabilities. */
  getCatalogView(): DomainCatalogView {
    const capabilities = this.#catalog.capabilities.list().map(toCapabilityDto);
    const domains = this.#catalog.domains.list().map((domain): DomainDto => {
      const roles = this.#catalog.roles.resolveByDomain(domain.id).map(toRoleDto);
      return {
        id: domain.id,
        name: domain.name,
        ...(domain.description === undefined ? {} : { description: domain.description }),
        roles,
      };
    });
    return { domains, capabilities };
  }
}

/** Handles the read-only catalog query. */
export class GetDomainCatalogHandler {
  readonly #service: DomainApplicationService;

  constructor(service: DomainApplicationService) {
    this.#service = service;
  }

  handle(): DomainCatalogView {
    return this.#service.getCatalogView();
  }
}

/** Maps a capability definition to its DTO (omitting absent descriptions). */
function toCapabilityDto(def: CapabilityDefinition): CapabilityDto {
  return {
    id: def.id,
    name: def.name,
    ...(def.description === undefined ? {} : { description: def.description }),
  };
}

/** Maps a role definition to its DTO (omitting absent descriptions). */
function toRoleDto(def: DomainRoleDefinition): DomainRoleDto {
  return {
    id: def.id,
    name: def.name,
    ...(def.description === undefined ? {} : { description: def.description }),
    capabilityIds: [...def.capabilityIds],
  };
}
