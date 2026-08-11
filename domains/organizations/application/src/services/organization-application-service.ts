/**
 * @nexora/application-organizations — OrganizationApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): it coordinates the
 * organizations domain services, collects emitted domain events, and
 * publishes them through the {@link EventPublisher} port. It contains no
 * business rules of its own — every invariant is enforced by the domain.
 */

import type { UserId } from '@nexora/contracts/common';
import type { EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import type {
  MembershipDomainService,
  MembershipRepository,
  OrganizationDomainService,
  OrganizationEventContext,
} from '@nexora/domain-organizations';

import type {
  CreateOrganizationCommand,
  CreateOrganizationResult,
} from '../commands/create-organization.command.js';
import { toOrganizationDto, type OrganizationDto } from '../dto/organization.dto.js';
import { validateCreateOrganization } from '../validators/create-organization.validator.js';

/** Dependencies of the {@link OrganizationApplicationService}. */
export interface OrganizationApplicationServiceDependencies {
  /** The organization lifecycle domain service. */
  organizationsService: OrganizationDomainService;
  /** The membership domain service. */
  membershipsService: MembershipDomainService;
  /** Membership persistence (user → organizations read model). */
  membershipsRepository: MembershipRepository;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
}

/**
 * The organizations application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class OrganizationApplicationService {
  readonly #organizationsService: OrganizationDomainService;
  readonly #membershipsService: MembershipDomainService;
  readonly #membershipsRepository: MembershipRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: OrganizationApplicationServiceDependencies) {
    this.#organizationsService = dependencies.organizationsService;
    this.#membershipsService = dependencies.membershipsService;
    this.#membershipsRepository = dependencies.membershipsRepository;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Creates an organization and provisions it for the creator: create
   * (`provisioning`) → activate → add the creator as the first `owner`
   * (docs/AGGREGATES.md first-owner provisioning flow). Emitted events are
   * published once, after the whole sequence succeeds.
   */
  async createOrganization(
    command: CreateOrganizationCommand,
  ): Promise<Result<CreateOrganizationResult, NexoraError>> {
    try {
      validateCreateOrganization(command);
      const context = organizationContext(command.actorId, command.correlationId);

      const created = await this.#organizationsService.create(
        {
          slug: command.slug,
          name: command.name,
          type: command.type,
          description: command.description,
        },
        context,
      );
      if (!created.ok) {
        return err(created.error);
      }

      const activated = await this.#organizationsService.activate(
        created.value.organization.id,
        context,
      );
      if (!activated.ok) {
        return err(activated.error);
      }

      const joined = await this.#membershipsService.addMember(
        created.value.organization.id,
        command.actorId,
        'owner',
        context,
      );
      if (!joined.ok) {
        return err(joined.error);
      }

      const events = [...created.value.events, ...activated.value.events, ...joined.value.events];
      await this.#publisher.publish(events);

      return ok({
        organization: created.value.organization,
        membership: joined.value.membership,
        events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected organization application error'));
    }
  }

  /**
   * Lists the organizations a user belongs to (their memberships), mapped
   * to DTOs. Memberships are resolved with a single batched query (no
   * N+1 lookups per membership).
   */
  async listOrganizationsByUser(
    userId: UserId,
  ): Promise<Result<readonly OrganizationDto[], never>> {
    const memberships = await this.#membershipsRepository.listByUser(userId);
    const ids = memberships.map((membership) => membership.organizationId);
    const organizations = await this.#organizationsService.findByIds(ids);
    return ok(organizations.map((organization) => toOrganizationDto(organization)));
  }
}

/** Builds an organizations event context (tenant resolved from the org id). */
function organizationContext(actorId: string, correlationId: string): OrganizationEventContext {
  return { actor: { kind: 'user', id: actorId }, correlationId };
}
