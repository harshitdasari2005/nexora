/**
 * @nexora/domain-organizations — OrganizationDomainService.
 *
 * Orchestrates the {@link Organization} aggregate lifecycle (DOMAIN_MODEL.md
 * §1, §7): creation, activation, suspension, archival, and settings/profile
 * updates. Owns the use-case workflows that span the aggregate and its
 * repository; the aggregate enforces its own invariants.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';

import type { OrganizationEventContext } from '../events/index.js';
import { Organization } from '../entities/organization.js';
import type { OrganizationProfileUpdate } from '../entities/organization-profile.js';
import type { OrganizationSettingsUpdate } from '../entities/organization-settings.js';
import type {
  InvalidOrganizationValueError,
  OrganizationArchivedError,
  OrganizationStateTransitionError,
  SlugAlreadyExistsError,
} from '../errors/index.js';
import { OrganizationNotFoundError, toOrganizationError } from '../errors/index.js';
import type { OrganizationRepository } from '../repositories/index.js';
import {
  OrganizationArchivalPolicy,
  OrganizationLifecyclePolicy,
  SlugUniquenessPolicy,
} from '../policies/index.js';
import type { OrganizationId } from '../value-objects/organization-id.js';
import { OrganizationSlug } from '../value-objects/organization-slug.js';
import { OrganizationStatus } from '../value-objects/organization-status.js';
import { OrganizationType } from '../value-objects/organization-type.js';

/** Input for creating an organization. */
export interface CreateOrganizationCommand {
  /** The globally unique slug. */
  slug: string;
  /** The organization name. */
  name: string;
  /** The provisioning type (one of `ORGANIZATION_TYPES`). */
  type: string;
  /** Optional description. */
  description?: string;
  /** Optional website. */
  website?: string;
  /** Optional contact email. */
  contactEmail?: string;
  /** Optional initial status (defaults to `provisioning`). */
  status?: string;
}

/** The outcome of an organization command: the aggregate plus emitted events. */
export interface OrganizationCommandResult {
  /** The mutated aggregate. */
  organization: Organization;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link OrganizationDomainService}. */
export interface OrganizationDomainServiceDependencies {
  /** Organization persistence. */
  organizations: OrganizationRepository;
  /** Lifecycle policy (status transitions). */
  lifecycle?: OrganizationLifecyclePolicy;
  /** Archival policy (archival + mutation gating). */
  archival?: OrganizationArchivalPolicy;
  /** Slug uniqueness policy (domain contract). */
  slugPolicy?: SlugUniquenessPolicy;
}

/**
 * The organization lifecycle use-case service. All methods return a `Result`
 * so expected failures are explicit values, not exceptions.
 */
export class OrganizationDomainService {
  readonly #organizations: OrganizationRepository;
  readonly #lifecycle: OrganizationLifecyclePolicy;
  readonly #archival: OrganizationArchivalPolicy;
  readonly #slugPolicy: SlugUniquenessPolicy;

  constructor(dependencies: OrganizationDomainServiceDependencies) {
    this.#organizations = dependencies.organizations;
    this.#lifecycle = dependencies.lifecycle ?? new OrganizationLifecyclePolicy();
    this.#archival = dependencies.archival ?? new OrganizationArchivalPolicy();
    this.#slugPolicy = dependencies.slugPolicy ?? new SlugUniquenessPolicy();
  }

  /**
   * Creates a new organization: validates the input, checks slug uniqueness,
   * creates the aggregate in `provisioning`, and persists it.
   */
  async create(
    input: CreateOrganizationCommand,
    context: OrganizationEventContext,
  ): Promise<
    Result<OrganizationCommandResult, InvalidOrganizationValueError | SlugAlreadyExistsError>
  > {
    try {
      const slug = OrganizationSlug.create(input.slug);
      this.#slugPolicy.assertSlugAvailable(await this.#organizations.existsBySlug(slug));
      const type = OrganizationType.from(input.type);
      const organization = Organization.create(
        {
          slug,
          name: input.name,
          type,
          description: input.description,
          website: input.website,
          contactEmail: input.contactEmail,
          status: input.status === undefined ? undefined : OrganizationStatus.from(input.status),
        },
        context,
      );
      await this.#organizations.save(organization);
      return ok({ organization, events: organization.pullDomainEvents() });
    } catch (error) {
      return err(
        toOrganizationError(error) as InvalidOrganizationValueError | SlugAlreadyExistsError,
      );
    }
  }

  /**
   * Activates an organization (`provisioning` → `active`).
   */
  async activate(
    organizationId: OrganizationId,
    context: OrganizationEventContext,
  ): Promise<
    Result<OrganizationCommandResult, OrganizationNotFoundError | OrganizationStateTransitionError>
  > {
    try {
      const organization = await this.#requireOrganization(organizationId);
      this.#lifecycle.assertCanTransition(organization.status, OrganizationStatus.active());
      organization.activate(context);
      await this.#organizations.save(organization);
      return ok({ organization, events: organization.pullDomainEvents() });
    } catch (error) {
      return err(
        toOrganizationError(error) as OrganizationNotFoundError | OrganizationStateTransitionError,
      );
    }
  }

