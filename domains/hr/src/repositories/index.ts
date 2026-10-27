/**
 * @nexora/domain-hr — repository interfaces.
 *
 * The persistence ports of the HR bounded context (BACKEND.md §2 dependency
 * direction; PERSISTENCE.md §4 aggregate ownership). The domain depends on
 * these interfaces; the infrastructure layer (PostgreSQL/Drizzle) implements
 * them. No ORM, no SQL, no persistence here.
 */

import type { TenantId } from '@nexora/contracts/common';

import type { Employee } from '../entities/employee.js';
import type { Candidate } from '../entities/candidate.js';
import type { HiringRequisition } from '../entities/hiring-requisition.js';
import type { JobOpening } from '../entities/job-opening.js';
import type { OfficeRequest } from '../entities/office-request.js';
import type { Onboarding } from '../entities/onboarding.js';
import type { EmployeeId } from '../value-objects/employee-id.js';
import type {
  CandidateId,
  JobOpeningId,
  OfficeRequestId,
  OnboardingId,
} from '../value-objects/recruiting-ids.js';
import type { RequisitionId } from '../value-objects/requisition-id.js';

/**
 * The persistence port of the {@link Employee} aggregate.
 */
export interface EmployeeRepository {
  /** Loads an employee by id, or `undefined` when it does not exist. */
  findById(id: EmployeeId): Promise<Employee | undefined>;

  /**
   * Finds employees whose name matches the given term within an
   * organization (tenant-scoped, case-insensitive substring match). Used by
   * the deterministic name resolution used by the AI tooling (no guessing).
   */
  findByName(organizationId: TenantId, name: string): Promise<readonly Employee[]>;

  /** Lists the employees of an organization (tenant-scoped read). */
  listByOrganization(organizationId: TenantId): Promise<readonly Employee[]>;

  /** Persists the aggregate (insert or update by id). */
  save(employee: Employee): Promise<void>;
}

/**
 * The persistence port of the {@link HiringRequisition} aggregate.
 */
export interface HiringRequisitionRepository {
  /** Loads a requisition by id, or `undefined` when it does not exist. */
  findById(id: RequisitionId): Promise<HiringRequisition | undefined>;

  /** Lists the requisitions of an organization, newest first (tenant-scoped read). */
  listByOrganization(organizationId: TenantId): Promise<readonly HiringRequisition[]>;

  /** Inserts a new requisition. */
  insert(requisition: HiringRequisition): Promise<void>;

  /**
   * Persists a changed requisition ONLY IF the stored row is still at
   * `expectedVersion` (optimistic concurrency): two people deciding at once,
   * or a decision racing an edit, cannot both win.
   *
   * @returns `true` when the row was updated; `false` when it had changed.
   */
  update(requisition: HiringRequisition, expectedVersion: number): Promise<boolean>;
}

/** The persistence port of the {@link JobOpening} aggregate. */
export interface JobOpeningRepository {
  findById(id: JobOpeningId): Promise<JobOpening | undefined>;
  /** The opening created for a hiring request (at most one), tenant-scoped. */
  findByRequisition(
    organizationId: TenantId,
    requisitionId: string,
  ): Promise<JobOpening | undefined>;
  /** Lists the organization's openings, newest first. */
  listByOrganization(organizationId: TenantId): Promise<readonly JobOpening[]>;
  /**
   * Inserts a new opening.
   *
   * @returns `false` when the hiring request already has an opening (one per request).
   */
  insert(opening: JobOpening): Promise<boolean>;
  /** Persists a change only while the row is still at `expectedVersion`. */
  update(opening: JobOpening, expectedVersion: number): Promise<boolean>;
}

/** The persistence port of the {@link Candidate} aggregate. */
export interface CandidateRepository {
  findById(id: CandidateId): Promise<Candidate | undefined>;
  /** Lists the candidates of one opening (tenant-scoped), oldest first. */
  listByOpening(organizationId: TenantId, openingId: string): Promise<readonly Candidate[]>;
  insert(candidate: Candidate): Promise<void>;
  /** Persists a change only while the row is still at `expectedVersion`. */
  update(candidate: Candidate, expectedVersion: number): Promise<boolean>;
}

/** The persistence port of the {@link Onboarding} aggregate. */
export interface OnboardingRepository {
  findById(id: OnboardingId): Promise<Onboarding | undefined>;
  /** The onboarding of an employee (at most one), tenant-scoped. */
  findByEmployee(organizationId: TenantId, employeeId: string): Promise<Onboarding | undefined>;
  /** Lists the organization's onboardings, newest first. */
  listByOrganization(organizationId: TenantId): Promise<readonly Onboarding[]>;
  /**
   * Inserts a new onboarding.
   *
   * @returns `false` when the employee already has one (one per employee).
   */
  insert(onboarding: Onboarding): Promise<boolean>;
  /** Persists a change only while the row is still at `expectedVersion`. */
  update(onboarding: Onboarding, expectedVersion: number): Promise<boolean>;
}

/** The persistence port of the {@link OfficeRequest} aggregate. */
export interface OfficeRequestRepository {
  findById(id: OfficeRequestId): Promise<OfficeRequest | undefined>;
  /** Lists the organization's requests, newest first (tenant-scoped read). */
  listByOrganization(organizationId: TenantId): Promise<readonly OfficeRequest[]>;
  insert(request: OfficeRequest): Promise<void>;
  /** Persists a change only while the row is still at `expectedVersion`. */
  update(request: OfficeRequest, expectedVersion: number): Promise<boolean>;
}
