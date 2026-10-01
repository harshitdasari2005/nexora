/**
 * @nexora/app-api — governed-lifecycle state checks (Prompt 9, dataset 1.8.0).
 *
 * Every check reads what the REAL platform persisted or answers: the approval
 * store, the append-only lineage, the finance repositories, the runtime run
 * (over the real operator HTTP surface, joined server-side) and the Audit
 * Center decision trace. Nothing here constructs an expectation or fabricates
 * state; a check that cannot observe its subject FAILS.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type {
  ObservedApproval,
  ObservedCheck,
  ScenarioDefinition,
  StateCheck,
} from '@nexora/evaluation';

import type { ScenarioApp } from './harness.js';

type LifecycleCheck = Extract<
  StateCheck,
  {
    kind:
      'actor_continuity' | 'verification' | 'expense' | 'budget_utilization' | 'workflow_instances';
  }
>;

/** Evaluates one governed-lifecycle check. */
export async function evaluateLifecycleCheck(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  check: LifecycleCheck,
  approvals: readonly ObservedApproval[],
): Promise<ObservedCheck> {
  switch (check.kind) {
    case 'actor_continuity':
      return actorContinuity(harness, scenario, check, approvals);
    case 'verification':
      return verification(harness, check);
    case 'expense':
      return expense(harness, check, approvals);
    case 'budget_utilization':
      return budgetUtilization(harness, check);
    case 'workflow_instances':
      return workflowInstances(harness, check);
  }
}

// ---------------------------------------------------------------------------
// workflow_instances
// ---------------------------------------------------------------------------

/** Stored workflow instances: "could not start" (none) vs "started, then refused" (failed / compensated). */
async function workflowInstances(
  harness: ScenarioApp,
  check: Extract<LifecycleCheck, { kind: 'workflow_instances' }>,
): Promise<ObservedCheck> {
  const organizationId = harness.world.organization(check.organization).id as TenantId;
  const stored = await harness.repos.workflowInstances.listByTenant(organizationId, 500);
  const matched = stored.filter(
    (instance) =>
      (check.definitionKey === undefined || instance.definitionKey === check.definitionKey) &&
      (check.status === undefined || instance.status === check.status) &&
      (check.origin === undefined || instance.origin === check.origin),
  );
  return {
    description: `workflow instances in ${check.organization}${check.definitionKey === undefined ? '' : ` of ${check.definitionKey}`}${check.status === undefined ? '' : ` with status ${check.status}`}${check.origin === undefined ? '' : ` from origin ${check.origin}`} = ${check.equals}`,
    passed: matched.length === check.equals,
    actual: matched.length,
  };
}

// ---------------------------------------------------------------------------
// actor_continuity
// ---------------------------------------------------------------------------

/** The subset of the decision trace / run governance block read here. */
interface ContinuityActors {
  requester?: { userId?: string };
  agent?: { agentId?: string };
  approver?: { userId?: string };
  executor?: { kind?: string; userId?: string; agentId?: string };
  executionAuthority?: string;
}

