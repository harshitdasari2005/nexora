/**
 * @nexora/module-command-center — command-center validation (S24 Phase 2).
 *
 * Deterministic, registration-time validation of CommandCenterDefinitions
 * (ENGINEERING_PLAYBOOK.md §4: fail loud at the edge; prefer
 * startup/registration-time validation over discovering invalid
 * configuration during runtime). Validation rules:
 *
 * 1. Duplicate command-center ids are rejected (enforced by the registry).
 * 2. Duplicate widget ids within a command center are rejected.
 * 3. Duplicate action ids within a command center are rejected.
 * 4. A widget must use a supported widget type (`kpi` | `activity` |
 *    `attention` | `list`).
 * 5. A widget must reference a supported data source (the provider
 *    vocabulary — the same source vocabulary the API-side provider serves).
 * 6. Actions must be `navigate` kind with a non-empty `href`.
 * 7. The command center's domain and role must resolve in the Phase 1
 *    domain catalog, and the role must belong to that domain (S24: the
 *    engine binds roles from the registered Domain → Role model only).
 *
 * Definitions are code/config registered at startup — deterministic, no
 * per-request scans (S22 budgets preserved).
 */

import type { FieldIssue } from '@nexora/shared/errors';
import type { CommandCenterDefinition } from '@nexora/contracts/command-center';
import { InvalidCommandCenterError, UnknownRoleReferenceError } from '../errors.js';

/** The data-source vocabulary the API-side widget provider serves (S24 Phase 2). */
export const COMMAND_CENTER_DATA_SOURCES: readonly string[] = [
  'measurements.overview.users',
  'measurements.overview.projects',
  'measurements.overview.workspaces',
  'projects.active',
  'employees.active',
  'workflows.health',
  'activity.recent',
  'notifications.unread',
  'projects.list',
  'employees.list',
  'documents.list',
  'knowledge.articles',
  'budgets.active',
  'budgets.utilization',
  'budgets.health',
  'expenses.pending',
] as const;

/** The supported widget types (the minimum reusable renderer set). */
export const COMMAND_CENTER_WIDGET_TYPES: readonly string[] = [
  'kpi',
  'activity',
  'attention',
  'list',
] as const;

/** Maximum length of a command-center definition id. */
export const MAX_COMMAND_CENTER_ID_LENGTH = 64;

/** A command-center id: a single lowercase segment, e.g. `ceo`. */
const COMMAND_CENTER_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Returns true when the value is a syntactically valid command-center id. */
export function isValidCommandCenterId(id: string): boolean {
  return (
    id.length > 0 && id.length <= MAX_COMMAND_CENTER_ID_LENGTH && COMMAND_CENTER_ID_PATTERN.test(id)
  );
}

/** Returns true when the value is a supported widget type. */
export function isValidWidgetType(type: string): boolean {
  return COMMAND_CENTER_WIDGET_TYPES.includes(type);
}

/** Returns true when the value is a supported data-source reference. */
export function isSupportedDataSource(dataSource: string): boolean {
  return COMMAND_CENTER_DATA_SOURCES.includes(dataSource);
}

/** The domain-catalog surface the command center validates against. */
export interface CommandCenterCatalogForValidation {
  domains: { has(id: string): boolean };
  roles: { has(id: string): boolean; get(id: string): { domainId: string } | undefined };
}

/**
 * Validates a {@link CommandCenterDefinition} and throws an
 * {@link InvalidCommandCenterError} on the first batch of issues. Cross-
 * checks the bound role against the Phase 1 catalog and throws an
 * {@link UnknownRoleReferenceError} when the domain/role do not resolve or
 * the role belongs to another domain.
 */
export function validateCommandCenterDefinition(
  def: CommandCenterDefinition,
  catalog: CommandCenterCatalogForValidation,
): void {
  const issues: FieldIssue[] = [];
  if (!isValidCommandCenterId(def.id)) {
    issues.push({
      path: 'id',
      message: `Invalid command-center id '${def.id}' (expected a single lowercase segment, e.g. 'ceo')`,
    });
  }
  if (def.name.trim().length === 0) {
    issues.push({ path: 'name', message: 'Command-center name must be a non-empty string' });
  }
  if (!catalog.domains.has(def.domainId)) {
    throw new UnknownRoleReferenceError(def.id, def.domainId, def.roleId);
  }
  const role = catalog.roles.get(def.roleId);
  if (role === undefined || role.domainId !== def.domainId) {
    throw new UnknownRoleReferenceError(def.id, def.domainId, def.roleId);
  }

  const widgetIds = new Set<string>();
  for (const widget of def.widgets) {
    if (widgetIds.has(widget.id)) {
      issues.push({
        path: `widgets[${widget.id}]`,
        message: `Duplicate widget '${widget.id}' in command center '${def.id}'`,
      });
    }
    widgetIds.add(widget.id);
    if (widget.title.trim().length === 0) {
      issues.push({
        path: `widgets[${widget.id}].title`,
        message: `Widget '${widget.id}' must have a non-empty title`,
      });
    }
    if (!isValidWidgetType(widget.type)) {
      issues.push({
        path: `widgets[${widget.id}].type`,
        message: `Unsupported widget type '${widget.type}' (supported: ${COMMAND_CENTER_WIDGET_TYPES.join(', ')})`,
      });
    }
    if (!isSupportedDataSource(widget.dataSource)) {
      issues.push({
        path: `widgets[${widget.id}].dataSource`,
        message: `Unsupported data source '${widget.dataSource}' (supported: ${COMMAND_CENTER_DATA_SOURCES.join(', ')})`,
      });
    }
    if (widget.span !== undefined && widget.span !== 1 && widget.span !== 2) {
      issues.push({
        path: `widgets[${widget.id}].span`,
        message: `Widget '${widget.id}' span must be 1 or 2`,
      });
    }
  }

  const actionIds = new Set<string>();
  for (const action of def.actions) {
    if (actionIds.has(action.id)) {
      issues.push({
        path: `actions[${action.id}]`,
        message: `Duplicate action '${action.id}' in command center '${def.id}'`,
      });
    }
    actionIds.add(action.id);
    if (action.label.trim().length === 0) {
      issues.push({
        path: `actions[${action.id}].label`,
        message: `Action '${action.id}' must have a non-empty label`,
      });
    }
    if (action.kind !== 'navigate') {
      issues.push({
        path: `actions[${action.id}].kind`,
        message: `Unsupported action kind '${action.kind}' (Phase 2 supports 'navigate' only)`,
      });
    }
    if (action.href.trim().length === 0) {
      issues.push({
        path: `actions[${action.id}].href`,
        message: `Action '${action.id}' must have a non-empty href`,
      });
    }
  }

  if (issues.length > 0) {
    throw new InvalidCommandCenterError(def.id, issues);
  }
}
