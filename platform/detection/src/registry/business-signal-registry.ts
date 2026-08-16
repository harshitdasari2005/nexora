/**
 * @nexora/module-detection — BusinessSignalRegistry (S27).
 *
 * The registry of {@link BusinessSignalDefinition}s. Definitions are
 * code/config registered at startup — validated deterministically
 * (duplicates, type, evaluator presence, capability integrity) and thrown on
 * invalid configuration, never discovered mid-request. Resolution is a
 * plain in-memory read (no per-request scans, S22 budgets preserved).
 *
 * A signal definition declares WHAT condition to watch for, the
 * deterministic evaluator that decides whether the condition is present
 * (thresholds are configuration — an LLM never decides them), the affected
 * system/entity mapping, and the remediation capabilities that could act on
 * it (the S26 agent surface consumes these for governed recommendations).
 *
 * The registry is the extension seam: a new signal (e.g.
 * `integration_failure`) registers here without any change to the generic
 * detection engine, the investigation engine, or the AI Runtime.
 */

import type { BusinessSignalType } from '@nexora/contracts/detection';
import type { DetectionSnapshot } from '../application/detection-snapshot.js';
import { DuplicateSignalError, InvalidSignalError } from '../errors.js';

/** The deterministic severity derivation of a detected condition. */
export type SignalSeverity = 'low' | 'medium' | 'high';

/** One deterministic detection produced by a signal evaluator. */
export interface SignalDetection {
  /** The affected entity reference (type + id + title), when scoped to one. */
  affectedEntity?: { type: string; id: string; title: string };
  /** The deterministic severity. */
  severity: SignalSeverity;
  /** A human-readable problem title. */
  title: string;
  /** A grounded description (what happened + why it matters). */
  description: string;
  /** The deterministic facts observed (real persisted data only). */
  facts: readonly string[];
  /** A stable correlation suffix within the signal (e.g. the entity id). */
  correlationSuffix: string;
}

/**
 * A registered business signal: the definition + its deterministic
 * evaluator. The evaluator reads the trusted detection snapshot (already
 * tenant/workspace-scoped by the API layer) and returns the detected
 * conditions — thresholds are pure code/config, never LLM-decided.
 */
export interface BusinessSignalDefinition {
  /** Stable signal id, e.g. `workflow_failure`. */
  id: string;
  /** The signal type (deterministic vocabulary). */
  signalType: BusinessSignalType;
  /** Human-readable name, e.g. `Workflow failure`. */
  name: string;
  /** A description of the condition this signal watches for. */
  description: string;
  /** The remediation capabilities that could act on a detected problem. */
  remediationCapabilities: readonly string[];
  /**
   * The deterministic evaluator: given the trusted snapshot, returns the
   * detected conditions (empty when the thresholds are not crossed).
   */
  evaluate(snapshot: DetectionSnapshot): readonly SignalDetection[];
}

/** The registry of business-signal definitions. */
export class BusinessSignalRegistry {
  readonly #definitions = new Map<string, BusinessSignalDefinition>();

  /**
   * Registers a signal definition, validating it first.
   *
   * @throws {InvalidSignalError} when the definition is invalid.
   * @throws {DuplicateSignalError} when the id is already registered.
   */
  register(def: BusinessSignalDefinition): void {
    validateSignalDefinition(def);
    if (this.#definitions.has(def.id)) {
      throw new DuplicateSignalError(def.id);
    }
    this.#definitions.set(def.id, def);
  }

  /** Resolves a signal by id, or `undefined`. */
  get(id: string): BusinessSignalDefinition | undefined {
    return this.#definitions.get(id);
  }

  /** Whether a signal with the id is registered. */
  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  /** All registered signals, in registration order. */
  list(): readonly BusinessSignalDefinition[] {
    return [...this.#definitions.values()];
  }
}

/** Validates a signal definition deterministically at registration. */
function validateSignalDefinition(def: BusinessSignalDefinition): void {
  if (def.id.trim().length === 0) {
    throw new InvalidSignalError('Signal id must not be empty');
  }
  if (def.name.trim().length === 0) {
    throw new InvalidSignalError(`Signal ${def.id} name must not be empty`);
  }
  if (def.description.trim().length === 0) {
    throw new InvalidSignalError(`Signal ${def.id} description must not be empty`);
  }
  if (typeof def.evaluate !== 'function') {
    throw new InvalidSignalError(`Signal ${def.id} must declare an evaluator`);
  }
  for (const capabilityId of def.remediationCapabilities) {
    if (capabilityId.trim().length === 0) {
      throw new InvalidSignalError(`Signal ${def.id} has an empty remediation capability`);
    }
  }
}