async function actorContinuity(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  check: Extract<LifecycleCheck, { kind: 'actor_continuity' }>,
  approvals: readonly ObservedApproval[],
): Promise<ObservedCheck> {
  const world = harness.world;
  const description = `actor continuity: requester ${check.requester}${check.agent === undefined ? '' : `, agent ${check.agent}`}${check.approver === undefined ? '' : `, approver ${check.approver}`}, authority ${check.executionAuthority}${check.traceReader === undefined ? '' : ` (trace also read as ${check.traceReader.user})`}`;
  const approvalId = approvals.find((approval) => approval.id !== undefined)?.id;
  if (approvalId === undefined) {
    return { description, passed: false, actual: 'no approval was opened' };
  }
  const organization = world.organization(scenario.organization);
  const requesterId = world.user(check.requester).id;
  const approverId = check.approver === undefined ? undefined : world.user(check.approver).id;
  const agentId = check.agent === undefined ? undefined : world.entityId(check.agent);
  const failures: string[] = [];

  // 1. The approval store.
  const record = await harness.approvals.byId(approvalId);
  if (record === undefined) {
    return { description, passed: false, actual: 'approval not found' };
  }
  if (record.userId !== requesterId) failures.push('approval.userId is not the requester');
  if (approverId === undefined) {
    if (record.decidedBy !== undefined && record.decidedBy !== requesterId)
      failures.push('approval decided by a non-requester although no approver was expected');
  } else {
    if (record.decidedBy !== approverId) failures.push('approval.decidedBy is not the approver');
    if (record.decidedBy === record.userId) failures.push('approver equals requester');
  }
  if ((record.agentId ?? undefined) !== agentId) failures.push('approval.agentId differs');

  // 2. The append-only lineage of the whole organization.
  const lineage = await harness.repos.lineage!.list(organization.id);
  const scoped = lineage.filter((r) => r.approvalId === approvalId);
  const executions = scoped.filter((r) => r.kind === 'EXECUTION');
  if (executions.length === 0) failures.push('lineage has no EXECUTION under the approval');
  for (const execution of executions) {
    if (execution.actorId !== requesterId) failures.push('EXECUTION actorId is not the requester');
    const approvedBy = (execution.data as { approvedBy?: { userId?: string } }).approvedBy;
    if (approverId === undefined) {
      if (approvedBy !== undefined && approvedBy.userId !== requesterId)
        failures.push('EXECUTION names an unexpected approver');
    } else if (approvedBy?.userId !== approverId) {
      failures.push('EXECUTION approvedBy is not the approver');
    }
    if ((execution.agentId ?? undefined) !== agentId) failures.push('EXECUTION agentId differs');
  }
  if (approverId !== undefined) {
    const impersonated = lineage.filter((r) => r.actorId === approverId).length;
    if (impersonated > 0) failures.push(`the approver is the actorId of ${impersonated} record(s)`);
  }

  // 3. The runtime run's governance block over the real operator surface.
  const auditor = organization.auditor;
  const auditScope = `organizationId=${organization.id}&workspaceId=${world.workspace(auditor.workspace).id}`;
  const listed = await harness.request(
    auditor.user,
    'GET',
    `/api/ops/runtime/runs?${auditScope}&approvalId=${approvalId}`,
  );
  const runs =
    listed.statusCode === 200
      ? (
          listed.json() as {
            runs: {
              id: string;
              actorId: string;
              approval?: { state: string; decidedBy?: string };
            }[];
          }
        ).runs
      : [];
  const resumed = runs.find((run) => run.approval?.state === 'resumed');
  if (resumed === undefined) {
    failures.push('no resumed runtime run correlates to the approval');
  } else {
    if (resumed.actorId !== requesterId) failures.push('run.actorId is not the requester');
    if ((resumed.approval?.decidedBy ?? undefined) !== approverId)
      failures.push('run.approval.decidedBy differs');
    const detail = await harness.request(
      auditor.user,
      'GET',
      `/api/ops/runtime/runs/${resumed.id}?${auditScope}`,
    );
    if (detail.statusCode !== 200) {
      failures.push(`run detail HTTP ${detail.statusCode}`);
    } else {
      const governance = (detail.json() as { governance?: { actors?: ContinuityActors } })
        .governance;
      compareActors(
        governance?.actors,
        'run governance',
        check,
        requesterId,
        approverId,
        agentId,
        failures,
      );
    }
  }

  // 4. The Audit decision trace (the auditor, and optionally an independent reader).
  const readers = [
    { user: auditor.user, workspace: auditor.workspace },
    ...(check.traceReader === undefined ? [] : [check.traceReader]),
  ];
  for (const reader of readers) {
    const trace = await harness.request(
      reader.user,
      'GET',
      `/api/audit/events/${encodeURIComponent(`apr:${approvalId}`)}/trace?organizationId=${organization.id}&workspaceId=${world.workspace(reader.workspace).id}`,
    );
    if (trace.statusCode !== 200) {
      failures.push(`trace as ${reader.user}: HTTP ${trace.statusCode}`);
      continue;
    }
    const body = (trace.json() as { trace: { actors?: ContinuityActors } }).trace;
    compareActors(
      body.actors,
      `trace as ${reader.user}`,
      check,
      requesterId,
      approverId,
      agentId,
      failures,
    );
  }

  return {
    description,
    passed: failures.length === 0,
    actual: failures.length === 0 ? 'consistent' : failures.join('; '),
  };
}

