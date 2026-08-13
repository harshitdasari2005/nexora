/**
 * @nexora/module-measurements — measurement repository port.
 *
 * The persistence seam of the measurements module. The implementation
 * (Drizzle over PostgreSQL in `@nexora/persistence`) computes the PRD §20.4
 * metrics as SQL aggregations, tenant-scoped FIRST — a caller can never
 * request another tenant's measurements. The port is intentionally small:
 * one read that returns the whole snapshot.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { TenantMeasurementsSnapshot } from '../domain/measurement-snapshot.js';

/** The measurement repository port. */
export interface MeasurementRepository {
  /**
   * Loads the tenant measurement snapshot. Implementations MUST scope every
   * aggregation to `tenantId` in SQL — no other tenant's data may contribute
   * to the result.
   */
  loadTenantMeasurements(tenantId: TenantId): Promise<TenantMeasurementsSnapshot>;
}
