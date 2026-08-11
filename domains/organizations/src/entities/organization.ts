/**
 * @nexora/domain-organizations — Organization aggregate root.
 *
 * The tenancy root of Nexora (DOMAIN_MODEL.md §1 Tenancy; PSD.md §3 CO-1/CO-2):
 * an organization (company) owns its profile (child entity), settings (child
 * entity), lifecycle status, slug, and type. All state changes flow through
 * aggregate methods, which enforce business invariants and record domain
 * events. The id is the tenant id (see value-objects/organization-id.ts).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId } from '@nexora/contracts/common';

import type { OrganizationEventContext } from '../events/index.js';
import {
  organizationActivatedEvent,
  organizationArchivedEvent,
  organizationCreatedEvent,
  organizationSettingsUpdatedEvent,
  organizationSuspendedEvent,
} from '../events/index.js';
import { OrganizationStateTransitionError } from '../errors/index.js';
import { ORG_TRANSITIONS } from '../policies/index.js';
import type { OrganizationId } from '../value-objects/organization-id.js';
import { OrganizationId as OrganizationIdFactory } from '../value-objects/organization-id.js';
import type { OrganizationSlug } from '../value-objects/organization-slug.js';
import { OrganizationStatus } from '../value-objects/organization-status.js';
import type { OrganizationType } from '../value-objects/organization-type.js';
import { OrganizationProfile } from './organization-profile.js';
import type { OrganizationProfileUpdate } from './organization-profile.js';
import { OrganizationSettings } from './organization-settings.js';
import type { OrganizationSettingsUpdate } from './organization-settings.js';

/** Input for creating a new {@link Organization}. */
export interface CreateOrganizationInput {
  /** The globally unique slug (validated). */
  slug: OrganizationSlug;
  /** The organization name. */
  name: string;
  /** The provisioning type. */
  type: OrganizationType;
  /** Optional profile description. */
  description?: string;
  /** Optional profile website. */
  website?: string;
  /** Optional profile contact email. */
  contactEmail?: string;
  /** Optional initial status (defaults to `provisioning`). */
  status?: OrganizationStatus;
}

/**
 * A persistence snapshot of the {@link Organization} aggregate
 * (PERSISTENCE.md §4 aggregate ownership). Plain data produced by
 * {@link Organization.snapshot} and consumed by {@link Organization.hydrate}
 * — no behavior.
 */
