/**
 * @nexora/app-api — the API's {@link PolicyPort} (Prompt 5).
 *
 * Resolves TRUSTED facts for a policy question — the organization's
 * persisted policy configuration, and (for expense capabilities) the
 * persisted budget and its approved spend, read tenant- AND workspace-scoped
 * — and hands them to the one pure engine. It is the only place facts are
 * gathered, so the REST-adjacent paths (chat, agents, MCP, workflows) all
 * decide policy identically. Facts are never taken from arguments: the
 * `budgetId` argument is only a lookup key inside the trusted scope.
 *
 * Nothing here mutates state.
 */

import type { PolicyInvocationRequest, PolicyPort } from '@nexora/ai-runtime/execution';
import type { BudgetId } from '@nexora/module-finance';
import type { TenantId } from '@nexora/contracts/common';
import {
  POLICY_IDS,
  PolicyEngine,
  getPolicyRegistryEntry,
  SUBMIT_EXPENSE_CAPABILITY,
  type BudgetFact,
  type PolicyConfigEntry,
  type PolicyDecision,
  type PolicyFacts,
  type Resolvable,
} from '@nexora/module-policy';

import { fingerprintOf } from '@nexora/module-lineage';
import type { RepositorySet } from '../container.js';
import type { PolicySettingsRepository } from './policy-settings.js';

/** Dependencies of {@link ApiPolicyPort}. */
export interface ApiPolicyPortDependencies {
  settings: PolicySettingsRepository;
  repositories: Pick<RepositorySet, 'budgets' | 'expenses'>;
  engine?: PolicyEngine;
  now?: () => Date;
}

/**
 * Which organization-configurable policies a request consults. Registry-
 * driven: only policies the registry marks `configurable` are ever read, and
 * each declares the requests it applies to. Anything not listed here (notably
 * every read-only invocation) needs no configuration read at all.
 */
const CONFIG_CONSULTATION: readonly {
  policyId: string;
  applies: (request: PolicyInvocationRequest) => boolean;
}[] = [
  {
    policyId: POLICY_IDS.FINANCE_BUDGET_LIMIT,
    applies: (request) => request.capabilityId === SUBMIT_EXPENSE_CAPABILITY,
  },
  {
    // Approval governance can attach to ANY non-read-only capability.
    policyId: POLICY_IDS.APPROVAL_AUTHORITY,
    applies: (request) => request.sideEffectClass !== 'read_only',
  },
];

/** The configurable policy ids a request consults. */
function configurablePolicyIdsFor(request: PolicyInvocationRequest): readonly string[] {
  return CONFIG_CONSULTATION.filter(
    (entry) =>
      getPolicyRegistryEntry(entry.policyId)?.configurable === true && entry.applies(request),
  ).map((entry) => entry.policyId);
}

/** Evaluates policy over trusted, freshly-read facts. */
export class ApiPolicyPort implements PolicyPort {
  readonly #deps: ApiPolicyPortDependencies;
  readonly #engine: PolicyEngine;

  constructor(dependencies: ApiPolicyPortDependencies) {
    this.#deps = dependencies;
    this.#engine = dependencies.engine ?? new PolicyEngine(undefined, dependencies.now);
  }

  async evaluate(request: PolicyInvocationRequest): Promise<PolicyDecision> {
    const facts = await this.#resolveFacts(request);
    const decision = this.#engine.evaluate({
      organizationId: request.organizationId,
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      actor: { userId: request.userId },
      ...(request.agent === undefined ? {} : { agent: request.agent }),
      capabilityId: request.capabilityId,
      toolId: request.toolId,
      action: request.action,
      sideEffectClass: request.sideEffectClass,
      autonomyTier: request.autonomyTier,
      origin: request.origin,
      input: request.input,
      facts,
    });
    // The digest of the trusted facts this decision was made over (lineage).
    const contextFingerprint = fingerprintOf({
      budget: facts.budget,
      configs: Object.fromEntries(
        Object.entries(facts.configs).map(([id, entry]) => [id, entry.version]),
      ),
    });
    return { ...decision, contextFingerprint };
  }

  async #resolveFacts(request: PolicyInvocationRequest): Promise<PolicyFacts> {
    // Only requests whose rules consult organization configuration or
    // persisted resources pay for those reads; every other invocation
    // (notably every read) is decided in-process with no database round-trip.
    // ONE tenant-scoped repository read serves every consulted policy.
    const wanted = configurablePolicyIdsFor(request);
    const configs: Record<string, PolicyConfigEntry> = {};
    if (wanted.length > 0) {
      // Tenant-scoped by construction: only THIS organization's rows.
      const current = await this.#deps.settings.listCurrent(request.organizationId);
      for (const record of current) {
        if (wanted.includes(record.policyId)) {
          configs[record.policyId] = {
            version: record.version,
            config: record.config,
            enabled: record.enabled,
          };
        }
      }
    }
    if (request.capabilityId !== SUBMIT_EXPENSE_CAPABILITY) {
      return { configs };
    }
    return { configs, budget: await this.#resolveBudget(request) };
  }

  async #resolveBudget(request: PolicyInvocationRequest): Promise<Resolvable<BudgetFact>> {
    const raw = request.input['budgetId'];
    if (typeof raw !== 'string' || raw.trim().length === 0 || request.workspaceId === undefined) {
      return { state: 'unresolvable' };
    }
    try {
      const budget = await this.#deps.repositories.budgets.findById(raw.trim() as BudgetId);
      if (
        budget === undefined ||
        budget.organizationId !== (request.organizationId as TenantId) ||
        budget.workspaceId !== request.workspaceId
      ) {
        // Foreign / cross-workspace / missing are indistinguishable (no oracle).
        return { state: 'unresolvable' };
      }
      const approved = await this.#deps.repositories.expenses.listApprovedByBudget(
        request.organizationId as TenantId,
        budget.id,
      );
      return {
        state: 'resolved',
        value: {
          status: budget.status.value,
          allocatedMinorUnits: budget.allocated.minorUnits,
          spentMinorUnits: approved.reduce((sum, expense) => sum + expense.amount.minorUnits, 0),
          currency: budget.allocated.currency,
        },
      };
    } catch {
      return { state: 'unresolvable' };
    }
  }
}
