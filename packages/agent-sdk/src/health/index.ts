/**
 * @nexora/agent-sdk — health.
 *
 * Agent health monitoring (AIR.md §16): status, checks, and reports. The
 * registry consumes these to expose `healthy`/`degraded`/`unavailable` in
 * the canonical registry entry (AIR.md §4 agent health).
 */

/** Agent health status (AIR.md §4 `health` field). */
export type HealthStatus = 'healthy' | 'degraded' | 'unavailable';

/**
 * A health check: an async probe returning `true` when the checked
 * dependency is healthy.
 */
export interface HealthCheck {
  /** Check id, e.g. `memory`, `knowledge`, `tools`. */
  id: string;
  /** Runs the probe. */
  check(): Promise<boolean> | boolean;
}

/** The result of a single health check. */
export interface HealthCheckResult {
  /** Check id. */
  id: string;
  /** Whether the check passed. */
  healthy: boolean;
  /** Optional detail when unhealthy. */
  detail?: string;
}

/** A snapshot of the agent's health at a point in time. */
export interface HealthSnapshot {
  /** Overall health status. */
  status: HealthStatus;
  /** Per-check results. */
  checks: readonly HealthCheckResult[];
  /** ISO-8601 UTC time the snapshot was taken. */
  takenAt: string;
}

/**
 * A full health report: snapshot plus lifecycle context.
 */
export interface HealthReport extends HealthSnapshot {
  /** Agent id the report belongs to. */
  agentId: string;
  /** Lifecycle state at report time. */
  lifecycleState: string;
}

/**
 * Runs health checks and derives the overall status: all healthy →
 * `healthy`; any unhealthy → `degraded`; all unhealthy → `unavailable`.
 * Sync checks are awaited through the same path; throws are treated as
 * unhealthy with the error message as detail.
 */
export async function runHealthChecks(
  checks: readonly HealthCheck[],
  takenAt: string,
): Promise<HealthSnapshot> {
  const results: HealthCheckResult[] = await Promise.all(
    checks.map(async (check) => {
      try {
        const healthy = await check.check();
        return { id: check.id, healthy };
      } catch (error) {
        return {
          id: check.id,
          healthy: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const failed = results.filter((result) => !result.healthy);
  const status: HealthStatus =
    failed.length === 0 ? 'healthy' : failed.length === results.length ? 'unavailable' : 'degraded';
  return { status, checks: results, takenAt };
}
