/**
 * @nexora/contracts — versioning contracts.
 *
 * Contract evolution (SAD.md §7.10, §11.5 event versioning): every contract
 * carries a version, a compatibility level with its predecessors, and
 * deprecation/migration metadata so consumers can plan upgrades.
 */

import type { EventVersion } from '../events/index.js';
import type { SemVer, Timestamp } from '../common/index.js';

/**
 * The compatibility of a contract version with its predecessor
 * (API_CONTRACTS.md §12 versioning strategy).
 */
export const COMPATIBILITY_LEVELS = ['breaking', 'additive', 'patch'] as const;

/** Single compatibility level literal. */
export type CompatibilityLevel = (typeof COMPATIBILITY_LEVELS)[number];

/**
 * A versioned contract identity: the contract name plus its semantic
 * version.
 */
export interface ContractVersion {
  /** Contract name, e.g. `events.employee.created`. */
  name: string;
  /** Semantic version of the contract. */
  version: SemVer;
}

/**
 * A versioned event type: the stable event identity as understood by a
 * producer or consumer, plus the time the version was published (SAD.md
 * §11.5). Consumes the canonical {@link EventVersion} contract so versioning
 * logic and the event envelope share one definition.
 */
export interface VersionedEvent extends EventVersion {
  /** ISO-8601 UTC time the event version was published. */
  publishedAt: Timestamp;
}

/**
 * A compatibility rule between two contract versions: how a consumer on the
 * `from` version can treat a producer on the `to` version.
 */
export interface CompatibilityRule {
  /** Contract name. */
  contract: string;
  /** The version a consumer currently understands. */
  from: SemVer;
  /** The version a producer now emits. */
  to: SemVer;
  /** Whether the change is breaking, additive, or patch. */
  level: CompatibilityLevel;
  /** Human-readable description of the change. */
  description: string;
}

/**
 * Deprecation metadata: a contract (or version) is deprecated before
 * removal, with a sunset date and a replacement.
 */
export interface DeprecationMetadata {
  /** Whether the contract is deprecated. */
  deprecated: boolean;
  /** ISO-8601 UTC time after which the deprecated version stops serving. */
  sunsetAt?: Timestamp;
  /** Replacement contract name, when one exists. */
  replacement?: string;
  /** Human-readable deprecation notice. */
  notice?: string;
}

/**
 * Migration metadata: how to migrate from an old contract version to a new
 * one.
 */
export interface MigrationMetadata {
  /** The contract name. */
  contract: string;
  /** Version migrating from. */
  from: SemVer;
  /** Version migrating to. */
  to: SemVer;
  /** Field mapping (old field → new field or transformation key). */
  fieldMapping: Readonly<Record<string, string>>;
  /** Whether migration is automatic or requires manual action. */
  automatic: boolean;
  /** Human-readable migration guide reference. */
  guide?: string;
}
