/**
 * @nexora/app-web — Guided Demo fact loader (I/O).
 *
 * Reads every fact the stage model needs from the REAL backend, with the
 * CURRENT persona's real session. A read the persona is not permitted to make
 * (403) simply yields no fact — nothing is inferred in its place. Each fact
 * records which persona observed it, so the stage model can insist that, for
 * example, the project relationship was seen with the Team Manager's own
 * session.
 */

import { api, ApiError } from '../lib/api.js';
import { getDecisionTrace } from '../lib/audit.js';
import { fetchApproval, type DemoConfig } from '../lib/demo.js';
import type {
  BudgetDto,
  BudgetUtilizationDto,
  EmployeeDto,
  ExpenseDto,
  ProjectDto,
  RuntimeRunDetailDto,
  WorkflowInstanceDto,
} from '../lib/types.js';
import type { GuidedRun } from './guided-store.js';
import { saveGuidedRun } from './guided-store.js';
import type { JourneyFacts, Observed, PersonaKey } from './journey.js';

/** The demo's trusted scopes (server-published ids). */
export interface DemoScopes {
  organizationId: string;
  engineeringWorkspaceId: string;
  financeWorkspaceId: string;
}

/** Runs a read; `undefined` when the backend refuses or fails it. */
async function attempt<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError) return undefined;
    throw error;
  }
}

function seen<T>(value: T, observedAs: PersonaKey): Observed<T> {
  return { value, observedAs };
}

/** Resolves the demo's scopes from the server-published persona list. */
export function scopesOf(config: DemoConfig): DemoScopes | null {
  const eng = config.personas.find((p) => p.key === 'ceo')?.workspaceId;
  const fin = config.personas.find((p) => p.key === 'cfo')?.workspaceId;
  if (eng === undefined || fin === undefined) return null;
  return {
    organizationId: config.organizationId,
    engineeringWorkspaceId: eng,
    financeWorkspaceId: fin,
  };
}

/** The demo budget, found by its server-published name in the finance workspace. */
export async function findDemoBudget(
  scopes: DemoScopes,
  budgetName: string,
): Promise<BudgetDto | undefined> {
  const listed = await attempt(() =>
    api<{ budgets: BudgetDto[] }>(
      `/finance/budgets?organizationId=${encodeURIComponent(scopes.organizationId)}&workspaceId=${encodeURIComponent(scopes.financeWorkspaceId)}`,
    ),
  );
  return listed?.budgets.find((budget) => budget.name === budgetName);
}

