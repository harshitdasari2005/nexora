/**
 * @nexora/app-api — FlagOverBudgetItemsTool.
 *
 * The Finance REMEDIATION capability exposed to the Enterprise AI Runtime:
 * a PARAMETERLESS tool that re-scans every active budget in the current
 * workspace and flags the ones at or above the deterministic high-
 * utilization threshold for review, through the Finance **application
 * layer** — the SAME `FlagOverBudgetItemsHandler` a human REST call uses.
 *
 * This is the tool the `finance_budget_overrun` detection signal's
 * remediation plan resolves to (platform/detection's
 * `remediationCapabilities`) — the deterministic detection → problem →
 * remediation → approval → execution → verification chain's final step.
 * The remediation engine can only execute PARAMETERLESS capabilities (it
 * never supplies a target budget id — see PlanBuilder's doc comment on
 * `projects.find_project`), which is exactly this tool's shape: it acts on
 * "every over-threshold active budget in scope," never on a model-chosen
 * one.
 *
 * Security contract (same model as {@link CreateCalendarEventTool}):
 * - Input is empty (`additionalProperties: false`, no properties) — there
 *   is nothing for a model to supply. Identity, tenant, and workspace come
 *   exclusively from the trusted execution context.
 * - Workspace scope is mandatory: budgets are workspace-scoped.
 * - Authorization mirrors the REST surface (`POST /api/finance/budgets/
 *   flag-over-threshold`): membership of the trusted tenant AND workspace.
 * - Consequential (BR-13/BR-19): a real, persisted state change (budgets
 *   move to `under_review`) — always gated by human approval, never a
 *   notify-only no-op.
 * - Delegation: the tool calls the FlagOverBudgetItemsHandler (application
 *   layer), which itself recomputes utilization from the SAME
 *   `listBudgetUtilization` projection the detection snapshot read — the
 *   threshold is a hard-coded constant, never LLM-decided, and is
 *   RE-VERIFIED at execution time (never trusting a stale detection).
 * - Verification: every flagged budget is confirmed to belong to the
 *   trusted tenant + workspace before being reported.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { FlagOverBudgetItemsHandler } from '@nexora/application-finance';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

/** Input contract: empty — this tool is parameterless by design. */
export type FlagOverBudgetItemsInput = Record<string, never>;

/** Output contract of {@link FlagOverBudgetItemsTool}. */
export interface FlagOverBudgetItemsOutput {
  /** The budgets newly flagged `under_review` by this run. */
  flagged: readonly {
    id: string;
    name: string;
    status: string;
    workspaceId: string;
  }[];
}

/** The tool manifest: consequential, parameterless (remediation-executable). */
export const FLAG_OVER_BUDGET_ITEMS_MANIFEST: ToolManifest = {
  id: 'finance.flag_over_budget_items',
  name: 'Flag over-budget items',
  description:
    'Re-scans active budgets in the current workspace and flags the ones over the deterministic utilization threshold for review',
  sideEffectClass: 'consequential',
  idempotent: true,
  timeoutMs: 15_000,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/**
 * The remediation write tool that flags over-threshold budgets through the
 * Finance application layer under the trusted execution context.
 */
export class FlagOverBudgetItemsTool implements Tool<
  FlagOverBudgetItemsInput,
  FlagOverBudgetItemsOutput
> {
  readonly manifest = FLAG_OVER_BUDGET_ITEMS_MANIFEST;

  readonly #flagOverBudgetItems: FlagOverBudgetItemsHandler;
  readonly #listOrganizations: ListOrganizationsHandler;
  readonly #listMyWorkspaces: ListMyWorkspacesHandler;

  constructor(dependencies: {
    flagOverBudgetItems: FlagOverBudgetItemsHandler;
    listOrganizations: ListOrganizationsHandler;
    listMyWorkspaces: ListMyWorkspacesHandler;
  }) {
    this.#flagOverBudgetItems = dependencies.flagOverBudgetItems;
    this.#listOrganizations = dependencies.listOrganizations;
    this.#listMyWorkspaces = dependencies.listMyWorkspaces;
  }

  async execute(
    _input: FlagOverBudgetItemsInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<FlagOverBudgetItemsOutput>> {
    // 1. Workspace scope is mandatory: budgets are workspace-scoped.
    const workspaceId = context.workspaceId;
    if (workspaceId === undefined || workspaceId.length === 0) {
      return this.#failure('A workspace is required to flag over-budget items');
    }

    // 2. Authorization: the caller must be a member of the trusted tenant
    //    AND the trusted workspace.
    const membership = await this.#listOrganizations.handle({ userId: context.userId as UserId });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure('You are not authorized to flag budgets in this organization');
    }
    const workspaces = await this.#listMyWorkspaces.handle({
      userId: context.userId as UserId,
      organizationId: context.tenantId as TenantId,
    });
    if (!workspaces.ok || !workspaces.value.some((workspace) => workspace.id === workspaceId)) {
      return this.#failure('You are not authorized to flag budgets in this workspace');
    }

    // 3. Delegate to the application layer (the authoritative path — it
    //    re-checks the deterministic threshold at execution time).
    const result = await this.#flagOverBudgetItems.handle({
      organizationId: context.tenantId as TenantId,
      workspaceId: workspaceId as WorkspaceId,
      actorId: context.userId as UserId,
      correlationId: context.executionId,
    });
    if (!result.ok) {
      return this.#failure('Could not flag over-budget items');
    }

    // 4. Verify every flagged budget belongs to the trusted scope — the
    //    model never decides success, the application result is
    //    authoritative, and this check is defense-in-depth.
    const flagged = result.value.flagged.filter(
      (budget) => budget.organizationId === context.tenantId && budget.workspaceId === workspaceId,
    );
    if (flagged.length !== result.value.flagged.length) {
      return this.#failure('Budget flagging verification failed: unexpected scope');
    }

    return {
      ok: true,
      output: {
        flagged: flagged.map((budget) => ({
          id: budget.id,
          name: budget.name.value,
          status: budget.status.value,
          workspaceId: budget.workspaceId,
        })),
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<FlagOverBudgetItemsOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}
