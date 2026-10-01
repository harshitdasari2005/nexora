/**
 * @nexora/module-workflow — WorkflowApplicationService.
 *
 * The application layer of the workflow bounded context (BACKEND.md §4): the
 * command/query surface over the {@link WorkflowRuntime}. It contains no
 * business rules of its own — every invariant lives in the domain (definition
 * validation, instance transitions) and the runtime (dependency evaluation,
 * approval gating, idempotency). Cross-domain capability execution happens
 * through the injected step executor, never inside this service.
 */

import type { TenantId } from '@nexora/contracts/common';
import type {
  WorkflowExecutionRecord,
  WorkflowInstance as WorkflowInstanceContract,
} from '@nexora/contracts/workflow';
import type { Result } from '@nexora/shared/result';

import type { WorkflowError } from '../domain/errors.js';
import type { WorkflowRuntime, WorkflowRunContext } from '../runtime/workflow-runtime.js';

/** Command: start a workflow instance from a definition key. */
export interface StartWorkflowCommand {
  /** The definition key to execute. */
  definitionKey: string;
  /** The trusted run context (identity/tenant never caller-supplied). */
  context: WorkflowRunContext;
  /** The workflow input (user-controlled business values). */
  input: Record<string, unknown>;
}

/** Command: resume a workflow paused for a step approval. */
export interface ResumeWorkflowCommand {
  /** The workflow instance id. */
  workflowId: string;
  /** The recorded approval request id (server-resolved). */
  approvalId: string;
}

/** Command: cancel a running workflow. */
export interface CancelWorkflowCommand {
  /** The workflow instance id. */
  workflowId: string;
  /** The cancelling actor (authenticated user id). */
  actorId: string;
  /** Tenant scope (trusted). */
  tenantId: TenantId;
}

/** Query: read a workflow execution record. */
export interface RecoverWorkflowCommand {
  workflowId: string;
  tenantId: TenantId;
}

export interface GetWorkflowQuery {
  /** The workflow instance id. */
  workflowId: string;
  /** Tenant scope (trusted). */
  tenantId: TenantId;
}

/** Query: list the workflows of a tenant. */
export interface ListWorkflowsQuery {
  /** Tenant scope (trusted). */
  tenantId: TenantId;
}

/**
 * The workflow application service.
 */
export class WorkflowApplicationService {
  readonly #runtime: WorkflowRuntime;

  constructor(runtime: WorkflowRuntime) {
    this.#runtime = runtime;
  }

  /**
   * The capability ids (and their tool ids) a registered definition's steps
   * invoke — the set an initiator must hold before the workflow may start.
   * `undefined` when the definition key is unknown.
   */
  requiredCapabilities(
    definitionKey: string,
  ): readonly { capabilityId: string; toolId: string }[] | undefined {
    return this.#runtime.requiredCapabilities(definitionKey);
  }

  /** Starts a workflow and runs it to a terminal state. */
  start(command: StartWorkflowCommand): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#runtime.create(command);
  }

  /** Resumes a workflow after a granted (or rejected) approval decision. */
  resume(command: ResumeWorkflowCommand): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#runtime.resume(command);
  }

  /** Cancels a running workflow. */
  cancel(command: CancelWorkflowCommand): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#runtime.cancel(command);
  }

  /** Reads a workflow execution record (tenant-scoped). */
  recover(
    command: RecoverWorkflowCommand,
  ): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#runtime.recover(command);
  }

  get(query: GetWorkflowQuery): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#runtime.get(query);
  }

  /** Lists the workflows of a tenant (newest first). */
  list(
    query: ListWorkflowsQuery,
  ): Promise<Result<readonly WorkflowInstanceContract[], WorkflowError>> {
    return this.#runtime.list(query);
  }
}

/** Handles {@link StartWorkflowCommand}. */
export class StartWorkflowHandler {
  readonly #service: WorkflowApplicationService;
  constructor(service: WorkflowApplicationService) {
    this.#service = service;
  }
  handle(command: StartWorkflowCommand): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#service.start(command);
  }
}

/** Handles {@link ResumeWorkflowCommand}. */
export class ResumeWorkflowHandler {
  readonly #service: WorkflowApplicationService;
  constructor(service: WorkflowApplicationService) {
    this.#service = service;
  }
  handle(command: ResumeWorkflowCommand): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#service.resume(command);
  }
}

/** Handles {@link CancelWorkflowCommand}. */
export class CancelWorkflowHandler {
  readonly #service: WorkflowApplicationService;
  constructor(service: WorkflowApplicationService) {
    this.#service = service;
  }
  handle(command: CancelWorkflowCommand): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#service.cancel(command);
  }
}

/** Handles {@link GetWorkflowQuery}. */
export class GetWorkflowHandler {
  readonly #service: WorkflowApplicationService;
  constructor(service: WorkflowApplicationService) {
    this.#service = service;
  }
  handle(query: GetWorkflowQuery): Promise<Result<WorkflowExecutionRecord, WorkflowError>> {
    return this.#service.get(query);
  }
}

/** Handles {@link ListWorkflowsQuery}. */
export class ListWorkflowsHandler {
  readonly #service: WorkflowApplicationService;
  constructor(service: WorkflowApplicationService) {
    this.#service = service;
  }
  handle(
    query: ListWorkflowsQuery,
  ): Promise<Result<readonly WorkflowInstanceContract[], WorkflowError>> {
    return this.#service.list(query);
  }
}