/** Loads every fact the current persona can read. */
export async function loadFacts(
  config: DemoConfig,
  scopes: DemoScopes,
  persona: PersonaKey,
  run: GuidedRun,
): Promise<JourneyFacts> {
  const org = encodeURIComponent(scopes.organizationId);
  const eng = encodeURIComponent(scopes.engineeringWorkspaceId);
  const fin = encodeURIComponent(scopes.financeWorkspaceId);
  const employeeName = extractEmployeeName(config.story.hireRequest);
  const facts: JourneyFacts = { hire: { employeeName }, finance: {}, trace: {} };

  // --- Hiring ---------------------------------------------------------------
  if (run.hireApprovalId !== undefined) {
    const approval = await attempt(() =>
      fetchApproval(run.hireApprovalId as string, {
        organizationId: scopes.organizationId,
        workspaceId: scopes.engineeringWorkspaceId,
      }),
    );
    if (approval !== undefined) facts.hire.approval = seen(approval, persona);
    if (run.hireSelfApproval !== undefined) facts.hire.selfApproval = run.hireSelfApproval;

    const workflows = await attempt(() =>
      api<{ workflows: WorkflowInstanceDto[] }>(`/workflows?organizationId=${org}`),
    );
    const instance = workflows?.workflows.find((w) => w.approvalId === run.hireApprovalId);
    if (instance?.state !== undefined) {
      facts.hire.workflow = seen(
        {
          state: instance.state,
          ...(instance.stateDetail === undefined ? {} : { stateDetail: instance.stateDetail }),
          ...(instance.rollbackSummary === undefined
            ? {}
            : { rollbackSummary: instance.rollbackSummary }),
          ...(instance.verification === undefined
            ? {}
            : {
                verification: {
                  status: instance.verification.status,
                  countedSteps: instance.verification.countedSteps,
                  verifiedSteps: instance.verification.verifiedSteps,
                },
              }),
        },
        persona,
      );
    }
  }

  const employees = await attempt(() =>
    api<{ employees: EmployeeDto[] }>(`/employees?organizationId=${org}`),
  );
  const employee = employees?.employees.find((e) => e.name === employeeName);
  if (employee !== undefined) {
    facts.hire.employee = seen(
      { id: employee.id, name: employee.name, status: employee.status },
      persona,
    );
  }

  const projects = await attempt(() =>
    api<{ projects: ProjectDto[] }>(`/projects?organizationId=${org}`),
  );
  const project = projects?.projects.find((p) => p.name === config.story.projectName);
  if (project !== undefined) {
    const members = await attempt(() =>
      api<{ members: { employeeName: string | null; assignedAt: string }[] }>(
        `/projects/${encodeURIComponent(project.id)}/members?organizationId=${org}`,
      ),
    );
    if (members !== undefined) {
      const team = members.members.map((m) => ({
        employeeName: m.employeeName,
        assignedAt: m.assignedAt,
      }));
      facts.hire.members = seen(team, persona);
      if (persona === 'manager') facts.hire.managerMembers = seen(team, persona);
    }
  }

  // --- Finance ----------------------------------------------------------------
  if (run.financeApprovalId !== undefined) {
    const approval = await attempt(() =>
      fetchApproval(run.financeApprovalId as string, {
        organizationId: scopes.organizationId,
        workspaceId: scopes.financeWorkspaceId,
      }),
    );
    if (approval !== undefined) facts.finance.approval = seen(approval, persona);
    if (run.financeSelfApproval !== undefined) facts.finance.selfApproval = run.financeSelfApproval;
  }
  const expenses = await attempt(() =>
    api<{ expenses: ExpenseDto[] }>(`/finance/expenses?organizationId=${org}&workspaceId=${fin}`),
  );
  const expense = expenses?.expenses
    .filter((e) => e.description === config.story.expense.description)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (expense !== undefined) {
    facts.finance.expense = seen(
      {
        id: expense.id,
        status: expense.status,
        amountMinorUnits: expense.amountMinorUnits,
        currency: expense.currency,
        description: expense.description,
        ...(expense.decidedBy === undefined ? {} : { decidedBy: expense.decidedBy }),
      },
      persona,
    );
  }
  const utilization = await attempt(() =>
    api<{ utilization: BudgetUtilizationDto[] }>(
      `/finance/budgets/utilization?organizationId=${org}&workspaceId=${fin}`,
    ),
  );
  const budget = utilization?.utilization.find((u) => u.name === config.story.budgetName);
  if (budget !== undefined) {
    const fact = {
      budgetId: budget.budgetId,
      name: budget.name,
      currency: budget.currency,
      allocatedMinorUnits: budget.allocatedMinorUnits,
      spentMinorUnits: budget.spentMinorUnits,
      utilizationPercent: budget.utilizationPercent,
    };
    facts.finance.utilizationNow = seen(fact, persona);
    // The baseline is the utilization first read while the expense was still
    // pending — recorded once, from a real read, never edited afterwards.
    if (run.utilizationBefore !== undefined) {
      const { observedAs, ...value } = run.utilizationBefore;
      facts.finance.utilizationBefore = { value, observedAs };
    } else if (expense?.status === 'pending' && (persona === 'controller' || persona === 'cfo')) {
      saveGuidedRun({ utilizationBefore: { ...fact, observedAs: persona } });
      facts.finance.utilizationBefore = seen(fact, persona);
    }
  }

  // --- Trace / audit / runtime (audit-capable persona only) -----------------
  if (run.hireApprovalId !== undefined) {
    const traceScope = {
      organizationId: scopes.organizationId,
      workspaceId: scopes.engineeringWorkspaceId,
    };
    const trace = await attempt(() => getDecisionTrace(traceScope, `apr:${run.hireApprovalId}`));
    if (trace !== undefined) {
      facts.trace.hireTrace = seen(
        {
          executions: trace.executions.length,
          verifiedExecutions: trace.executions.filter((e) => e.verified === true).length,
          ...(trace.actors?.approver?.name === undefined
            ? {}
            : { approverName: trace.actors.approver.name }),
        },
        persona,
      );
    }
    const audit = await attempt(() =>
      api<{ events: { action: string }[] }>(
        `/audit/events?organizationId=${org}&workspaceId=${eng}`,
      ),
    );
    if (audit !== undefined) {
      facts.trace.auditActions = seen(
        audit.events.map((e) => e.action),
        persona,
      );
    }
    const runId = facts.hire.approval?.value.runId;
    if (runId !== undefined) {
      const detail = await attempt(() =>
        api<RuntimeRunDetailDto>(
          `/ops/runtime/runs/${encodeURIComponent(runId)}?organizationId=${org}&workspaceId=${eng}`,
        ),
      );
      if (detail !== undefined) {
        facts.trace.runtimeRun = seen({ runId: detail.run.id, status: detail.run.status }, persona);
      }
    }
  }

  return facts;
}

/** "Hire Sarah Thomas and assign her to …" → "Sarah Thomas" (the server-published request). */
export function extractEmployeeName(hireRequest: string): string {
  const match = /^Hire\s+(.+?)\s+and\s+assign/i.exec(hireRequest);
  return match?.[1] ?? hireRequest;
}
