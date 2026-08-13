/**
 * @nexora/module-measurements — public surface.
 *
 * The measurements module (S23 / PRD §20.4): tenant-scoped pilot dashboard
 * metrics (workflow health, onboarding, audit completeness, tenant overview)
 * computed as SQL aggregations over persisted business data. This barrel is
 * the only import surface — consumers never reach into subfolders.
 */

export {
  GetTenantMeasurementsHandler,
  MeasurementApplicationService,
  type GetTenantMeasurementsQuery,
} from './application/measurement-application-service.js';
export type {
  AuditCompletenessMetric,
  OnboardingUserMetric,
  TenantMeasurementsSnapshot,
  TenantOverview,
  WorkflowHealthMetric,
} from './domain/measurement-snapshot.js';
export type { MeasurementRepository } from './repositories/measurement-repository.js';
