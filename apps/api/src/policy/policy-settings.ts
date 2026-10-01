/**
 * @nexora/app-api — organization policy configuration store (Prompt 5, 8).
 *
 * Append-only and versioned per (organization, policy): `append` INSERTS the
 * next version and never rewrites an old one (the repository has no update
 * or delete), so any historical decision that names `POLICY_X@1+config.2`
 * can be explained exactly as it was. "Disable" is a NEW version with
 * `enabled = false`. Reads are tenant-scoped — one organization's
 * configuration can never be observed by, or applied to, another.
 *
 * Optimistic concurrency: `expectedVersion` (the latest version the writer
 * saw, `0` for none) mismatching raises {@link PolicyVersionConflictError}.
 * Without it, `append` retries ONLY on a unique-violation (SQLSTATE 23505)
 * of the (org, policy, version) index; every other error propagates.
 *
 * The public write surface is the policy administration service
 * (`policy-admin-service.ts`, RBAC `policy.manage`); there is no AI path.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { policySettings, type NexoraDatabase } from '@nexora/persistence';
import type { PolicyConfigEntry } from '@nexora/module-policy';
import { fingerprintOf } from '@nexora/module-lineage';

/** Why a version was written. */
export type PolicyChangeType = 'created' | 'version' | 'enabled' | 'disabled';

/** One stored configuration version. */
export interface PolicySettingRecord extends PolicyConfigEntry {
  organizationId: string;
  policyId: string;
  /** Always present on a stored record. */
  enabled: boolean;
  reason?: string;
  changeType: PolicyChangeType;
  /** sha256 of the canonical configuration JSON. */
  configHash: string;
  createdBy: string;
  createdAt: string;
}

/** Inputs of {@link PolicySettingsRepository.append}. */
export interface AppendPolicySettingInput {
  organizationId: string;
  policyId: string;
  config: unknown;
  /** Default true. */
  enabled?: boolean;
  reason?: string;
  /** Default: `created` for the first version, else `version`. */
  changeType?: PolicyChangeType;
  createdBy: string;
  /** The latest version the writer saw (0 = none); a mismatch is a conflict. */
  expectedVersion?: number;
  at?: Date;
}

/** Raised when `expectedVersion` no longer matches the latest stored version. */
export class PolicyVersionConflictError extends Error {
  readonly code = 'POLICY_VERSION_CONFLICT';
  readonly currentVersion: number;
  constructor(currentVersion: number) {
    super('The policy changed since it was read');
    this.name = 'PolicyVersionConflictError';
    this.currentVersion = currentVersion;
  }
}

/** Persistence port for organization policy configuration (append-only). */
export interface PolicySettingsRepository {
  /** The highest-version configuration of a policy in an organization (including `enabled`). */
  current(organizationId: string, policyId: string): Promise<PolicySettingRecord | undefined>;
  /** The latest version of every configured policy of an organization, ordered by policy id. */
  listCurrent(organizationId: string): Promise<readonly PolicySettingRecord[]>;
  /** One exact version of a policy, when it exists. */
  get(
    organizationId: string,
    policyId: string,
    version: number,
  ): Promise<PolicySettingRecord | undefined>;
  /** Every version of a policy in an organization, oldest first. */
  history(organizationId: string, policyId: string): Promise<readonly PolicySettingRecord[]>;
  /** INSERTS the next version (never rewrites); returns the stored record. */
  append(input: AppendPolicySettingInput): Promise<PolicySettingRecord>;
}

function resolveChangeType(input: AppendPolicySettingInput, isFirst: boolean): PolicyChangeType {
  return input.changeType ?? (isFirst ? 'created' : 'version');
}

/** In-memory {@link PolicySettingsRepository} (tests, evaluation harness). */
export class InMemoryPolicySettingsRepository implements PolicySettingsRepository {
  readonly #records: PolicySettingRecord[] = [];

  async current(
    organizationId: string,
    policyId: string,
  ): Promise<PolicySettingRecord | undefined> {
    const all = await this.history(organizationId, policyId);
    return all[all.length - 1];
  }

  async listCurrent(organizationId: string): Promise<readonly PolicySettingRecord[]> {
    const latest = new Map<string, PolicySettingRecord>();
    for (const record of this.#records) {
      if (record.organizationId !== organizationId) continue;
      const existing = latest.get(record.policyId);
      if (existing === undefined || existing.version < record.version) {
        latest.set(record.policyId, record);
      }
    }
    return [...latest.values()]
      .sort((a, b) => (a.policyId < b.policyId ? -1 : 1))
      .map((r) => cloneRecord(r));
  }

