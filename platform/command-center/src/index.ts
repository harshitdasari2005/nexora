/**
 * @nexora/module-command-center — public surface.
 *
 * The generic Command Center engine (S24 Phase 2): role-aware workspaces
 * resolved from the Phase 1 Domain → Role catalog and rendered by ONE
 * engine — no role-specific pages, no hard-coded job titles. This barrel is
 * the only import surface — consumers never reach into subfolders.
 *
 * Security contract (S24): definitions grant nothing. The effective
 * business role is resolved by the {@link CommandCenterRoleResolver}
 * implementation from trusted membership, every widget data source keeps
 * enforcing the existing tenant/workspace/authorization model, and the
 * engine fails safely when a role has no command center registered.
 */

export {
  CommandCenterError,
  DuplicateCommandCenterError,
  InvalidCommandCenterError,
  UnknownRoleReferenceError,
  toCommandCenterError,
} from './errors.js';
export {
  CommandCenterApplicationService,
  GetCommandCenterHandler,
  type CommandCenterContext,
  type CommandCenterDomainCatalogPort,
  type CommandCenterRoleResolver,
  type CommandCenterWidgetDataProvider,
  type ResolveCommandCenterResult,
} from './application/command-center-application-service.js';
export { CommandCenterRegistry } from './registry/command-center-registry.js';
export { INITIAL_COMMAND_CENTERS } from './seed/initial-command-centers.js';
export {
  COMMAND_CENTER_DATA_SOURCES,
  COMMAND_CENTER_WIDGET_TYPES,
  isSupportedDataSource,
  isValidCommandCenterId,
  isValidWidgetType,
  validateCommandCenterDefinition,
  type CommandCenterCatalogForValidation,
} from './validation/definitions.js';