  /**
   * Suspends an organization (`active` → `suspended`).
   */
  async suspend(
    organizationId: OrganizationId,
    reason: string,
    context: OrganizationEventContext,
  ): Promise<
    Result<OrganizationCommandResult, OrganizationNotFoundError | OrganizationStateTransitionError>
  > {
    try {
      const organization = await this.#requireOrganization(organizationId);
      this.#lifecycle.assertCanTransition(organization.status, OrganizationStatus.suspended());
      organization.suspend(reason, context);
      await this.#organizations.save(organization);
      return ok({ organization, events: organization.pullDomainEvents() });
    } catch (error) {
      return err(
        toOrganizationError(error) as OrganizationNotFoundError | OrganizationStateTransitionError,
      );
    }
  }

  /**
   * Archives an organization (`active`/`suspended` → `archived`). Archived is
   * terminal in v1: data and audit are retained, mutations are rejected.
   */
  async archive(
    organizationId: OrganizationId,
    reason: string,
    context: OrganizationEventContext,
  ): Promise<
    Result<OrganizationCommandResult, OrganizationNotFoundError | OrganizationStateTransitionError>
  > {
    try {
      const organization = await this.#requireOrganization(organizationId);
      this.#archival.assertCanArchive(organization.status);
      organization.archive(reason, context);
      await this.#organizations.save(organization);
      return ok({ organization, events: organization.pullDomainEvents() });
    } catch (error) {
      return err(
        toOrganizationError(error) as OrganizationNotFoundError | OrganizationStateTransitionError,
      );
    }
  }

  /**
   * Updates organization settings and emits `organization.settings_updated`
   * with the changed keys. Archived organizations reject mutations.
   */
  async updateSettings(
    organizationId: OrganizationId,
    update: OrganizationSettingsUpdate,
    context: OrganizationEventContext,
  ): Promise<
    Result<
      OrganizationCommandResult,
      OrganizationNotFoundError | OrganizationArchivedError | InvalidOrganizationValueError
    >
  > {
    try {
      const organization = await this.#requireOrganization(organizationId);
      this.#archival.assertCanMutate(organization.status);
      organization.updateSettings(update, context);
      await this.#organizations.save(organization);
      return ok({ organization, events: organization.pullDomainEvents() });
    } catch (error) {
      return err(
        toOrganizationError(error) as
          OrganizationNotFoundError | OrganizationArchivedError | InvalidOrganizationValueError,
      );
    }
  }

  /**
   * Updates the organization profile. Archived organizations reject mutations.
   */
  async updateProfile(
    organizationId: OrganizationId,
    update: OrganizationProfileUpdate,
  ): Promise<
    Result<
      OrganizationCommandResult,
      OrganizationNotFoundError | OrganizationArchivedError | InvalidOrganizationValueError
    >
  > {
    try {
      const organization = await this.#requireOrganization(organizationId);
      this.#archival.assertCanMutate(organization.status);
      organization.updateProfile(update);
      await this.#organizations.save(organization);
      return ok({ organization, events: organization.pullDomainEvents() });
    } catch (error) {
      return err(
        toOrganizationError(error) as
          OrganizationNotFoundError | OrganizationArchivedError | InvalidOrganizationValueError,
      );
    }
  }

  /** Finds an organization by id, or returns a {@link OrganizationNotFoundError}. */
  async findById(
    organizationId: OrganizationId,
  ): Promise<Result<Organization, OrganizationNotFoundError>> {
    const organization = await this.#organizations.findById(organizationId);
    if (organization === undefined) {
      return err(new OrganizationNotFoundError({ organizationId }));
    }
    return ok(organization);
  }

  /**
   * Finds several organizations in one batched query (read-model batch; no
   * per-member N+1). Missing ids are simply omitted from the result.
   */
  async findByIds(ids: readonly OrganizationId[]): Promise<readonly Organization[]> {
    return this.#organizations.listByIds(ids);
  }

  /** Finds an organization by slug, or returns a {@link OrganizationNotFoundError}. */
  async findBySlug(
    slug: string,
  ): Promise<Result<Organization, OrganizationNotFoundError | InvalidOrganizationValueError>> {
    try {
      const organization = await this.#organizations.findBySlug(OrganizationSlug.create(slug));
      if (organization === undefined) {
        return err(new OrganizationNotFoundError({ slug }));
      }
      return ok(organization);
    } catch (error) {
      return err(
        toOrganizationError(error) as OrganizationNotFoundError | InvalidOrganizationValueError,
      );
    }
  }

  /** Loads an organization or throws {@link OrganizationNotFoundError}. */
  async #requireOrganization(organizationId: OrganizationId): Promise<Organization> {
    const organization = await this.#organizations.findById(organizationId);
    if (organization === undefined) {
      throw new OrganizationNotFoundError({ organizationId });
    }
    return organization;
  }
}
