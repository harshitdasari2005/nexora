/**
 * @nexora/app-api — policy administration service (Prompt 8).
 *
 * The ONLY writer of organization policy configuration. It is reachable
 * solely through the RBAC-gated `/api/policy/*` routes (`policy.read` /
 * `policy.manage`, human-only and non-delegable): there is no AI tool, MCP
 * tool, agent capability or chat path to it.
 *
 * Contract:
 * - Every write is a NEW immutable version (`PolicySettingsRepository` has no
 *   update/delete). Enable/disable is a new version that copies the previous
 *   configuration.
 * - Configuration is DATA: it is validated by the strict allow-list
 *   `validatePolicyConfig` BEFORE anything is written; rejection details name
 *   JSON paths and rules, never values.
 * - `expectedVersion` gives optimistic concurrency (409 on mismatch).
 * - Each stored version is published as an audit event (ids, versions,
 *   change type, config hash, actor — never configuration values).
 * - Historical decisions keep the policy version they were made at; a new
 *   version never rewrites them.
 */

import type { UserId } from '@nexora/contracts/common';
import type { EventPublisher } from '@nexora/shared/events';
import {
  POLICY_IDS,
  POLICY_REGISTRY,
  getPolicyRegistryEntry,
  parseApprovalAuthorityConfig,
  validatePolicyConfig,
  type PolicyBehavior,
} from '@nexora/module-policy';
import type { RepositorySet } from '../container.js';
import {
  policyAdminDeniedEvent,
  policyVersionEvent,
  type PolicyAdminDeniedEventInput,
} from './policy-events.js';
import {
  PolicyVersionConflictError,
  type PolicyChangeType,
  type PolicySettingRecord,
  type PolicySettingsRepository,
} from './policy-settings.js';

/** Maximum length of a change reason. */
export const POLICY_REASON_MAX_LENGTH = 500;
const DEFAULT_APPROVAL_TTL_MINUTES = 24 * 60;

/** One policy in the administration list. */
export interface PolicyAdminDto {
  policyId: string;
  title: string;
  description: string;
  scope: 'organization';
  configurable: boolean;
  managedBy: 'platform' | 'organization';
  /** The static rule (code) version. */
  ruleVersion: string;
  /** The current configuration version (absent when never configured). */
  currentVersion?: number;
  /** Whether an organization configuration applies (platform policies are always enforced). */
  enabled: boolean;
  config?: unknown;
  effectiveAt?: string;
  updatedBy?: string;
  updatedByName?: string;
  fingerprint?: string;
  behavior: PolicyBehavior;
  /** Approval governance summary (POLICY_APPROVAL_AUTHORITY only). */
  approval?: {
    separationOfDuties: boolean;
    requiredApproverRoleIds: readonly string[];
    ttlMinutes: number;
  };
}

/** One immutable stored version of a policy configuration. */
export interface PolicyVersionDto {
  policyId: string;
  version: number;
  enabled: boolean;
  config: unknown;
  reason?: string;
  changeType: PolicyChangeType;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  fingerprint: string;
}

/** A new-version request (already shape-checked by the route). */
export interface CreatePolicyVersionRequest {
  organizationId: string;
  workspaceId: string;
  actorId: string;
  policyId: string;
  config?: unknown;
  enabled?: boolean;
  reason?: string;
  expectedVersion?: number;
  correlationId: string;
}

/** The outcome of {@link PolicyAdminService.createVersion}. */
export type CreatePolicyVersionResult =
  | { ok: true; version: PolicyVersionDto }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'NOT_CONFIGURABLE' }
  | { ok: false; code: 'CONFIG_INVALID'; errors: readonly string[] }
  | { ok: false; code: 'VERSION_CONFLICT'; currentVersion: number };

/** Dependencies of {@link PolicyAdminService}. */
export interface PolicyAdminServiceDependencies {
  settings: PolicySettingsRepository;
  users: Pick<RepositorySet['users'], 'findById'>;
  publisher: EventPublisher;
}

/** Reads, versions and audits organization policy configuration. */
export class PolicyAdminService {
  readonly #deps: PolicyAdminServiceDependencies;

  constructor(dependencies: PolicyAdminServiceDependencies) {
    this.#deps = dependencies;
  }

