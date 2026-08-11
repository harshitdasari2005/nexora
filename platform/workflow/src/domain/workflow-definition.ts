/**
 * @nexora/module-workflow — workflow definitions.
 *
 * Definition validation, the definition registry, and the first deterministic
 * workflow template (SAD.md §12.2): `projects.create_and_assign_employee`.
 *
 * A definition is a pure data contract (`@nexora/contracts/workflow`). Before
 * any instance can run it, the definition is validated: unique step ids, a
 * resolvable start step, a dependency DAG without cycles, resolvable
 * capability/tool references for AI tasks, valid `next` routes, and valid
 * approval-point keys. Validation happens ONCE per definition at registration
 * — a definition that fails validation is never persisted or executed.
 */

import { prefixedId } from '@nexora/shared/ids';
import type { WorkflowDefinition, WorkflowStep } from '@nexora/contracts/workflow';

import { WorkflowDefinitionInvalidError } from './errors.js';

/**
 * The stable key of the first deterministic workflow template: create a
 * project, then assign an employee to it. The assignment MUST NOT execute
 * before the project exists — the definition encodes that dependency.
 */
export const CREATE_PROJECT_AND_ASSIGN_WORKFLOW_KEY = 'projects.create_and_assign_employee';

/**
 * The stable key of the flagship HR workflow template: hire an employee,
 * then assign them to an existing project. The assignment MUST NOT execute
 * before the employee is hired (created + activated) AND the project is
 * resolved — the definition encodes both dependencies.
 */
export const HIRE_AND_ASSIGN_WORKFLOW_KEY = 'hr.hire_and_assign_employee';

/** The capability ids the templates orchestrate. */
export const CREATE_PROJECT_CAPABILITY = 'projects.create_project';
export const FIND_EMPLOYEE_CAPABILITY = 'hr.find_employee';
export const HIRE_EMPLOYEE_CAPABILITY = 'hr.create_employee';
export const FIND_PROJECT_CAPABILITY = 'projects.find_project';
export const ASSIGN_EMPLOYEE_CAPABILITY = 'projects.assign_employee';

/**
 * Builds the CREATE_PROJECT_AND_ASSIGN_EMPLOYEE workflow definition:
 *
 *   create_project ─┐
 *   find_employee  ─┼──→ assign_employee
 *                   ┘
 *
 * `create_project` and `find_employee` have no dependencies (both ready on
 * start); `assign_employee` depends on BOTH — the engine never executes the
 * assignment before the project exists. Step input is bound from the
 * workflow input at execution time via `{{projectName}}` / `{{employeeName}}`
 * placeholders (deterministic binding — never identity).
 */
export function createProjectAndAssignWorkflowDefinition(): WorkflowDefinition {
  const createProject: WorkflowStep = {
    id: 'create_project',
    name: 'Create project',
    kind: 'ai_task',
    capabilityId: CREATE_PROJECT_CAPABILITY,
    toolId: CREATE_PROJECT_CAPABILITY,
    input: { name: '{{projectName}}' },
    dependsOn: [],
    next: {},
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  };
  const findEmployee: WorkflowStep = {
    id: 'find_employee',
    name: 'Find employee',
    kind: 'ai_task',
    capabilityId: FIND_EMPLOYEE_CAPABILITY,
    toolId: FIND_EMPLOYEE_CAPABILITY,
    input: { name: '{{employeeName}}' },
    dependsOn: [],
    next: {},
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  };
  const assignEmployee: WorkflowStep = {
    id: 'assign_employee',
    name: 'Assign employee',
    kind: 'ai_task',
    capabilityId: ASSIGN_EMPLOYEE_CAPABILITY,
    toolId: ASSIGN_EMPLOYEE_CAPABILITY,
    input: { employeeName: '{{employeeName}}', projectName: '{{projectName}}' },
    dependsOn: ['create_project', 'find_employee'],
    next: {},
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  };

  return {
    id: 'wfd_projects_create_and_assign_employee',
    key: CREATE_PROJECT_AND_ASSIGN_WORKFLOW_KEY,
    version: 1,
    startStepId: 'create_project',
    steps: [createProject, findEmployee, assignEmployee],
    // Approval for this workflow happens at the AI-orchestration level (the
    // whole workflow is a gated unit) — no per-step approval points in v1.
    approvalPoints: {},
    // No compensation in v1: a failed assignment leaves the created project
    // intact (recorded, manual recovery — documented in the module README).
    compensation: [],
    timeoutMs: 120_000,
    status: 'active',
  };
}

/**
 * Builds the HIRE_AND_ASSIGN_EMPLOYEE workflow definition (the flagship
 * HR slice):
 *
 *   hire_employee ─┐
 *   find_project  ─┼──→ assign_employee
 *                  ┘
 *
 * `hire_employee` and `find_project` have no dependencies (both ready on
 * start); `assign_employee` depends on BOTH — the assignment can never run
 * before the employee exists (created + activated, BR-16) and the project
 * is resolved. Step input is bound from the workflow input at execution
 * time via `{{employeeName}}` / `{{projectName}}` placeholders
 * (deterministic binding — never identity).
 */
