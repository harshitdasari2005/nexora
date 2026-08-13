/**
 * @nexora/module-measurements — MeasurementApplicationService.
 *
 * The application surface of the measurements module: one tenant-scoped read
 * that returns the PRD §20.4 pilot dashboard snapshot. The service contains
 * no business rules — every metric is computed by the repository port in
 * tenant-scoped SQL aggregations. The tenant is always the trusted scope
 * passed by the authenticated API layer, never a caller-supplied value.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { TenantMeasurementsSnapshot } from '../domain/measurement-snapshot.js';
import type { MeasurementRepository } from '../repositories/measurement-repository.js';

/** Query: load the measurement snapshot of a tenant. */
export interface GetTenantMeasurementsQuery {
  /** Tenant scope (trusted — resolved from authenticated membership). */
  tenantId: TenantId;
}

/** The measurements application service. */
export class MeasurementApplicationService {
  readonly #measurements: MeasurementRepository;

  constructor(measurements: MeasurementRepository) {
    this.#measurements = measurements;
  }

  /** Loads the tenant measurement snapshot (tenant-scoped read). */
  getTenantMeasurements(query: GetTenantMeasurementsQuery): Promise<TenantMeasurementsSnapshot> {
    return this.#measurements.loadTenantMeasurements(query.tenantId);
  }
}

/** Handles {@link GetTenantMeasurementsQuery}. */
export class GetTenantMeasurementsHandler {
  readonly #service: MeasurementApplicationService;
  constructor(service: MeasurementApplicationService) {
    this.#service = service;
  }
  handle(query: GetTenantMeasurementsQuery): Promise<TenantMeasurementsSnapshot> {
    return this.#service.getTenantMeasurements(query);
  }
}