function compareActors(
  actors: ContinuityActors | undefined,
  source: string,
  check: Extract<LifecycleCheck, { kind: 'actor_continuity' }>,
  requesterId: string,
  approverId: string | undefined,
  agentId: string | undefined,
  failures: string[],
): void {
  if (actors === undefined) {
    failures.push(`${source}: no actors block`);
    return;
  }
  if (actors.requester?.userId !== requesterId) failures.push(`${source}: requester differs`);
  if ((actors.approver?.userId ?? undefined) !== approverId)
    failures.push(`${source}: approver differs`);
  if ((actors.agent?.agentId ?? undefined) !== agentId) failures.push(`${source}: agent differs`);
  if (actors.executor?.userId !== requesterId)
    failures.push(`${source}: executor is not the requester`);
  if ((actors.executor?.agentId ?? undefined) !== agentId)
    failures.push(`${source}: executor agent differs`);
  if (actors.executor?.kind !== (agentId === undefined ? 'user' : 'agent'))
    failures.push(`${source}: executor kind differs`);
  if (actors.executionAuthority !== check.executionAuthority)
    failures.push(`${source}: execution authority ${actors.executionAuthority ?? 'none'}`);
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

async function verification(
  harness: ScenarioApp,
  check: Extract<LifecycleCheck, { kind: 'verification' }>,
): Promise<ObservedCheck> {
  const organizationId = harness.world.organization(check.organization).id;
  const records = await harness.repos.lineage!.list(organizationId, { kind: 'VERIFICATION' });
  const forTool = records.filter((r) => r.subjectId === check.tool);
  const conforming = forTool.filter((r) => {
    const d = r.data as { verified?: boolean; source?: string; limitation?: string };
    return (
      d.verified === check.verified &&
      d.source === check.source &&
      (check.limitation === undefined ||
        (typeof d.limitation === 'string' && d.limitation.length > 0) === check.limitation)
    );
  });
  const description = `verification of ${check.tool}: verified=${check.verified} source=${check.source}${check.limitation === undefined ? '' : ` limitation=${check.limitation}`}${check.equals === undefined ? ' (every record)' : ` count = ${check.equals}`}`;
  const passed =
    check.equals === undefined
      ? forTool.length > 0 && conforming.length === forTool.length
      : conforming.length === check.equals;
  return {
    description,
    passed,
    actual: `${conforming.length}/${forTool.length} record(s) conform${
      passed
        ? ''
        : ` (seen: ${forTool
            .map((r) => {
              const d = r.data as { verified?: boolean; source?: string };
              return `${String(d.verified)}/${d.source ?? 'none'}`;
            })
            .join(', ')})`
    }`,
  };
}

// ---------------------------------------------------------------------------
// expense / budget_utilization
// ---------------------------------------------------------------------------

async function expense(
  harness: ScenarioApp,
  check: Extract<LifecycleCheck, { kind: 'expense' }>,
  approvals: readonly ObservedApproval[],
): Promise<ObservedCheck> {
  const world = harness.world;
  const stored = await harness.repos.expenses.listByWorkspace(
    world.organization(check.organization).id as TenantId,
    world.workspace(check.workspace).id as WorkspaceId,
  );
  let approvedAmount: number | undefined;
  if (check.matchesApprovedInput === true) {
    const approvalId = approvals.find((approval) => approval.id !== undefined)?.id;
    const record = approvalId === undefined ? undefined : await harness.approvals.byId(approvalId);
    const amount = (record?.input as { amountMinorUnits?: unknown } | undefined)?.amountMinorUnits;
    approvedAmount = typeof amount === 'number' ? amount : undefined;
  }
  const matched = stored.filter(
    (e) =>
      (check.description === undefined || e.description.value === check.description) &&
      (check.status === undefined ||
        e.status.value === (check.status === 'submitted' ? 'pending' : check.status)) &&
      (check.amountMinorUnits === undefined || e.amount.minorUnits === check.amountMinorUnits) &&
      (check.matchesApprovedInput !== true ||
        (approvedAmount !== undefined && e.amount.minorUnits === approvedAmount)) &&
      (check.submittedBy === undefined || e.submittedBy === world.user(check.submittedBy).id) &&
      (check.decidedBy === undefined || e.decidedBy === world.user(check.decidedBy).id),
  );
  const attrs = Object.entries(check)
    .filter(
      ([key, value]) =>
        !['kind', 'organization', 'workspace', 'equals'].includes(key) && value !== undefined,
    )
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  return {
    description: `expenses in ${check.organization}/${check.workspace} [${attrs}] count = ${check.equals}`,
    passed: matched.length === check.equals,
    actual: matched.length,
  };
}

/** The approved-expense total the world SEEDS against a budget (the utilization baseline). */
function seededSpent(harness: ScenarioApp, budgetKey: string): number {
  return harness.world.world.entities
    .filter(
      (entity) =>
        entity.kind === 'expense' && entity.budget === budgetKey && entity.status === 'approved',
    )
    .reduce((sum, entity) => sum + (entity.kind === 'expense' ? entity.amountMinorUnits : 0), 0);
}

async function budgetUtilization(
  harness: ScenarioApp,
  check: Extract<LifecycleCheck, { kind: 'budget_utilization' }>,
): Promise<ObservedCheck> {
  const world = harness.world;
  const budget = world.entity(check.budget);
  const description = `budget ${check.budget} utilization changed by ${check.spentDeltaMinorUnits} minor units`;
  if (budget.kind !== 'budget') return { description, passed: false, actual: 'not a budget' };
  const organization = world.organization(budget.organization);
  const workspace = world.workspace(budget.workspace);
  // Read as the budget's creator over the REAL utilization route (the same
  // projection the dashboard and detection use).
  const response = await harness.request(
    budget.createdBy,
    'GET',
    `/api/finance/budgets/utilization?organizationId=${organization.id}&workspaceId=${workspace.id}`,
  );
  if (response.statusCode !== 200) {
    return { description, passed: false, actual: `HTTP ${response.statusCode}` };
  }
  const entry = (
    response.json() as { utilization: { budgetId: string; spentMinorUnits: number }[] }
  ).utilization.find((row) => row.budgetId === budget.id);
  if (entry === undefined) return { description, passed: false, actual: 'budget not listed' };
  const delta = entry.spentMinorUnits - seededSpent(harness, check.budget);
  return {
    description,
    passed: delta === check.spentDeltaMinorUnits,
    actual: `delta ${delta} (spent ${entry.spentMinorUnits})`,
  };
}