export function hireAndAssignEmployeeWorkflowDefinition(): WorkflowDefinition {
  const hireEmployee: WorkflowStep = {
    id: 'hire_employee',
    name: 'Hire employee',
    kind: 'ai_task',
    capabilityId: HIRE_EMPLOYEE_CAPABILITY,
    toolId: HIRE_EMPLOYEE_CAPABILITY,
    input: { name: '{{employeeName}}' },
    dependsOn: [],
    next: {},
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  };
  const findProject: WorkflowStep = {
    id: 'find_project',
    name: 'Find project',
    kind: 'ai_task',
    capabilityId: FIND_PROJECT_CAPABILITY,
    toolId: FIND_PROJECT_CAPABILITY,
    input: { name: '{{projectName}}' },
    dependsOn: [],
    next: {},
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  };
  const assignEmployee: WorkflowStep = {
    id: 'assign_employee',
    name: 'Assign employee',
    kind: 'ai_task',
    capabilityId: ASSIGN_EMPLOYEE_CAPABILITY,
    toolId: ASSIGN_EMPLOYEE_CAPABILITY,
    input: { employeeName: '{{employeeName}}', projectName: '{{projectName}}' },
    dependsOn: ['hire_employee', 'find_project'],
    next: {},
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  };

  return {
    id: 'wfd_hr_hire_and_assign_employee',
    key: HIRE_AND_ASSIGN_WORKFLOW_KEY,
    version: 1,
    startStepId: 'hire_employee',
    steps: [hireEmployee, findProject, assignEmployee],
    // Approval happens at the AI-orchestration level (the whole workflow is
    // a gated unit) — no per-step approval points in v1.
    approvalPoints: {},
    // No compensation in v1: a failed assignment leaves the hired employee
    // intact (recorded, manual recovery — documented in the module README).
    compensation: [],
    timeoutMs: 120_000,
    status: 'active',
  };
}

/** The outcome of a definition validation pass. */
export type DefinitionValidation =
  { ok: true; definition: WorkflowDefinition } | { ok: false; errors: readonly string[] };

/**
 * Validates a workflow definition (SAD.md §12.2): structural integrity plus
 * the dependency DAG. Throws {@link WorkflowDefinitionInvalidError} on
 * failure — callers validate BEFORE persisting or executing.
 */
export function validateWorkflowDefinition(definition: WorkflowDefinition): DefinitionValidation {
  const errors: string[] = [];
  const stepIds = new Set(definition.steps.map((step) => step.id));

  if (definition.steps.length === 0) {
    errors.push('definition has no steps');
  }
  if (definition.steps.length !== stepIds.size) {
    errors.push('step ids must be unique');
  }
  if (!stepIds.has(definition.startStepId)) {
    errors.push(`startStepId ${definition.startStepId} does not reference a step`);
  }
  if (definition.status !== 'validated' && definition.status !== 'active') {
    errors.push(`definition must be validated or active, got ${definition.status}`);
  }

  for (const step of definition.steps) {
    for (const target of Object.values(step.next)) {
      if (!stepIds.has(target)) {
        errors.push(`step ${step.id} routes to unknown step ${target}`);
      }
    }
    for (const dependency of step.dependsOn ?? []) {
      if (!stepIds.has(dependency)) {
        errors.push(`step ${step.id} depends on unknown step ${dependency}`);
      }
    }
    if (step.kind === 'ai_task' && step.capabilityId === undefined) {
      errors.push(`ai_task step ${step.id} has no capabilityId`);
    }
    if (step.kind === 'ai_task' && step.toolId === undefined) {
      errors.push(`ai_task step ${step.id} has no toolId`);
    }
  }

  for (const key of Object.keys(definition.approvalPoints)) {
    if (!stepIds.has(key)) {
      errors.push(`approvalPoint references unknown step ${key}`);
    }
  }
  for (const spec of definition.compensation ?? []) {
    if (!stepIds.has(spec.forStepId)) {
      errors.push(`compensation references unknown step ${spec.forStepId}`);
    }
  }

  // Dependency DAG: no step may (transitively) depend on itself.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(definition.steps.map((step) => [step.id, step]));
  const visit = (id: string): boolean => {
    if (visited.has(id)) {
      return true;
    }
    if (visiting.has(id)) {
      return false;
    }
    visiting.add(id);
    const step = byId.get(id);
    for (const dependency of step?.dependsOn ?? []) {
      if (!visit(dependency)) {
        return false;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const step of definition.steps) {
    if (!visit(step.id)) {
      errors.push('dependency graph contains a cycle');
      break;
    }
  }

  return errors.length === 0 ? { ok: true, definition } : { ok: false, errors };
}

/**
 * The definition registry: the source of executable workflow templates.
 * Definitions are validated on registration — a template that fails
 * validation is rejected (never executed).
 */
export class WorkflowDefinitionRegistry {
  readonly #definitions = new Map<string, WorkflowDefinition>();

  constructor(definitions: readonly WorkflowDefinition[] = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  /** Registers a definition. Throws {@link WorkflowDefinitionInvalidError} on failure. */
  register(definition: WorkflowDefinition): void {
    const validation = validateWorkflowDefinition(definition);
    if (!validation.ok) {
      throw new WorkflowDefinitionInvalidError({ errors: validation.errors });
    }
    this.#definitions.set(definition.key, validation.definition);
  }

  /** Resolves a definition by stable key, or `undefined`. */
  getByKey(key: string): WorkflowDefinition | undefined {
    return this.#definitions.get(key);
  }

  /** Resolves a definition by id, or `undefined`. */
  getById(id: string): WorkflowDefinition | undefined {
    for (const definition of this.#definitions.values()) {
      if (definition.id === id) {
        return definition;
      }
    }
    return undefined;
  }

  /** All registered definitions. */
  all(): readonly WorkflowDefinition[] {
    return [...this.#definitions.values()];
  }
}

/** Builds the registry with the shipped workflow templates. */
export function defaultWorkflowDefinitions(): WorkflowDefinitionRegistry {
  return new WorkflowDefinitionRegistry([
    createProjectAndAssignWorkflowDefinition(),
    hireAndAssignEmployeeWorkflowDefinition(),
  ]);
}

/** Generates a workflow definition id (`wfd_...`). */
export function newDefinitionId(): string {
  return prefixedId('wfd');
}
