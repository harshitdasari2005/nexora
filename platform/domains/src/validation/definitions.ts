/**
 * @nexora/module-domains — definition validation (S24 Phase 1).
 *
 * Deterministic, registration-time validation of Domain → Role → Capability
 * definitions (ENGINEERING_PLAYBOOK.md §4: fail loud at the edge; prefer
 * startup/registration-time validation over discovering invalid
 * configuration during runtime). Validation rules (S24):
 *
 * 1. Duplicate domain ids are rejected (enforced by DomainRegistry).
 * 2. Duplicate role ids are rejected (enforced by RoleRegistry).
 * 3. Duplicate capability ids are rejected (enforced by CapabilityRegistry).
 * 4. A role referencing an unknown domain is rejected.
 * 5. A role referencing an unknown capability is rejected.
 * 6. A domain cannot contain duplicate roles.
 * 7. A role cannot contain duplicate capabilities.
 * 8. Invalid ids are rejected per Nexora conventions (lowercase dotted
 *    machine-readable ids; role ids are namespaced by their domain).
 *
 * Roles are validated against the registries at registration time (domains
 * and capabilities are registered first); catalog integrity (domain ↔ role
 * ownership, both directions) is asserted after a full registration batch.
 */

import type { FieldIssue } from '@nexora/shared/errors';
import type {
  CapabilityDefinition,
  DomainDefinition,
  DomainRoleDefinition,
} from '@nexora/contracts/domain';
import { InvalidDefinitionError, UnknownReferenceError } from '../errors.js';

/** The registry surface the catalog-integrity check needs. */
export interface CatalogForIntegrity {
  domains: {
    list(): readonly DomainDefinition[];
    get(id: string): DomainDefinition | undefined;
  };
  roles: {
    list(): readonly DomainRoleDefinition[];
    get(id: string): DomainRoleDefinition | undefined;
  };
}

/** Maximum length of a machine-readable definition id. */
export const MAX_DEFINITION_ID_LENGTH = 128;

/** Maximum length of a human-readable definition name. */
export const MAX_DEFINITION_NAME_LENGTH = 120;

/** A domain id: a single lowercase segment, e.g. `technology`. */
const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9]*$/;

/** A role segment (the part after the domain prefix), e.g. `engineering_manager`. */
const ROLE_SEGMENT_PATTERN = /^[a-z][a-z0-9_]*$/;

/** A capability id: lowercase dotted segments, e.g. `projects.read`. */
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)*$/;

/** Returns true when the value is a syntactically valid domain id. */
export function isValidDomainId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_DEFINITION_ID_LENGTH && DOMAIN_ID_PATTERN.test(id);
}

/** Returns true when the value is a syntactically valid role segment. */
export function isValidRoleSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= MAX_DEFINITION_ID_LENGTH &&
    ROLE_SEGMENT_PATTERN.test(segment)
  );
}

/** Returns true when the value is a syntactically valid capability id. */
export function isValidCapabilityId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_DEFINITION_ID_LENGTH && CAPABILITY_ID_PATTERN.test(id);
}

/** Returns true when the value is a non-empty, length-bounded name. */
export function isValidDefinitionName(name: string): boolean {
  return name.trim().length > 0 && name.length <= MAX_DEFINITION_NAME_LENGTH;
}

/**
 * Validates a {@link DomainDefinition} and throws an
 * {@link InvalidDefinitionError} on the first batch of issues. Rules:
 * id format, name, duplicate `roleIds`, and role ids namespaced by the
 * domain id.
 */
export function validateDomainDefinition(def: DomainDefinition): void {
  const issues: FieldIssue[] = [];
  if (!isValidDomainId(def.id)) {
    issues.push({
      path: 'id',
      message: `Invalid domain id '${def.id}' (expected a single lowercase segment, e.g. 'technology')`,
    });
  }
  if (!isValidDefinitionName(def.name)) {
    issues.push({ path: 'name', message: 'Domain name must be a non-empty string' });
  }
  const seen = new Set<string>();
  for (const roleId of def.roleIds) {
    if (seen.has(roleId)) {
      issues.push({
        path: `roleIds[${roleId}]`,
        message: `Duplicate role '${roleId}' in domain '${def.id}'`,
      });
    }
    seen.add(roleId);
    const segment = roleId.startsWith(`${def.id}.`) ? roleId.slice(def.id.length + 1) : null;
    if (segment === null || !isValidRoleSegment(segment)) {
      issues.push({
        path: `roleIds[${roleId}]`,
        message: `Role '${roleId}' is not namespaced by domain '${def.id}' (expected '${def.id}.<role>')`,
      });
    }
  }
  if (issues.length > 0) {
    throw new InvalidDefinitionError('domain', def.id, issues);
  }
}