  async get(
    organizationId: string,
    policyId: string,
    version: number,
  ): Promise<PolicySettingRecord | undefined> {
    const found = this.#records.find(
      (r) =>
        r.organizationId === organizationId && r.policyId === policyId && r.version === version,
    );
    return found === undefined ? undefined : cloneRecord(found);
  }

  async history(organizationId: string, policyId: string): Promise<readonly PolicySettingRecord[]> {
    return this.#records
      .filter((r) => r.organizationId === organizationId && r.policyId === policyId)
      .sort((a, b) => a.version - b.version)
      .map((r) => cloneRecord(r));
  }

  async append(input: AppendPolicySettingInput): Promise<PolicySettingRecord> {
    const latest = await this.current(input.organizationId, input.policyId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== (latest?.version ?? 0)) {
      throw new PolicyVersionConflictError(latest?.version ?? 0);
    }
    const record: PolicySettingRecord = {
      organizationId: input.organizationId,
      policyId: input.policyId,
      version: (latest?.version ?? 0) + 1,
      config: structuredClone(input.config),
      enabled: input.enabled ?? true,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      changeType: resolveChangeType(input, latest === undefined),
      configHash: fingerprintOf(input.config),
      createdBy: input.createdBy,
      createdAt: (input.at ?? new Date()).toISOString(),
    };
    this.#records.push(record);
    return cloneRecord(record);
  }
}

/** A deep copy: records handed out must never alias the stored (append-only) history. */
function cloneRecord(record: PolicySettingRecord): PolicySettingRecord {
  return { ...record, config: structuredClone(record.config) };
}

/** SQLSTATE of a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** PostgreSQL {@link PolicySettingsRepository}. */
export class PgPolicySettingsRepository implements PolicySettingsRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async current(
    organizationId: string,
    policyId: string,
  ): Promise<PolicySettingRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(policySettings)
      .where(
        and(
          eq(policySettings.organizationId, organizationId),
          eq(policySettings.policyId, policyId),
        ),
      )
      .orderBy(desc(policySettings.version))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async listCurrent(organizationId: string): Promise<readonly PolicySettingRecord[]> {
    const rows = await this.#db
      .selectDistinctOn([policySettings.policyId])
      .from(policySettings)
      .where(eq(policySettings.organizationId, organizationId))
      .orderBy(policySettings.policyId, desc(policySettings.version));
    return rows.map(toRecord);
  }

  async get(
    organizationId: string,
    policyId: string,
    version: number,
  ): Promise<PolicySettingRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(policySettings)
      .where(
        and(
          eq(policySettings.organizationId, organizationId),
          eq(policySettings.policyId, policyId),
          eq(policySettings.version, version),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async history(organizationId: string, policyId: string): Promise<readonly PolicySettingRecord[]> {
    const rows = await this.#db
      .select()
      .from(policySettings)
      .where(
        and(
          eq(policySettings.organizationId, organizationId),
          eq(policySettings.policyId, policyId),
        ),
      )
      .orderBy(policySettings.version);
    return rows.map(toRecord);
  }

  async append(input: AppendPolicySettingInput): Promise<PolicySettingRecord> {
    // INSERT-ONLY. The unique (org, policy, version) index makes a concurrent
    // append lose loudly instead of silently overwriting: retry ONLY on a
    // unique violation (and, with an expectedVersion, report it as a conflict).
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt += 1) {
      const latest = await this.current(input.organizationId, input.policyId);
      const latestVersion = latest?.version ?? 0;
      if (input.expectedVersion !== undefined && input.expectedVersion !== latestVersion) {
        throw new PolicyVersionConflictError(latestVersion);
      }
      const version = latestVersion + 1;
      const createdAt = input.at ?? new Date();
      const enabled = input.enabled ?? true;
      const changeType = resolveChangeType(input, latest === undefined);
      const configHash = fingerprintOf(input.config);
      try {
        await this.#db.insert(policySettings).values({
          id: `pol_${randomUUID()}`,
          organizationId: input.organizationId,
          policyId: input.policyId,
          version,
          config: input.config as never,
          enabled,
          reason: input.reason ?? null,
          configHash,
          changeType,
          createdBy: input.createdBy,
          createdAt,
        });
        return {
          organizationId: input.organizationId,
          policyId: input.policyId,
          version,
          config: input.config,
          enabled,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          changeType,
          configHash,
          createdBy: input.createdBy,
          createdAt: createdAt.toISOString(),
        };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        if (input.expectedVersion !== undefined) {
          const now = await this.current(input.organizationId, input.policyId);
          throw new PolicyVersionConflictError(now?.version ?? version);
        }
        if (attempt >= maxAttempts) {
          throw error;
        }
      }
    }
  }
}

function toRecord(row: typeof policySettings.$inferSelect): PolicySettingRecord {
  return {
    organizationId: row.organizationId,
    policyId: row.policyId,
    version: row.version,
    config: row.config,
    enabled: row.enabled,
    ...(row.reason === null ? {} : { reason: row.reason }),
    changeType: (row.changeType as PolicyChangeType) ?? 'version',
    // Legacy rows (before config_hash) are fingerprinted on read.
    configHash: row.configHash ?? fingerprintOf(row.config),
    createdBy: row.createdBy,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}
