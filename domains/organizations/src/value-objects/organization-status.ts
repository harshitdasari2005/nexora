/**
 * @nexora/domain-organizations — OrganizationStatus value object.
 *
 * The lifecycle status of an {@link Organization}, aligned with the tenancy
 * lifecycle (PSD.md CO-3: Provisioning → Active → Suspended → Retired; the
 * task maps the terminal state to `archived`). Transitions are governed by
 * the `OrganizationLifecyclePolicy` (docs/LIFECYCLE.md).
 */

import { InvalidOrganizationValueError } from '../errors/index.js';

/** Organization lifecycle statuses (PSD.md CO-3). */
export const ORGANIZATION_STATUSES = ['provisioning', 'active', 'suspended', 'archived'] as const;

/** Single organization status literal. */
export type OrganizationStatusValue = (typeof ORGANIZATION_STATUSES)[number];

/** The lifecycle status of an organization. Immutable. */
export class OrganizationStatus {
  readonly #value: OrganizationStatusValue;

  private constructor(value: OrganizationStatusValue) {
    this.#value = value;
  }

  /** The organization is being provisioned (default workspace, system Apps). */
  static provisioning(): OrganizationStatus {
    return new OrganizationStatus('provisioning');
  }

  /** The organization is fully operational. */
  static active(): OrganizationStatus {
    return new OrganizationStatus('active');
  }

  /** The organization is temporarily unable to accept actions (freeze). */
  static suspended(): OrganizationStatus {
    return new OrganizationStatus('suspended');
  }

  /** The organization was archived; it retains data and audit but rejects mutations. */
  static archived(): OrganizationStatus {
    return new OrganizationStatus('archived');
  }

  /**
   * Creates an {@link OrganizationStatus} from a raw string.
   *
   * @param value - one of {@link ORGANIZATION_STATUSES}.
   * @throws {InvalidOrganizationValueError} when the value is unknown.
   */
  static from(value: string): OrganizationStatus {
    const member = ORGANIZATION_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidOrganizationValueError('Invalid organization status', [
        { path: 'status', message: `Must be one of: ${ORGANIZATION_STATUSES.join(', ')}` },
      ]);
    }
    return new OrganizationStatus(member);
  }

  /** The status value. */
  get value(): OrganizationStatusValue {
    return this.#value;
  }

  /** Whether the organization is fully operational (status is `active`). */
  isActive(): boolean {
    return this.#value === 'active';
  }

  /** Structural equality against another {@link OrganizationStatus}. */
  equals(other: OrganizationStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