  /** Every registry policy with this organization's current configuration state. */
  async list(organizationId: string): Promise<readonly PolicyAdminDto[]> {
    const current = new Map(
      (await this.#deps.settings.listCurrent(organizationId)).map((r) => [r.policyId, r]),
    );
    const names = await this.#resolveNames([...current.values()].map((r) => r.createdBy));
    return POLICY_REGISTRY.map((entry) => {
      const record = entry.configurable ? current.get(entry.policyId) : undefined;
      const dto: PolicyAdminDto = {
        policyId: entry.policyId,
        title: entry.title,
        description: entry.description,
        scope: 'organization',
        configurable: entry.configurable,
        managedBy: entry.managedBy,
        ruleVersion: entry.ruleVersion,
        enabled: entry.configurable ? record?.enabled === true : true,
        behavior: entry.behavior,
        ...(record === undefined
          ? {}
          : {
              currentVersion: record.version,
              config: record.config,
              effectiveAt: record.createdAt,
              updatedBy: record.createdBy,
              ...(names.has(record.createdBy)
                ? { updatedByName: names.get(record.createdBy) as string }
                : {}),
              fingerprint: record.configHash,
            }),
      };
      const approval =
        entry.policyId === POLICY_IDS.APPROVAL_AUTHORITY && record?.enabled === true
          ? approvalSummary(record.config)
          : undefined;
      return approval === undefined ? dto : { ...dto, approval };
    });
  }

  /** Every version of a policy, newest first; `undefined` for an unknown policy id. */
  async history(
    organizationId: string,
    policyId: string,
  ): Promise<readonly PolicyVersionDto[] | undefined> {
    const entry = getPolicyRegistryEntry(policyId);
    if (entry === undefined) {
      return undefined;
    }
    if (!entry.configurable) {
      return [];
    }
    const records = await this.#deps.settings.history(organizationId, policyId);
    const names = await this.#resolveNames(records.map((r) => r.createdBy));
    return [...records].reverse().map((record) => toVersionDto(record, names));
  }

  /** Writes a new immutable version and audits it. */
  async createVersion(input: CreatePolicyVersionRequest): Promise<CreatePolicyVersionResult> {
    const entry = getPolicyRegistryEntry(input.policyId);
    if (entry === undefined) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (!entry.configurable) {
      return { ok: false, code: 'NOT_CONFIGURABLE' };
    }
    const current = await this.#deps.settings.current(input.organizationId, input.policyId);
    const currentVersion = current?.version ?? 0;
    if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
      return { ok: false, code: 'VERSION_CONFLICT', currentVersion };
    }

    let config: unknown;
    if (input.config !== undefined) {
      // Validated BEFORE anything is written; the NORMALIZED value is stored.
      const validation = validatePolicyConfig(input.policyId, input.config);
      if (!validation.ok) {
        return { ok: false, code: 'CONFIG_INVALID', errors: validation.errors };
      }
      config = validation.value;
    } else if (current === undefined) {
      return {
        ok: false,
        code: 'CONFIG_INVALID',
        errors: ['$: no configuration exists yet; send a "config" to create the first version'],
      };
    } else if (input.enabled === undefined || input.enabled === current.enabled) {
      return {
        ok: false,
        code: 'CONFIG_INVALID',
        errors: ['$: nothing to change; send a "config" or a different "enabled" value'],
      };
    } else {
      // Enable / disable: a NEW version copying the previous configuration.
      config = structuredClone(current.config);
    }

    const enabled = input.enabled ?? current?.enabled ?? true;
    const changeType: PolicyChangeType =
      current === undefined
        ? 'created'
        : enabled !== current.enabled
          ? enabled
            ? 'enabled'
            : 'disabled'
          : 'version';

    let stored: PolicySettingRecord;
    try {
      stored = await this.#deps.settings.append({
        organizationId: input.organizationId,
        policyId: input.policyId,
        config,
        enabled,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        changeType,
        createdBy: input.actorId,
        expectedVersion: currentVersion,
      });
    } catch (error) {
      if (error instanceof PolicyVersionConflictError) {
        return { ok: false, code: 'VERSION_CONFLICT', currentVersion: error.currentVersion };
      }
      throw error;
    }

    await this.#deps.publisher.publish([
      policyVersionEvent({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        policyId: input.policyId,
        version: stored.version,
        ...(current === undefined ? {} : { previousVersion: current.version }),
        changeType,
        configHash: stored.configHash,
        enabled: stored.enabled,
        correlationId: input.correlationId,
      }),
    ]);
    const names = await this.#resolveNames([stored.createdBy]);
    return { ok: true, version: toVersionDto(stored, names) };
  }

  /** Audits an unauthorized (403) read/mutation attempt, after scope membership was verified. */
  async recordDenied(input: PolicyAdminDeniedEventInput): Promise<void> {
    await this.#deps.publisher.publish([policyAdminDeniedEvent(input)]);
  }

  async #resolveNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    await Promise.all(
      [...new Set(userIds)].map(async (id) => {
        const user = await this.#deps.users.findById(id as UserId);
        if (user !== undefined) {
          const display = user.profile.displayName.value;
          names.set(id, display.length > 0 ? display : user.email.value);
        }
      }),
    );
    return names;
  }
}

function toVersionDto(record: PolicySettingRecord, names: Map<string, string>): PolicyVersionDto {
  return {
    policyId: record.policyId,
    version: record.version,
    enabled: record.enabled,
    config: record.config,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    changeType: record.changeType,
    createdBy: record.createdBy,
    ...(names.has(record.createdBy)
      ? { createdByName: names.get(record.createdBy) as string }
      : {}),
    createdAt: record.createdAt,
    fingerprint: record.configHash,
  };
}

/** Summarizes an approval-authority configuration (`undefined` when it cannot be parsed). */
function approvalSummary(config: unknown): PolicyAdminDto['approval'] | undefined {
  const parsed = parseApprovalAuthorityConfig(config);
  if (parsed === undefined) {
    return undefined;
  }
  const ttls = parsed.rules.flatMap((rule) =>
    rule.ttlMinutes === undefined ? [] : [rule.ttlMinutes],
  );
  return {
    separationOfDuties: parsed.rules.some((rule) => rule.separationOfDuties === true),
    requiredApproverRoleIds: [
      ...new Set(
        parsed.rules.flatMap((rule) =>
          rule.requiredApproverRoleId === undefined ? [] : [rule.requiredApproverRoleId],
        ),
      ),
    ],
    // The shortest configured TTL (the strictest); the platform default when none is set.
    ttlMinutes: ttls.length === 0 ? DEFAULT_APPROVAL_TTL_MINUTES : Math.min(...ttls),
  };
}
