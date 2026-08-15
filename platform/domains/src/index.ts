/**
 * @nexora/module-domains — public surface.
 *
 * The Domain → Role → Capability definition registry (S24 Phase 1): the
 * domain-agnostic foundation for role-aware Nexora experiences. This barrel
 * is the only import surface — consumers never reach into subfolders.
 *
 * Security contract (S24): these are DEFINITIONS ONLY. Nothing here grants
 * authorization; the existing authorization system remains authoritative
 * (ROLE ≠ PERMISSION, and the server — never the model — grants access).
 */

export {
  DomainDefinitionError,
  DuplicateDefinitionError,
  InvalidDefinitionError,
  UnknownReferenceError,
  toDomainDefinitionError,
  type DefinitionKind,
} from './errors.js';
export {
  DomainApplicationService,
  GetDomainCatalogHandler,
  type CapabilityDto,
  type DomainCatalogView,
  type DomainDto,
  type DomainRoleDto,
} from './application/domain-application-service.js';
export { CapabilityRegistry } from './registry/capability-registry.js';
export { DomainRegistry } from './registry/domain-registry.js';
export { RoleRegistry, type RoleRegistryDependencies } from './registry/role-registry.js';
export {
  assertCatalogIntegrity,
  createEmptyCatalog,
  createInitialCatalog,
  registerInitialDefinitions,
  type DomainCatalog,
} from './seed/domain-catalog.js';
export {
  INITIAL_CAPABILITIES,
  INITIAL_DOMAINS,
  INITIAL_ROLES,
} from './seed/initial-definitions.js';
export {
  isValidCapabilityId,
  isValidDefinitionName,
  isValidDomainId,
  isValidRoleSegment,
  validateCapabilityDefinition,
  validateCatalogIntegrity,
  validateDomainDefinition,
  validateRoleDefinition,
} from './validation/definitions.js';