/**
 * Validates a {@link CapabilityDefinition} and throws an
 * {@link InvalidDefinitionError} on the first batch of issues. Rules: id
 * format and name.
 */
export function validateCapabilityDefinition(def: CapabilityDefinition): void {
  const issues: FieldIssue[] = [];
  if (!isValidCapabilityId(def.id)) {
    issues.push({
      path: 'id',
      message: `Invalid capability id '${def.id}' (expected lowercase dotted segments, e.g. 'projects.read')`,
    });
  }
  if (!isValidDefinitionName(def.name)) {
    issues.push({ path: 'name', message: 'Capability name must be a non-empty string' });
  }
  if (issues.length > 0) {
    throw new InvalidDefinitionError('capability', def.id, issues);
  }
}

/**
 * Validates a {@link DomainRoleDefinition} against the registered domains
 * and capabilities (S24 rules 4, 5, 7, 8). Throws an
 * {@link UnknownReferenceError} when the domain or a capability does not
 * exist, and an {@link InvalidDefinitionError} for structural issues
 * (id format/namespacing, name, duplicate capabilities).
 */
export function validateRoleDefinition(
  def: DomainRoleDefinition,
  deps: { domains: { has(id: string): boolean }; capabilities: { has(id: string): boolean } },
): void {
  if (!isValidDomainId(def.domainId)) {
    throw new InvalidDefinitionError('role', def.id, [
      {
        path: 'domainId',
        message: `Invalid domain id '${def.domainId}' in role '${def.id}'`,
      },
    ]);
  }
  const segment = def.id.startsWith(`${def.domainId}.`)
    ? def.id.slice(def.domainId.length + 1)
    : null;
  const issues: FieldIssue[] = [];
  if (segment === null || !isValidRoleSegment(segment)) {
    issues.push({
      path: 'id',
      message: `Invalid role id '${def.id}' (expected '<domain>.<role>', e.g. 'technology.cto' matching domainId '${def.domainId}')`,
    });
  }
  if (!isValidDefinitionName(def.name)) {
    issues.push({ path: 'name', message: 'Role name must be a non-empty string' });
  }
  if (!deps.domains.has(def.domainId)) {
    throw new UnknownReferenceError('role', def.id, 'domain', def.domainId);
  }
  const seen = new Set<string>();
  for (const capabilityId of def.capabilityIds) {
    if (seen.has(capabilityId)) {
      issues.push({
        path: `capabilityIds[${capabilityId}]`,
        message: `Duplicate capability '${capabilityId}' in role '${def.id}'`,
      });
    }
    seen.add(capabilityId);
    if (!deps.capabilities.has(capabilityId)) {
      throw new UnknownReferenceError('role', def.id, 'capability', capabilityId);
    }
  }
  if (issues.length > 0) {
    throw new InvalidDefinitionError('role', def.id, issues);
  }
}

/**
 * Cross-validates catalog integrity AFTER a registration batch: every
 * `domain.roleIds` entry must resolve to a registered role owned by that
 * domain, and every registered role must be listed by its owning domain.
 * Returns the field issues (empty when the catalog is consistent).
 */
export function validateCatalogIntegrity(catalog: CatalogForIntegrity): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const domain of catalog.domains.list()) {
    for (const roleId of domain.roleIds) {
      const role = catalog.roles.get(roleId);
      if (role === undefined) {
        issues.push({
          path: `domains.${domain.id}.roleIds[${roleId}]`,
          message: `Role '${roleId}' of domain '${domain.id}' is not registered`,
        });
      } else if (role.domainId !== domain.id) {
        issues.push({
          path: `domains.${domain.id}.roleIds[${roleId}]`,
          message: `Role '${roleId}' belongs to domain '${role.domainId}', not '${domain.id}'`,
        });
      }
    }
  }
  for (const role of catalog.roles.list()) {
    const domain = catalog.domains.get(role.domainId);
    if (domain === undefined) {
      // Unreachable: role registration rejects unknown domains. Guarded for
      // integrity completeness.
      issues.push({
        path: `roles.${role.id}.domainId`,
        message: `Role '${role.id}' references unregistered domain '${role.domainId}'`,
      });
    } else if (!domain.roleIds.includes(role.id)) {
      issues.push({
        path: `domains.${domain.id}.roleIds`,
        message: `Role '${role.id}' is registered for domain '${domain.id}' but not listed in its roleIds`,
      });
    }
  }
  return issues;
}