export interface OrganizationSnapshot {
  /** The organization id (also the tenant id). */
  id: OrganizationId;
  /** The globally unique slug. */
  slug: OrganizationSlug;
  /** The provisioning type. */
  type: OrganizationType;
  /** The lifecycle status value. */
  status: string;
  /** The owned profile data. */
  profile: {
    /** The organization name. */
    name: string;
    /** Optional description. */
    description?: string;
    /** Optional website. */
    website?: string;
    /** Optional contact email. */
    contactEmail?: string;
    /** ISO-8601 UTC profile update time. */
    updatedAt: string;
  };
  /** The owned settings data. */
  settings: {
    /** Default locale. */
    defaultLocale: string;
    /** Default timezone. */
    defaultTimezone: string;
    /** Data residency. */
    dataResidency: string;
    /** Retention in days. */
    retentionDays: number;
    /** Whether AI is enabled. */
    aiEnabled: boolean;
    /** ISO-8601 UTC settings update time. */
    updatedAt: string;
  };
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link Organization} aggregate root. Use {@link Organization.create} to
 * construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class Organization {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: OrganizationId;
  readonly #slug: OrganizationSlug;
  readonly #type: OrganizationType;
  #status: OrganizationStatus;
  #profile: OrganizationProfile;
  #settings: OrganizationSettings;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateOrganizationInput, createdAt: string) {
    this.#id = OrganizationIdFactory.create();
    this.#slug = input.slug;
    this.#type = input.type;
    this.#status = input.status ?? OrganizationStatus.provisioning();
    this.#profile = OrganizationProfile.create(
      this.#id,
      {
        name: input.name,
        description: input.description,
        website: input.website,
        contactEmail: input.contactEmail,
      },
      createdAt,
    );
    this.#settings = OrganizationSettings.create(this.#id, createdAt);
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link Organization} in `provisioning` status and records
   * an {@link organizationCreatedEvent}.
   *
   * @param input   - creation data.
   * @param context - event context (actor, correlation id).
   * @param now     - ISO-8601 UTC creation time (defaults to now).
   */
  static create(
    input: CreateOrganizationInput,
    context: OrganizationEventContext,
    now = nowIso(),
  ): Organization {
    const organization = new Organization(input, now);
    organization.#events.push(
      organizationCreatedEvent(context, organization.#id, {
        organizationId: organization.#id,
        slug: organization.#slug.value,
        name: organization.#profile.name.value,
        type: organization.#type.value,
        status: organization.#status.value,
      }),
    );
    return organization;
  }

  /** The organization id (also the tenant id). */
  get id(): OrganizationId {
    return this.#id;
  }

  /** The tenant id — the organization id under its tenant contract. */
  get tenantId(): TenantId {
    return this.#id as unknown as TenantId;
  }

  /** The globally unique slug. */
  get slug(): OrganizationSlug {
    return this.#slug;
  }

  /** The provisioning type. */
  get type(): OrganizationType {
    return this.#type;
  }

  /** The lifecycle status. */
  get status(): OrganizationStatus {
    return this.#status;
  }

  /** The descriptive profile (owned child entity). */
  get profile(): OrganizationProfile {
    return this.#profile;
  }

  /** The operational settings (owned child entity). */
  get settings(): OrganizationSettings {
    return this.#settings;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency (EntityMeta). */
  get version(): number {
    return this.#version;
  }

  /** Whether the organization is fully operational. */
  isActive(): boolean {
    return this.#status.isActive();
  }

  /**
   * Activates the organization (`provisioning` → `active`) and records an
   * {@link organizationActivatedEvent}.
   *
   * @param context - event context.
   * @param now     - ISO-8601 UTC mutation time (defaults to now).
   * @throws {OrganizationStateTransitionError} when the transition is not allowed.
   */
  activate(context: OrganizationEventContext, now = nowIso()): void {
    this.#transitionTo(OrganizationStatus.active(), 'activate', now);
    this.#events.push(organizationActivatedEvent(context, this.#id));
  }

  /**
   * Suspends the organization (`active` → `suspended`) and records an
   * {@link organizationSuspendedEvent}. Suspension freezes new actions and
   * memberships while retaining data and audit.
   *
   * @param reason  - why the organization is being suspended.
   * @param context - event context.
   * @param now     - ISO-8601 UTC mutation time (defaults to now).
   * @throws {OrganizationStateTransitionError} when the transition is not allowed.
   */
  suspend(reason: string, context: OrganizationEventContext, now = nowIso()): void {
    this.#transitionTo(OrganizationStatus.suspended(), 'suspend', now);
    this.#events.push(organizationSuspendedEvent(context, this.#id, reason));
  }

  /**
   * Archives the organization (`active`/`suspended` → `archived`) and records
   * an {@link organizationArchivedEvent}. Archived is terminal in v1: the
   * organization retains data and audit but rejects mutations
   * (docs/LIFECYCLE.md; PSD.md CO-3).
   *
   * @param reason  - why the organization is being archived.
   * @param context - event context.
   * @param now     - ISO-8601 UTC mutation time (defaults to now).
   * @throws {OrganizationStateTransitionError} when the transition is not allowed.
   */
  archive(reason: string, context: OrganizationEventContext, now = nowIso()): void {
    this.#transitionTo(OrganizationStatus.archived(), 'archive', now);
    this.#events.push(organizationArchivedEvent(context, this.#id, reason));
  }

  /**
   * Applies a partial settings update and records an
   * {@link organizationSettingsUpdatedEvent} with the changed keys. An empty
   * update (nothing changed) is a no-op: no version bump, no event.
   *
   * @param update  - the settings to change.
   * @param context - event context.
   * @param now     - ISO-8601 UTC mutation time (defaults to now).
   * @throws {InvalidOrganizationValueError} when a value is invalid.
   */
  updateSettings(
    update: OrganizationSettingsUpdate,
    context: OrganizationEventContext,
    now = nowIso(),
  ): void {
    const changed = this.#settings.update(update, now);
    if (changed.length > 0) {
      this.#bump(now);
      this.#events.push(organizationSettingsUpdatedEvent(context, this.#id, changed));
    }
  }

  /**
   * Applies a partial profile update. An empty update is a no-op: no version
   * bump.
   *
   * @param update - the profile fields to change.
   * @param now    - ISO-8601 UTC mutation time (defaults to now).
   * @throws {InvalidOrganizationValueError} when a value is invalid.
   */
  updateProfile(update: OrganizationProfileUpdate, now = nowIso()): void {
    const changed = this.#profile.update(update, now);
    if (changed.length > 0) {
      this.#bump(now);
    }
  }

  /**
   * Produces a persistence snapshot of the organization (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(organization: Organization): OrganizationSnapshot {
    return {
      id: organization.id,
      slug: organization.slug,
      type: organization.type,
      status: organization.status.value,
      profile: {
        name: organization.profile.name.value,
        description: organization.profile.description,
        website: organization.profile.website,
        contactEmail: organization.profile.contactEmail,
        updatedAt: organization.profile.updatedAt,
      },
      settings: {
        defaultLocale: organization.settings.defaultLocale,
        defaultTimezone: organization.settings.defaultTimezone,
        dataResidency: organization.settings.dataResidency,
        retentionDays: organization.settings.retentionDays,
        aiEnabled: organization.settings.aiEnabled,
        updatedAt: organization.settings.updatedAt,
      },
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      version: organization.version,
    };
  }

  /**
   * Reconstructs an {@link Organization} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory). Reuses the id from
   * the snapshot; validates values through the value objects so corrupt rows
   * fail at load.
   */
  static hydrate(snapshot: OrganizationSnapshot): Organization {
    const organization = new Organization(
      {
        slug: snapshot.slug,
        name: snapshot.profile.name,
        type: snapshot.type,
        description: snapshot.profile.description,
        website: snapshot.profile.website,
        contactEmail: snapshot.profile.contactEmail,
        status: OrganizationStatus.from(snapshot.status),
      },
      snapshot.createdAt,
    );
    organization.#id = snapshot.id;
    organization.#profile = OrganizationProfile.create(
      organization.#id,
      {
        name: snapshot.profile.name,
        description: snapshot.profile.description,
        website: snapshot.profile.website,
        contactEmail: snapshot.profile.contactEmail,
      },
      snapshot.profile.updatedAt,
    );
    const settings = OrganizationSettings.create(organization.#id, snapshot.settings.updatedAt);
    settings.update(
      {
        defaultLocale: snapshot.settings.defaultLocale,
        defaultTimezone: snapshot.settings.defaultTimezone,
        dataResidency: snapshot.settings.dataResidency,
        retentionDays: snapshot.settings.retentionDays,
        aiEnabled: snapshot.settings.aiEnabled,
      },
      snapshot.settings.updatedAt,
    );
    organization.#settings = settings;
    organization.#updatedAt = snapshot.updatedAt;
    organization.#version = snapshot.version;
    return organization;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Enforces the organization lifecycle transition table. */
  #transitionTo(target: OrganizationStatus, action: string, now: string): void {
    const allowed = ORG_TRANSITIONS[this.#status.value];
    if (!allowed.includes(target.value)) {
      throw new OrganizationStateTransitionError(
        `Cannot ${action} an organization in status ${this.#status.value}`,
        { organizationId: this.#id, from: this.#status.value, to: target.value },
      );
    }
    this.#status = target;
    this.#bump(now);
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now = nowIso()): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
