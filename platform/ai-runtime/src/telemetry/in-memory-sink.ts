/**
 * @nexora/ai-runtime — telemetry sinks.
 *
 * Reference {@link TelemetrySink} implementations: an in-memory collector
 * for tests/local development and a no-op sink for production wiring.
 */

import type { TelemetryRecord } from './telemetry.js';

/** A no-op telemetry sink (production wiring replaces it). */
export const noopTelemetrySink = {
  record(): void {},
};

/** An in-memory telemetry sink that collects records for inspection. */
export class InMemoryTelemetrySink {
  readonly #records: TelemetryRecord[] = [];

  /** Records a telemetry record. */
  record(record: TelemetryRecord): void {
    this.#records.push(record);
  }

  /** All records collected so far. */
  all(): readonly TelemetryRecord[] {
    return [...this.#records];
  }

  /** The number of collected records. */
  get size(): number {
    return this.#records.length;
  }

  /** The collected execution traces. */
  traces() {
    return this.#records
      .filter(
        (record): record is Extract<TelemetryRecord, { kind: 'trace' }> => record.kind === 'trace',
      )
      .map((record) => record.trace);
  }

  /** The collected decisions. */
  decisions() {
    return this.#records
      .filter(
        (record): record is Extract<TelemetryRecord, { kind: 'decision' }> =>
          record.kind === 'decision',
      )
      .map((record) => record.decision);
  }

  /** The collected prompt records. */
  prompts() {
    return this.#records
      .filter(
        (record): record is Extract<TelemetryRecord, { kind: 'prompt' }> =>
          record.kind === 'prompt',
      )
      .map((record) => record.prompt);
  }
}
