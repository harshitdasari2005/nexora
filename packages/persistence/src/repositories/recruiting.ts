/**
 * @nexora/persistence — recruiting repositories (job openings, candidates).
 *
 * Every update is optimistic (written only while the row is still at the
 * version the aggregate was loaded at). The one-opening-per-request rule is a
 * unique index: a duplicate insert reports `false` instead of throwing.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import {
  Candidate,
  CandidateId,
  JobOpening,
  JobOpeningId,
  Onboarding,
  OnboardingId,
  type OnboardingRepository,
  type OnboardingSnapshot,
  type CandidateRepository,
  type CandidateSnapshot,
  type JobOpeningRepository,
  type JobOpeningSnapshot,
} from '@nexora/domain-hr';

import type { NexoraDatabase } from '../db.js';
import { candidates, jobOpenings, onboardings } from '../schema/index.js';

type OpeningRow = typeof jobOpenings.$inferSelect;
type CandidateRow = typeof candidates.$inferSelect;

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

/** Whether an error (or its cause chain) is a PostgreSQL unique violation. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function openingFromRow(row: OpeningRow): JobOpening {
  const snapshot: JobOpeningSnapshot = {
    id: JobOpeningId.from(row.id),
    organizationId: row.organizationId as TenantId,
    requisitionId: row.requisitionId,
    workspaceId: row.workspaceId as WorkspaceId,
    hiringManagerId: row.hiringManagerId,
    openedBy: row.openedBy,
    title: row.title,
    department: row.department,
    headcount: row.headcount,
    employmentType: row.employmentType,
    salaryMinMinorUnits: row.salaryMinMinorUnits,
    salaryMaxMinorUnits: row.salaryMaxMinorUnits,
    currency: row.currency,
    description: row.description,
    status: row.status as JobOpeningSnapshot['status'],
    offersOut: row.offersOut,
    hiredCount: row.hiredCount,
    ...(row.closedReason === null ? {} : { closedReason: row.closedReason }),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
  return JobOpening.hydrate(snapshot);
}

function openingToRow(opening: JobOpening): OpeningRow {
  const snapshot = JobOpening.snapshot(opening);
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    requisitionId: snapshot.requisitionId,
    workspaceId: snapshot.workspaceId,
    hiringManagerId: snapshot.hiringManagerId,
    openedBy: snapshot.openedBy,
    title: snapshot.title,
    department: snapshot.department,
    headcount: snapshot.headcount,
    employmentType: snapshot.employmentType,
    salaryMinMinorUnits: snapshot.salaryMinMinorUnits,
    salaryMaxMinorUnits: snapshot.salaryMaxMinorUnits,
    currency: snapshot.currency,
    description: snapshot.description,
    status: snapshot.status,
    offersOut: snapshot.offersOut,
    hiredCount: snapshot.hiredCount,
    closedReason: snapshot.closedReason ?? null,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link JobOpeningRepository} implementation. */
