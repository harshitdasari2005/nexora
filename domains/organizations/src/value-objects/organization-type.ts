/**
 * @nexora/domain-organizations — OrganizationType value object.
 *
 * The provisioning kind of an {@link Organization} (company scale/template),
 * NOT an industry tag: the platform is industry-neutral by design
 * (PSD.md CO-4 — industry fit comes solely from the Apps a Company enables).
 * The type is a hint used to select workspace templates and App bundles at
 * provisioning time.
 */

import { InvalidOrganizationValueError } from '../errors/index.js';

/** Organization provisioning types. */
export const ORGANIZATION_TYPES = [
  'enterprise',
  'smb',
  'startup',
  'non_profit',
  'government',
  'other',
] as const;

/** Single organization type literal. */
export type OrganizationTypeValue = (typeof ORGANIZATION_TYPES)[number];

/** The provisioning type of an organization. Immutable. */
export class OrganizationType {
  readonly #value: OrganizationTypeValue;

  private constructor(value: OrganizationTypeValue) {
    this.#value = value;
  }

  /** A large organization with consolidated administration. */
  static enterprise(): OrganizationType {
    return new OrganizationType('enterprise');
  }

  /** A small or medium business. */
  static smb(): OrganizationType {
    return new OrganizationType('smb');
  }

  /** A startup. */
  static startup(): OrganizationType {
    return new OrganizationType('startup');
  }

  /** A non-profit organization. */
  static nonProfit(): OrganizationType {
    return new OrganizationType('non_profit');
  }

  /** A government body. */
  static government(): OrganizationType {
    return new OrganizationType('government');
  }

  /** Any other kind. */
  static other(): OrganizationType {
    return new OrganizationType('other');
  }

  /**
   * Creates an {@link OrganizationType} from a raw string.
   *
   * @param value - one of {@link ORGANIZATION_TYPES}.
   * @throws {InvalidOrganizationValueError} when the value is unknown.
   */
  static from(value: string): OrganizationType {
    const member = ORGANIZATION_TYPES.find((type) => type === value);
    if (member === undefined) {
      throw new InvalidOrganizationValueError('Invalid organization type', [
        { path: 'type', message: `Must be one of: ${ORGANIZATION_TYPES.join(', ')}` },
      ]);
    }
    return new OrganizationType(member);
  }

  /** The type value. */
  get value(): OrganizationTypeValue {
    return this.#value;
  }

  /** Structural equality against another {@link OrganizationType}. */
  equals(other: OrganizationType): boolean {
    return this.#value === other.#value;
  }

  /** Returns the type value. */
  toString(): string {
    return this.#value;
  }
}
