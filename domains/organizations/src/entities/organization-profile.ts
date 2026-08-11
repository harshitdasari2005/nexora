/**
 * @nexora/domain-organizations — OrganizationProfile child entity.
 *
 * The descriptive attributes of an {@link Organization}, owned by the
 * Organization aggregate (docs/AGGREGATES.md). Mutable only through
 * {@link OrganizationProfile.update}; all values are validated.
 */

import { isEmail, maxLength, required } from '@nexora/shared/validation';

import { InvalidOrganizationValueError } from '../errors/index.js';
import type { OrganizationId } from '../value-objects/organization-id.js';
import { OrganizationName } from '../value-objects/organization-name.js';

/** Maximum description length. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** Maximum website length. */
export const MAX_WEBSITE_LENGTH = 200;

/** Maximum contact email length. */
export const MAX_CONTACT_EMAIL_LENGTH = 254;

/** Update for an {@link OrganizationProfile}. Every field is optional. */
export interface OrganizationProfileUpdate {
  /** The display name. */
  name?: string;
  /** A short description of the organization. */
  description?: string;
  /** The organization website. */
  website?: string;
  /** A public contact email. */
  contactEmail?: string;
}

/** The descriptive profile of an organization. Immutable except via update. */
export class OrganizationProfile {
  readonly #organizationId: OrganizationId;
  #name: OrganizationName;
  #description?: string;
  #website?: string;
  #contactEmail?: string;
  #updatedAt: string;

  private constructor(
    organizationId: OrganizationId,
    name: OrganizationName,
    updatedAt: string,
    description?: string,
    website?: string,
    contactEmail?: string,
  ) {
    this.#organizationId = organizationId;
    this.#name = name;
    this.#description = description;
    this.#website = website;
    this.#contactEmail = contactEmail;
    this.#updatedAt = updatedAt;
  }

  /**
   * Creates the initial profile of an organization.
   *
   * @param organizationId - the owning organization.
   * @param input          - profile values.
   * @param now            - ISO-8601 UTC creation time.
   * @throws {InvalidOrganizationValueError} when a value is invalid.
   */
  static create(
    organizationId: OrganizationId,
    input: {
      /** The organization name. */
      name: string;
      /** Optional description. */
      description?: string;
      /** Optional website. */
      website?: string;
      /** Optional contact email. */
      contactEmail?: string;
    },
    now: string,
  ): OrganizationProfile {
    const profile = new OrganizationProfile(
      organizationId,
      OrganizationName.create(input.name),
      now,
      input.description?.trim(),
      input.website?.trim(),
      input.contactEmail?.trim(),
    );
    profile.#validateOptional(input);
    return profile;
  }

  /** The owning organization. */
  get organizationId(): OrganizationId {
    return this.#organizationId;
  }

  /** The organization name. */
  get name(): OrganizationName {
    return this.#name;
  }

  /** The description, when set. */
  get description(): string | undefined {
    return this.#description;
  }

  /** The website, when set. */
  get website(): string | undefined {
    return this.#website;
  }

  /** The contact email, when set. */
  get contactEmail(): string | undefined {
    return this.#contactEmail;
  }

  /** ISO-8601 UTC time of the last profile change. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /**
   * Applies a partial update, validating every provided value *before*
   * mutating: a rejected update leaves the profile unchanged (no partial
   * writes on failure).
   *
   * @param update - the fields to change.
   * @param now    - ISO-8601 UTC mutation time.
   * @returns the changed top-level keys.
   * @throws {InvalidOrganizationValueError} when a value is invalid.
   */
  update(update: OrganizationProfileUpdate, now: string): readonly string[] {
    this.#validateOptional(update);
    const changed: string[] = [];
    if (update.name !== undefined) {
      this.#name = OrganizationName.create(update.name);
      changed.push('name');
    }
    if (update.description !== undefined) {
      this.#description = update.description.trim();
      changed.push('description');
    }
    if (update.website !== undefined) {
      this.#website = update.website.trim();
      changed.push('website');
    }
    if (update.contactEmail !== undefined) {
      this.#contactEmail = update.contactEmail.trim();
      changed.push('contactEmail');
    }
    if (changed.length > 0) {
      this.#updatedAt = now;
    }
    return changed;
  }

  /** Validates the optional free-text fields. */
  #validateOptional(input: {
    description?: string;
    website?: string;
    contactEmail?: string;
  }): void {
    const issues: { path: string; message: string }[] = [];
    if (input.description !== undefined) {
      const issue = maxLength('description', input.description.trim(), MAX_DESCRIPTION_LENGTH);
      if (issue !== null) {
        issues.push(issue);
      }
    }
    if (input.website !== undefined) {
      const requiredIssue = required('website', input.website.trim());
      if (requiredIssue !== null) {
        issues.push(requiredIssue);
      } else {
        const issue = maxLength('website', input.website.trim(), MAX_WEBSITE_LENGTH);
        if (issue !== null) {
          issues.push(issue);
        }
      }
    }
    if (input.contactEmail !== undefined) {
      const email = input.contactEmail.trim();
      const requiredIssue = required('contactEmail', email);
      if (requiredIssue !== null) {
        issues.push(requiredIssue);
      } else {
        const maxIssue = maxLength('contactEmail', email, MAX_CONTACT_EMAIL_LENGTH);
        if (maxIssue !== null) {
          issues.push(maxIssue);
        } else {
          const emailIssue = isEmail('contactEmail', email);
          if (emailIssue !== null) {
            issues.push(emailIssue);
          }
        }
      }
    }
    if (issues.length > 0) {
      throw new InvalidOrganizationValueError('Invalid organization profile', issues);
    }
  }
}