export class PgJobOpeningRepository implements JobOpeningRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: JobOpeningId): Promise<JobOpening | undefined> {
    const rows = await this.#db.select().from(jobOpenings).where(eq(jobOpenings.id, id)).limit(1);
    return rows[0] === undefined ? undefined : openingFromRow(rows[0]);
  }

  async findByRequisition(
    organizationId: TenantId,
    requisitionId: string,
  ): Promise<JobOpening | undefined> {
    const rows = await this.#db
      .select()
      .from(jobOpenings)
      .where(
        and(
          eq(jobOpenings.organizationId, organizationId),
          eq(jobOpenings.requisitionId, requisitionId),
        ),
      )
      .limit(1);
    return rows[0] === undefined ? undefined : openingFromRow(rows[0]);
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly JobOpening[]> {
    const rows = await this.#db
      .select()
      .from(jobOpenings)
      .where(eq(jobOpenings.organizationId, organizationId))
      .orderBy(desc(jobOpenings.createdAt), desc(jobOpenings.id));
    return rows.map(openingFromRow);
  }

  async insert(opening: JobOpening): Promise<boolean> {
    try {
      await this.#db.insert(jobOpenings).values(openingToRow(opening));
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async update(opening: JobOpening, expectedVersion: number): Promise<boolean> {
    const row = openingToRow(opening);
    // Only what an opening may change; identity, scope and the approved terms stay as inserted.
    const updated = await this.#db
      .update(jobOpenings)
      .set({
        description: row.description,
        status: row.status,
        offersOut: row.offersOut,
        hiredCount: row.hiredCount,
        closedReason: row.closedReason,
        updatedAt: row.updatedAt,
        version: row.version,
      })
      .where(
        and(
          eq(jobOpenings.id, opening.id),
          eq(jobOpenings.organizationId, opening.organizationId),
          eq(jobOpenings.version, expectedVersion),
        ),
      )
      .returning({ id: jobOpenings.id });
    return updated.length === 1;
  }
}

function candidateFromRow(row: CandidateRow): Candidate {
  const snapshot: CandidateSnapshot = {
    id: CandidateId.from(row.id),
    organizationId: row.organizationId as TenantId,
    openingId: row.openingId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    email: row.email,
    ...(row.phone === null ? {} : { phone: row.phone }),
    source: row.source as CandidateSnapshot['source'],
    ...(row.resumeNotes === null ? {} : { resumeNotes: row.resumeNotes }),
    stage: row.stage as CandidateSnapshot['stage'],
    feedback: row.feedback as CandidateSnapshot['feedback'],
    ...(row.offer === null ? {} : { offer: row.offer as NonNullable<CandidateSnapshot['offer']> }),
    ...(row.closedReason === null ? {} : { closedReason: row.closedReason }),
    ...(row.employeeId === null ? {} : { employeeId: row.employeeId }),
    history: row.history as CandidateSnapshot['history'],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
  return Candidate.hydrate(snapshot);
}

function candidateToRow(candidate: Candidate): CandidateRow {
  const snapshot = Candidate.snapshot(candidate);
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    openingId: snapshot.openingId,
    workspaceId: snapshot.workspaceId,
    name: snapshot.name,
    email: snapshot.email,
    phone: snapshot.phone ?? null,
    source: snapshot.source,
    resumeNotes: snapshot.resumeNotes ?? null,
    stage: snapshot.stage,
    feedback: [...snapshot.feedback],
    offer: snapshot.offer ?? null,
    closedReason: snapshot.closedReason ?? null,
    employeeId: snapshot.employeeId ?? null,
    history: [...snapshot.history],
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link CandidateRepository} implementation. */
export class PgCandidateRepository implements CandidateRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: CandidateId): Promise<Candidate | undefined> {
    const rows = await this.#db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
    return rows[0] === undefined ? undefined : candidateFromRow(rows[0]);
  }

  async listByOpening(organizationId: TenantId, openingId: string): Promise<readonly Candidate[]> {
    const rows = await this.#db
      .select()
      .from(candidates)
      .where(
        and(eq(candidates.organizationId, organizationId), eq(candidates.openingId, openingId)),
      )
      .orderBy(asc(candidates.createdAt), asc(candidates.id));
    return rows.map(candidateFromRow);
  }

  async insert(candidate: Candidate): Promise<void> {
    await this.#db.insert(candidates).values(candidateToRow(candidate));
  }

  async update(candidate: Candidate, expectedVersion: number): Promise<boolean> {
    const row = candidateToRow(candidate);
    const updated = await this.#db
      .update(candidates)
      .set({
        stage: row.stage,
        feedback: row.feedback,
        offer: row.offer,
        closedReason: row.closedReason,
        employeeId: row.employeeId,
        history: row.history,
        updatedAt: row.updatedAt,
        version: row.version,
      })
      .where(
        and(
          eq(candidates.id, candidate.id),
          eq(candidates.organizationId, candidate.organizationId),
          eq(candidates.version, expectedVersion),
        ),
      )
      .returning({ id: candidates.id });
    return updated.length === 1;
  }
}

type OnboardingRow = typeof onboardings.$inferSelect;

function onboardingFromRow(row: OnboardingRow): Onboarding {
  const snapshot: OnboardingSnapshot = {
    id: OnboardingId.from(row.id),
    organizationId: row.organizationId as TenantId,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    workspaceId: row.workspaceId as WorkspaceId,
    hiringManagerId: row.hiringManagerId,
    ...(row.projectId === null ? {} : { projectId: row.projectId }),
    startedBy: row.startedBy,
    status: row.status as OnboardingSnapshot['status'],
    items: row.items as OnboardingSnapshot['items'],
    ...(row.completedAt === null ? {} : { completedAt: toIso(row.completedAt) }),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
  return Onboarding.hydrate(snapshot);
}

function onboardingToRow(onboarding: Onboarding): OnboardingRow {
  const snapshot = Onboarding.snapshot(onboarding);
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    employeeId: snapshot.employeeId,
    employeeName: snapshot.employeeName,
    workspaceId: snapshot.workspaceId,
    hiringManagerId: snapshot.hiringManagerId,
    projectId: snapshot.projectId ?? null,
    startedBy: snapshot.startedBy,
    status: snapshot.status,
    items: [...snapshot.items],
    completedAt: snapshot.completedAt === undefined ? null : new Date(snapshot.completedAt),
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Drizzle {@link OnboardingRepository} implementation. */
export class PgOnboardingRepository implements OnboardingRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: OnboardingId): Promise<Onboarding | undefined> {
    const rows = await this.#db.select().from(onboardings).where(eq(onboardings.id, id)).limit(1);
    return rows[0] === undefined ? undefined : onboardingFromRow(rows[0]);
  }

  async findByEmployee(
    organizationId: TenantId,
    employeeId: string,
  ): Promise<Onboarding | undefined> {
    const rows = await this.#db
      .select()
      .from(onboardings)
      .where(
        and(eq(onboardings.organizationId, organizationId), eq(onboardings.employeeId, employeeId)),
      )
      .limit(1);
    return rows[0] === undefined ? undefined : onboardingFromRow(rows[0]);
  }

  async listByOrganization(organizationId: TenantId): Promise<readonly Onboarding[]> {
    const rows = await this.#db
      .select()
      .from(onboardings)
      .where(eq(onboardings.organizationId, organizationId))
      .orderBy(desc(onboardings.createdAt), desc(onboardings.id));
    return rows.map(onboardingFromRow);
  }

  async insert(onboarding: Onboarding): Promise<boolean> {
    try {
      await this.#db.insert(onboardings).values(onboardingToRow(onboarding));
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async update(onboarding: Onboarding, expectedVersion: number): Promise<boolean> {
    const row = onboardingToRow(onboarding);
    const updated = await this.#db
      .update(onboardings)
      .set({
        status: row.status,
        items: row.items,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
        version: row.version,
      })
      .where(
        and(
          eq(onboardings.id, onboarding.id),
          eq(onboardings.organizationId, onboarding.organizationId),
          eq(onboardings.version, expectedVersion),
        ),
      )
      .returning({ id: onboardings.id });
    return updated.length === 1;
  }
}
