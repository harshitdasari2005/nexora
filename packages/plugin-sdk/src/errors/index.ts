/**
 * @nexora/plugin-sdk — SDK errors.
 *
 * Plugin-specific errors extending the shared `NexoraError` hierarchy
 * (`@nexora/shared/errors`). Codes follow the API error taxonomy
 * (API_CONTRACTS.md §10) and are stable machine-readable identifiers.
 */

import { NexoraError } from '@nexora/shared/errors';

/** Base class for all Plugin SDK errors. */
export class PluginSdkError extends NexoraError {
  /**
   * @param message - human-readable message.
   * @param code    - stable error code (API_CONTRACTS.md §10 taxonomy).
   * @param details - optional structured details.
   * @param cause   - optional originating error.
   */
  constructor(message: string, code: string, details?: unknown, cause?: unknown) {
    super(message, code as never, details, cause);
  }
}

/** The plugin manifest failed validation (SAD.md §7.11). */
export class PluginValidationError extends PluginSdkError {
  /** The validation issues that failed. */
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[], details?: unknown) {
    super(message, 'PLUGIN_VALIDATION_ERROR', { issues, details }, undefined);
    this.issues = issues;
  }
}

/** A plugin could not be installed (generic install pipeline failure). */
export class PluginInstallationError extends PluginSdkError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'PLUGIN_INSTALLATION_ERROR', details, cause);
  }
}

/** A declared plugin dependency is missing or outside its allowed range. */
export class PluginDependencyError extends PluginSdkError {
  /** The dependency that failed. */
  readonly dependency: { id: string; range: string };

  constructor(dependency: { id: string; range: string }, message: string, details?: unknown) {
    super(message, 'PLUGIN_DEPENDENCY_ERROR', { dependency, details }, undefined);
    this.dependency = dependency;
  }
}

/** The plugin is incompatible with the current platform or SDK version. */
export class PluginCompatibilityError extends PluginSdkError {
  constructor(message: string, details?: unknown) {
    super(message, 'PLUGIN_COMPATIBILITY_ERROR', details);
  }
}

/** A lifecycle transition was invalid or a lifecycle operation failed. */
export class PluginLifecycleError extends PluginSdkError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, 'PLUGIN_LIFECYCLE_ERROR', details, cause);
  }
}
