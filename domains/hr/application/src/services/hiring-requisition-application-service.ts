/**
 * @nexora/application-hr — HiringRequisitionApplicationService.
 *
 * Orchestrates the requisition chain: loads the aggregate inside the trusted
 * organization scope, asks it to make the change (the aggregate owns the
 * rules), persists with optimistic concurrency, then publishes the events.
 *
 * Authority is the caller's concern (RBAC at the API boundary): this service
 * is told WHICH stage the actor is deciding and whether the requester holds
 * the executive authority; it never reads a role itself.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import {
  HiringRequisition,
  RequisitionConflictError,
  RequisitionId,
  RequisitionNotFoundError,
  type HiringRequisitionRepository,
  type RequisitionDetails,
  type RequisitionEventContext,
  type RequisitionStage,
} from '@nexora/domain-hr';

/** Dependencies of the {@link HiringRequisitionApplicationService}. */
export interface HiringRequisitionApplicationServiceDependencies {
  requisitions: HiringRequisitionRepository;
  publisher: EventPublisher;
}

/** Fields common to every requisition command. */
interface RequisitionCommandBase {
  /** The trusted organization (tenant) scope. */
  organizationId: TenantId;
  /** The acting user. */
  actorId: string;
  correlationId: string;
}

export interface SubmitRequisitionCommand extends RequisitionCommandBase {
  /** The workspace (team) the request is raised from. */
  workspaceId: WorkspaceId;
  details: RequisitionDetails;
  /** Whether the requester already holds the executive decision authority. */
  requesterIsExecutive: boolean;
}

export interface DecideRequisitionCommand extends RequisitionCommandBase {
  requisitionId: string;
  /** The stage the actor holds the authority for (established by the caller). */
  stage: RequisitionStage;
  decision: 'approve' | 'reject';
  comment?: string;
}

export interface ReviseRequisitionCommand extends RequisitionCommandBase {
  requisitionId: string;
  details: RequisitionDetails;
  requesterIsExecutive: boolean;
}

export interface WithdrawRequisitionCommand extends RequisitionCommandBase {
  requisitionId: string;
  comment?: string;
}

/** The hiring-requisition application service. Every method returns a `Result`. */
export class HiringRequisitionApplicationService {
  readonly #requisitions: HiringRequisitionRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: HiringRequisitionApplicationServiceDependencies) {
    this.#requisitions = dependencies.requisitions;
    this.#publisher = dependencies.publisher;
  }

  /** Raises a new hiring request. */
  async submit(command: SubmitRequisitionCommand): Promise<Result<HiringRequisition, NexoraError>> {
    try {
      const requisition = HiringRequisition.submit(
        {
          ...command.details,
          organizationId: command.organizationId,
          workspaceId: command.workspaceId,
          requestedBy: command.actorId,
          requesterIsExecutive: command.requesterIsExecutive,
        },
        context(command),
      );
      await this.#requisitions.insert(requisition);
      await this.#publisher.publish(requisition.pullDomainEvents());
      return ok(requisition);
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected hiring request error'));
    }
  }

  /** Records a stage decision (approve advances the chain; reject returns the request). */
  decide(command: DecideRequisitionCommand): Promise<Result<HiringRequisition, NexoraError>> {
    return this.#change(command, (requisition) =>
      requisition.decide(
        {
          stage: command.stage,
          decision: command.decision,
          actorId: command.actorId,
          ...(command.comment === undefined ? {} : { comment: command.comment }),
        },
        context(command),
      ),
    );
  }

  /** The requester revises a returned request and resubmits it. */
  revise(command: ReviseRequisitionCommand): Promise<Result<HiringRequisition, NexoraError>> {
    return this.#change(command, (requisition) =>
      requisition.revise(
        {
          details: command.details,
          actorId: command.actorId,
          requesterIsExecutive: command.requesterIsExecutive,
        },
        context(command),
      ),
    );
  }

  /** The requester withdraws a request that has not been approved. */
  withdraw(command: WithdrawRequisitionCommand): Promise<Result<HiringRequisition, NexoraError>> {
    return this.#change(command, (requisition) =>
      requisition.withdraw(
        {
          actorId: command.actorId,
          ...(command.comment === undefined ? {} : { comment: command.comment }),
        },
        context(command),
      ),
    );
  }

  /** Loads one requisition inside the organization scope (foreign ids are NOT FOUND). */
  async get(
    organizationId: TenantId,
    requisitionId: string,
  ): Promise<Result<HiringRequisition, NexoraError>> {
    try {
      return ok(await this.#require(organizationId, requisitionId));
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected hiring request error'));
    }
  }

  /** Lists the organization's requisitions, newest first. */
  async list(organizationId: TenantId): Promise<readonly HiringRequisition[]> {
    return this.#requisitions.listByOrganization(organizationId);
  }

  /** Loads, mutates, persists (optimistic) and publishes. */
  async #change(
    command: RequisitionCommandBase & { requisitionId: string },
    mutate: (requisition: HiringRequisition) => void,
  ): Promise<Result<HiringRequisition, NexoraError>> {
    try {
      const requisition = await this.#require(command.organizationId, command.requisitionId);
      const loadedVersion = requisition.version;
      mutate(requisition);
      const saved = await this.#requisitions.update(requisition, loadedVersion);
      if (!saved) {
        return err(new RequisitionConflictError({ requisitionId: requisition.id }));
      }
      await this.#publisher.publish(requisition.pullDomainEvents());
      return ok(requisition);
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected hiring request error'));
    }
  }

  async #require(organizationId: TenantId, requisitionId: string): Promise<HiringRequisition> {
    let id: RequisitionId;
    try {
      id = RequisitionId.from(requisitionId);
    } catch {
      // A malformed id is simply a request that does not exist.
      throw new RequisitionNotFoundError({ requisitionId });
    }
    const found = await this.#requisitions.findById(id);
    if (found === undefined || found.organizationId !== organizationId) {
      // A foreign organization's request is indistinguishable from a missing one.
      throw new RequisitionNotFoundError({ requisitionId });
    }
    return found;
  }
}

function context(command: RequisitionCommandBase): RequisitionEventContext {
  return {
    actor: { kind: 'user', id: command.actorId },
    correlationId: command.correlationId,
    organizationId: command.organizationId,
  };
}
