/**
 * @nexora/module-workflow — domain errors.
 *
 * The workflow bounded context error vocabulary. Every expected failure is a
 * typed value so application/API layers can map it to a safe surface without
 * leaking internals (same convention as the business domains).
 */

/** Base class for all workflow domain errors. */
export class WorkflowError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

/** The workflow definition was not found (or not active). */
export class WorkflowDefinitionNotFoundError extends WorkflowError {
  constructor(input: { key: string }) {
    super('WORKFLOW_DEFINITION_NOT_FOUND', `Workflow definition not found: ${input.key}`);
  }
}

/** The workflow definition failed validation (never persisted). */
export class WorkflowDefinitionInvalidError extends WorkflowError {
  constructor(input: { errors: readonly string[] }) {
    super(
      'WORKFLOW_DEFINITION_INVALID',
      `Workflow definition is invalid: ${input.errors.join('; ')}`,
    );
  }
}

/** The workflow instance was not found. */
export class WorkflowInstanceNotFoundError extends WorkflowError {
  constructor(input: { workflowId: string }) {
    super('WORKFLOW_NOT_FOUND', `Workflow instance not found: ${input.workflowId}`);
  }
}

/** A workflow state transition was not allowed (validate → mutate). */
export class WorkflowStateTransitionError extends WorkflowError {
  constructor(input: { workflowId: string; from: string; to: string; action: string }) {
    super(
      'WORKFLOW_STATE_TRANSITION_ERROR',
      `Cannot ${input.action} a workflow in status ${input.from} (${input.workflowId})`,
    );
  }
}

/** The workflow is not in a state that supports the requested operation. */
export class WorkflowNotRunningError extends WorkflowError {
  constructor(input: { workflowId: string; status: string }) {
    super('WORKFLOW_NOT_RUNNING', `Workflow ${input.workflowId} is not running (${input.status})`);
  }
}

/** A step execution could not be created because a duplicate already exists. */
export class DuplicateStepExecutionError extends WorkflowError {
  constructor(input: { workflowId: string; stepId: string; attempt: number }) {
    super(
      'DUPLICATE_STEP_EXECUTION',
      `Step ${input.stepId} (attempt ${input.attempt}) already executed in workflow ${input.workflowId}`,
    );
  }
}

/** The approval governing a workflow step could not be satisfied. */
export class WorkflowApprovalError extends WorkflowError {
  constructor(message: string) {
    super('WORKFLOW_APPROVAL_ERROR', message);
  }
}
