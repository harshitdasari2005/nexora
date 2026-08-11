/**
 * @nexora/domain-organizations — OrganizationSettings child entity.
 *
 * The operational configuration of an {@link Organization} (PSD.md CO-B3:
 * locale, residency, retention, AI configuration), owned by the Organization
 * aggregate (docs/AGGREGATES.md). Mutable only through
 * {@link OrganizationSettings.update}; values are validated and the mutation
 * emits the `organization.settings_updated` event via the aggregate.
 */

import { isIntInRange } from '@nexora/shared/validation';

import { InvalidOrganizationValueError } from '../errors/index.js';
import type { OrganizationId } from '../value-objects/organization-id.js';

/** Locale pattern: `en` or `en-US`. */
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

/** Data residency values: `auto` (default) or a two-letter region code. */
const RESIDENCY_PATTERN = /^(?:auto|[a-z]{2})$/;

/** Retention bounds in days (30 days – 10 years). */
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3_650;

/** Default settings applied at organization creation. */
export const DEFAULT_ORGANIZATION_SETTINGS = {
  defaultLocale: 'en',
  defaultTimezone: 'UTC',
  dataResidency: 'auto',
  retentionDays: 365,
  aiEnabled: true,
} as const;

/** Update for {@link OrganizationSettings}. Every field is optional. */
export interface OrganizationSettingsUpdate {
  /** Default locale, e.g. `en` or `en-US`. */
  defaultLocale?: string;
  /** Default IANA timezone, e.g. `UTC` or `Europe/Berlin`. */
  defaultTimezone?: string;
  /** Data residency: `auto` or a region code (CO-B3). */
  dataResidency?: string;
  /** Audit/data retention in days (30–3650). */
  retentionDays?: number;
  /** Whether AI features are enabled (CO-B3 AI configuration). */
  aiEnabled?: boolean;
}

/** The operational settings of an organization. Immutable except via update. */
export class OrganizationSettings {
  readonly #organizationId: OrganizationId;
  #defaultLocale: string;
  #defaultTimezone: string;
  #dataResidency: string;
  #retentionDays: number;
  #aiEnabled: boolean;
  #updatedAt: string;

  private constructor(organizationId: OrganizationId, now: string) {
    this.#organizationId = organizationId;
    this.#defaultLocale = DEFAULT_ORGANIZATION_SETTINGS.defaultLocale;
    this.#defaultTimezone = DEFAULT_ORGANIZATION_SETTINGS.defaultTimezone;
    this.#dataResidency = DEFAULT_ORGANIZATION_SETTINGS.dataResidency;
    this.#retentionDays = DEFAULT_ORGANIZATION_SETTINGS.retentionDays;
    this.#aiEnabled = DEFAULT_ORGANIZATION_SETTINGS.aiEnabled;
    this.#updatedAt = now;
  }

  /**
   * Creates the default settings of an organization.
   *
   * @param organizationId - the owning organization.
   * @param now            - ISO-8601 UTC creation time.
   */
  static create(organizationId: OrganizationId, now: string): OrganizationSettings {
    return new OrganizationSettings(organizationId, now);
  }

  /** The owning organization. */
  get organizationId(): OrganizationId {
    return this.#organizationId;
  }

  /** Default locale. */
  get defaultLocale(): string {
    return this.#defaultLocale;
  }

  /** Default timezone. */
  get defaultTimezone(): string {
    return this.#defaultTimezone;
  }

  /** Data residency policy. */
  get dataResidency(): string {
    return this.#dataResidency;
  }

  /** Retention period in days. */
  get retentionDays(): number {
    return this.#retentionDays;
  }

  /** Whether AI features are enabled. */
  get aiEnabled(): boolean {
    return this.#aiEnabled;
  }

  /** ISO-8601 UTC time of the last settings change. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /**
   * Applies a partial update, validating every provided value *before*
   * mutating: a rejected update leaves the settings unchanged (no partial
   * writes on failure).
   *
   * @param update - the fields to change.
   * @param now    - ISO-8601 UTC mutation time.
   * @returns the changed top-level keys.
   * @throws {InvalidOrganizationValueError} when a value is invalid.
   */
  update(update: OrganizationSettingsUpdate, now: string): readonly string[] {
    this.#validate(update);
    const changed: string[] = [];
    if (update.defaultLocale !== undefined) {
      this.#defaultLocale = update.defaultLocale;
      changed.push('defaultLocale');
    }
    if (update.defaultTimezone !== undefined) {
      this.#defaultTimezone = update.defaultTimezone;
      changed.push('defaultTimezone');
    }
    if (update.dataResidency !== undefined) {
      this.#dataResidency = update.dataResidency;
      changed.push('dataResidency');
    }
    if (update.retentionDays !== undefined) {
      this.#retentionDays = update.retentionDays;
      changed.push('retentionDays');
    }
    if (update.aiEnabled !== undefined) {
      this.#aiEnabled = update.aiEnabled;
      changed.push('aiEnabled');
    }
    if (changed.length > 0) {
      this.#updatedAt = now;
    }
    return changed;
  }

  /** Validates the provided settings fields. */
  #validate(update: OrganizationSettingsUpdate): void {
    const issues: { path: string; message: string }[] = [];
    if (update.defaultLocale !== undefined && !LOCALE_PATTERN.test(update.defaultLocale)) {
      issues.push({ path: 'defaultLocale', message: 'Must be a locale like en or en-US' });
    }
    if (
      update.defaultTimezone !== undefined &&
      (update.defaultTimezone.trim().length === 0 || update.defaultTimezone.length > 64)
    ) {
      issues.push({ path: 'defaultTimezone', message: 'Must be an IANA timezone name' });
    }
    if (update.dataResidency !== undefined && !RESIDENCY_PATTERN.test(update.dataResidency)) {
      issues.push({ path: 'dataResidency', message: 'Must be auto or a two-letter region code' });
    }
    if (
      update.retentionDays !== undefined &&
      isIntInRange(
        'retentionDays',
        update.retentionDays,
        MIN_RETENTION_DAYS,
        MAX_RETENTION_DAYS,
      ) !== null
    ) {
      issues.push({
        path: 'retentionDays',
        message: `Must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`,
      });
    }
    if (issues.length > 0) {
      throw new InvalidOrganizationValueError('Invalid organization settings', issues);
    }
  }
}
