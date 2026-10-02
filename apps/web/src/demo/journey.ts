/**
 * @nexora/app-web — the Guided Demo stage model (pure).
 *
 * The 15 stages of the story are DERIVED from facts read back from the
 * backend (approval engine, workflow read model, HR/project/finance records,
 * audit, runtime). Nothing here is set by a click: a stage is `done` only when
 * the persisted fact that proves it has been read, and the honest non-success
 * states (waiting, rejected, expired, failed, compensated, completed but not
 * independently verified) are represented, never smoothed over.
 *
 * This module has no I/O and no React — `deriveStages` is a function of the
 * facts and the persona of the CURRENT backend session.
 */

import type { ApprovalStateDto } from '../lib/demo.js';
import type { WorkflowStateKey } from '../lib/types.js';

export type PersonaKey = 'ceo' | 'manager' | 'controller' | 'cfo';

/** The people who act in the guided story (the rest of the office only explores the product). */
export const STORY_PERSONAS: readonly PersonaKey[] = ['ceo', 'manager', 'controller', 'cfo'];

/** Whether a demo person takes part in the guided story. */
export function isStoryPersona(key: string): key is PersonaKey {
  return (STORY_PERSONAS as readonly string[]).includes(key);
}

export type StageStatus = 'pending' | 'active' | 'done' | 'failed';

/** A fact together with the persona whose (real) session read it. */
export interface Observed<T> {
  value: T;
  observedAs: PersonaKey;
}

/** The result of the CEO's real attempt to approve their own request. */
export interface SelfApprovalAttempt {
  /** The HTTP status the backend answered. */
  httpStatus: number;
  /** The backend's error code (e.g. `AUTHORIZATION_ERROR`). */
  code: string;
  message: string;
}

/** What the hire workflow's persisted instance reports. */
export interface WorkflowFact {
  state: WorkflowStateKey;
  stateDetail?: string;
  rollbackSummary?: string;
  verification?: { status: string; countedSteps: number; verifiedSteps: number };
}

/** What the finance records report. */
export interface ExpenseFact {
  id: string;
  status: string;
  amountMinorUnits: number;
  currency: string;
  description: string;
  decidedBy?: string;
}

export interface UtilizationFact {
  budgetId: string;
  name: string;
  currency: string;
  allocatedMinorUnits: number;
  spentMinorUnits: number;
  utilizationPercent: number;
}

/** Everything the story knows, each item read from the backend. */
export interface JourneyFacts {
  hire: {
    approval?: Observed<ApprovalStateDto>;
    workflow?: Observed<WorkflowFact>;
    /** The hired employee, found by name in the employee registry. */
    employee?: Observed<{ id: string; name: string; status: string }>;
    /** The project team as read from GET /projects/:id/members. */
    members?: Observed<{ employeeName: string | null; assignedAt: string }[]>;
    /** The team as read with the TEAM MANAGER's own session (proves stage 9). */
    managerMembers?: Observed<{ employeeName: string | null; assignedAt: string }[]>;
    selfApproval?: SelfApprovalAttempt;
    /** The name the story hires (from the server-published request). */
    employeeName: string;
  };
  finance: {
    approval?: Observed<ApprovalStateDto>;
    expense?: Observed<ExpenseFact>;
    /** Budget utilization the first time the expense was seen pending (the baseline). */
    utilizationBefore?: Observed<UtilizationFact>;
    utilizationNow?: Observed<UtilizationFact>;
    selfApproval?: SelfApprovalAttempt;
  };
  trace: {
    /** The decision trace of the hire approval was loaded by an audit-capable persona. */
    hireTrace?: Observed<{ executions: number; verifiedExecutions: number; approverName?: string }>;
    /** Audit events read by an audit-capable persona. */
    auditActions?: Observed<readonly string[]>;
    /** The runtime run of the hire request. */
    runtimeRun?: Observed<{ runId: string; status: string }>;
  };
}

/** One stage of the Guided Demo. */
export interface Stage {
  id: string;
  index: number;
  title: string;
  /** The persona who acts in this stage (`system` for the platform itself). */
  actor: PersonaKey | 'system';
  status: StageStatus;
  /** One truthful sentence about where this stage stands. */
  headline: string;
  /** Backend-derived evidence lines (never invented). */
  evidence: string[];
  /** Set when the stage is waiting on someone specific. */
  waitingFor?: PersonaKey;
  /** A non-success-but-complete nuance (e.g. completed but not independently verified). */
  caution?: string;
}

function money(minorUnits: number, currency: string): string {
  return `${currency} ${(minorUnits / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Whether an approval was granted (executed or executing afterwards is still granted). */
function granted(approval: ApprovalStateDto): boolean {
  return approval.decision === 'grant';
}

type Decision = {
  status: StageStatus;
  headline: string;
  evidence: string[];
  waitingFor?: PersonaKey;
};

/** The stage state of "someone else decides this approval". */
function decisionStage(
  approval: ApprovalStateDto | undefined,
  approver: PersonaKey,
  approverLabel: string,
): Decision {
  if (approval === undefined) {
    return { status: 'pending', headline: 'No approval has been requested yet.', evidence: [] };
  }
  const evidence: string[] = [`Approval status: ${approval.status.replace(/_/g, ' ')}`];
  if (approval.status === 'awaiting_approval') {
    return {
      status: 'active',
      headline: `Waiting for ${approverLabel} to decide.`,
      evidence,
      waitingFor: approver,
    };
  }
  if (approval.status === 'expired') {
    return { status: 'failed', headline: 'The approval expired before anyone decided.', evidence };
  }
  if (approval.decision === 'reject' || approval.status === 'rejected') {
    if (approval.decidedByName !== undefined)
      evidence.push(`Rejected by ${approval.decidedByName}`);
    return {
      status: 'failed',
      headline: 'The approval was rejected — nothing was executed.',
      evidence,
    };
  }
  if (granted(approval)) {
    if (approval.decidedByName !== undefined) {
      evidence.push(`Decided by ${approval.decidedByName}`);
    }
    if (approval.decidedById !== undefined && approval.decidedById !== approval.requesterId) {
      evidence.push('The decider is a different person from the requester');
    }
    return { status: 'done', headline: 'Approved by a different person.', evidence };
  }
  return { status: 'active', headline: `Approval is ${approval.status}.`, evidence };
}

/** Derives the 15 stages from the facts and the persona of the current session. */
export function deriveStages(facts: JourneyFacts, current: PersonaKey | null): Stage[] {
  const hire = facts.hire;
  const fin = facts.finance;
  const approval = hire.approval?.value;
  const workflow = hire.workflow?.value;
  const finApproval = fin.approval?.value;
  const expense = fin.expense?.value;

  const stages: Stage[] = [];
  const add = (
    id: string,
    title: string,
    actor: Stage['actor'],
    d: Decision & { caution?: string },
  ): void => {
    stages.push({ id, index: stages.length + 1, title, actor, ...d });
  };

  // 1. CEO requests the hire.
  add('ceo-request', 'CEO requests a hire', 'ceo', {
    status: approval === undefined ? 'active' : 'done',
    headline:
      approval === undefined
        ? current === 'ceo'
          ? 'Ready — send the request as the CEO.'
          : 'Sign in as the CEO to send the request.'
        : `Requested by ${approval.requesterName ?? 'the CEO'}.`,
    evidence: approval === undefined ? [] : [`Recorded at ${approval.createdAt}`],
  });

  // 2. AI interprets the request.
  add('ai-understands', 'AI understands the request', 'system', {
    status: approval?.intent === undefined ? 'pending' : 'done',
    headline:
      approval?.intent === undefined
        ? 'Waiting for a request.'
        : 'The request was interpreted into a governed plan.',
    evidence: approval?.intent === undefined ? [] : [`Intent: ${approval.intent}`],
  });

  // 3. Governed plan (a plan is not proof anything ran).
  add('governed-plan', 'Governed plan', 'system', {
    status: approval === undefined ? 'pending' : 'done',
    headline:
      approval === undefined
        ? 'Waiting for a request.'
        : 'One governed action was planned. A plan is not execution.',
    evidence:
      approval === undefined
        ? []
        : [
            `Capability: ${approval.capabilityId}`,
            ...(approval.policy === undefined
              ? []
              : [`Policy ${approval.policy.policyId}: ${approval.policy.outcome}`]),
            `Reason: ${approval.reason}`,
          ],
  });

  // 4. Approval required; the CEO cannot self-approve.
  const selfRefusal = hire.selfApproval;
  add('approval-required', 'Approval required', 'system', {
    status: approval === undefined ? 'pending' : 'done',
    headline:
      approval === undefined
        ? 'Waiting for a request.'
        : 'Held for a human decision. The requester cannot approve their own request.',
    evidence: [
      ...(approval?.requiredApproverRoleId === undefined
        ? []
        : [`Required approver role: ${approval.requiredApproverRoleId}`]),
      ...(approval === undefined
        ? []
        : [`Separation of duties: ${approval.separationOfDuties ? 'on' : 'off'}`]),
      ...(selfRefusal === undefined
        ? []
        : [
            `CEO self-approval attempt refused by the backend (HTTP ${selfRefusal.httpStatus} ${selfRefusal.code})`,
          ]),
    ],
  });

  // 5. Team Manager decides.
  add(
    'manager-approval',
    'Team Manager approval',
    'manager',
    decisionStage(approval, 'manager', 'the Team Manager'),
  );

  // 6. Employee created (from the registry, not from the approval).
  const wfBroken =
    workflow !== undefined &&
    (workflow.state === 'failed' ||
      workflow.state === 'compensated' ||
      workflow.state === 'partial');
  const employee = hire.employee?.value;
  add('employee-created', 'Employee created', 'system', {
    status:
      employee !== undefined
        ? 'done'
        : wfBroken
          ? 'failed'
          : approval !== undefined && granted(approval)
            ? 'active'
            : 'pending',
    headline:
      employee !== undefined
        ? `${employee.name} exists in the employee registry.`
        : wfBroken
          ? `The hire did not complete (${workflow.state.replace(/_/g, ' ')}).`
          : approval !== undefined && granted(approval)
            ? 'Approved — waiting for the workflow to create the employee.'
            : 'Waiting for the approval.',
    evidence: [
      ...(employee === undefined ? [] : [`Employee status: ${employee.status}`]),
      ...(workflow === undefined ? [] : [`Workflow state: ${workflow.state.replace(/_/g, ' ')}`]),
      ...(workflow?.rollbackSummary === undefined ? [] : [workflow.rollbackSummary]),
    ],
  });

  // 7. Verification, exactly as the workflow read model states it.
  const verification = workflow?.verification;
  const verified = verification?.status === 'verified' || workflow?.state === 'verified';
  const unverified =
    workflow?.state === 'completed_unverified' ||
    verification?.status === 'not_independently_verified';
  add('verification', 'Verification', 'system', {
    status: verified || unverified ? 'done' : wfBroken ? 'failed' : 'pending',
    headline: verified
      ? 'The result was independently read back and verified.'
      : unverified
        ? 'Completed, but not independently verified.'
        : wfBroken
          ? 'Nothing to verify — the workflow did not complete.'
          : 'Waiting for the workflow to finish.',
    evidence:
      verification === undefined
        ? []
        : [`Verified steps: ${verification.verifiedSteps} of ${verification.countedSteps}`],
    ...(unverified && !verified
      ? {
          caution: 'Nexora reports this honestly: the step result is self-reported, not read back.',
        }
      : {}),
  });

  // 8. Project assignment (the read-back of the team).
  const members = hire.members?.value;
  const assigned =
    members !== undefined && members.some((member) => member.employeeName === hire.employeeName);
  add('project-assigned', 'Project assignment', 'system', {
    status: assigned ? 'done' : wfBroken ? 'failed' : employee !== undefined ? 'active' : 'pending',
    headline: assigned
      ? `${hire.employeeName} is a member of the project team.`
      : employee !== undefined
        ? 'Waiting for the assignment to be read back.'
        : 'Waiting for the employee.',
    evidence: assigned ? ['Read from the project membership records'] : [],
  });

  // 9. The Team Manager sees the relationship — observed with the manager's own session.
  const seenByManager =
    hire.managerMembers !== undefined &&
    hire.managerMembers.value.some((member) => member.employeeName === hire.employeeName);
  add('manager-views-project', 'Team Manager opens the project', 'manager', {
    status: seenByManager ? 'done' : assigned ? 'active' : 'pending',
    headline: seenByManager
      ? `The Team Manager can see ${hire.employeeName} on the project.`
      : assigned
        ? current === 'manager'
          ? 'Open the project as the Team Manager.'
          : 'Switch to the Team Manager to see the project team.'
        : 'Waiting for the assignment.',
    evidence: seenByManager
      ? ['Read with the Team Manager’s own session (project members endpoint)']
      : [],
    ...(assigned && !seenByManager ? { waitingFor: 'manager' as const } : {}),
  });

  // 10. Finance Controller submits an expense for governed approval.
  add('expense-submitted', 'Controller submits an expense', 'controller', {
    status:
      finApproval === undefined && expense === undefined
        ? seenByManager
          ? 'active'
          : 'pending'
        : 'done',
    headline:
      finApproval === undefined && expense === undefined
        ? current === 'controller'
          ? 'Ready — submit the expense as the Finance Controller.'
          : 'Switch to the Finance Controller to submit the expense.'
        : 'An expense submission was raised for approval.',
    evidence: [
      ...(finApproval === undefined ? [] : [`Capability: ${finApproval.capabilityId}`]),
      ...(finApproval?.requiredApproverRoleId === undefined
        ? []
        : [`Required approver role: ${finApproval.requiredApproverRoleId}`]),
    ],
  });

  // 11. CFO approves.
  const finDecision = decisionStage(finApproval, 'cfo', 'the CFO');
  if (fin.selfApproval !== undefined) {
    finDecision.evidence.push(
      `Controller self-approval attempt refused by the backend (HTTP ${fin.selfApproval.httpStatus} ${fin.selfApproval.code})`,
    );
  }
  add('cfo-approval', 'CFO approval', 'cfo', finDecision);

  // 12. The real finance decision moves utilization.
  const before = fin.utilizationBefore?.value;
  const now = fin.utilizationNow?.value;
  const expenseDone = expense?.status === 'approved';
  const expenseRejected = expense?.status === 'rejected';
  add('finance-decision', 'Expense decision and budget utilization', 'cfo', {
    status: expenseDone
      ? 'done'
      : expenseRejected
        ? 'failed'
        : expense !== undefined
          ? 'active'
          : 'pending',
    headline: expenseDone
      ? 'The expense was approved through the finance flow.'
      : expenseRejected
        ? 'The expense was rejected — it does not count against the budget.'
        : expense !== undefined
          ? 'The expense is pending its decision.'
          : 'Waiting for the expense submission.',
    evidence: [
      ...(expense === undefined
        ? []
        : [`Expense ${money(expense.amountMinorUnits, expense.currency)}: ${expense.status}`]),
      ...(before === undefined || now === undefined
        ? now === undefined
          ? []
          : [
              `Budget utilization now: ${now.utilizationPercent}% (${money(now.spentMinorUnits, now.currency)} of ${money(now.allocatedMinorUnits, now.currency)})`,
            ]
        : [
            `Budget utilization: ${before.utilizationPercent}% → ${now.utilizationPercent}% (${money(now.spentMinorUnits, now.currency)} of ${money(now.allocatedMinorUnits, now.currency)})`,
          ]),
    ],
    ...(expenseDone &&
    before !== undefined &&
    now !== undefined &&
    now.spentMinorUnits === before.spentMinorUnits
      ? { caution: 'Utilization has not changed since the baseline was read.' }
      : {}),
  });

  // 13. Decision Trace (audit-capable persona).
  // A trace/audit/runtime record of a still-PENDING request proves nothing about
  // the story's outcome: these stages count only once the hire AND the expense were decided (the story's order).
  const hireDecided =
    approval !== undefined && granted(approval) && (expenseDone || expenseRejected);
  const trace = hireDecided ? facts.trace.hireTrace?.value : undefined;
  add('decision-trace', 'Decision Trace', 'ceo', {
    status: trace !== undefined ? 'done' : expenseDone || expenseRejected ? 'active' : 'pending',
    headline:
      trace !== undefined
        ? 'The trace reconstructs who requested, who approved and who executed.'
        : 'Open the trace as the CEO (the audit-capable persona).',
    evidence:
      trace === undefined
        ? []
        : [
            `Recorded executions: ${trace.executions} (verified: ${trace.verifiedExecutions})`,
            ...(trace.approverName === undefined ? [] : [`Approver: ${trace.approverName}`]),
          ],
  });

  // 14. Audit Center shows governance events.
  const actions = hireDecided ? (facts.trace.auditActions?.value ?? []) : [];
  const auditDone = actions.length > 0 && actions.some((a) => /approv/i.test(a));
  add('audit', 'Audit Center', 'ceo', {
    status: auditDone ? 'done' : trace !== undefined ? 'active' : 'pending',
    headline: auditDone
      ? 'The governance events are recorded in the Audit Center.'
      : 'Open the Audit Center as the CEO.',
    evidence: auditDone ? [`Events read: ${actions.length}`] : [],
  });

  // 15. Runtime runs telemetry.
  const runtime = hireDecided ? facts.trace.runtimeRun?.value : undefined;
  add('runtime', 'Runtime Runs', 'ceo', {
    status: runtime !== undefined ? 'done' : auditDone ? 'active' : 'pending',
    headline:
      runtime !== undefined
        ? 'The run is recorded with its model, tool and governance telemetry.'
        : 'Open Runtime Runs as the CEO.',
    evidence: runtime === undefined ? [] : [`Run status: ${runtime.status}`],
  });

  return stages;
}

/** The index of the first stage that is not done (the current stage), or -1 when all are done. */
export function currentStageIndex(stages: readonly Stage[]): number {
  return stages.findIndex((stage) => stage.status !== 'done');
}

export const EMPTY_FACTS = (employeeName: string): JourneyFacts => ({
  hire: { employeeName },
  finance: {},
  trace: {},
});

/**
 * Merges freshly read facts over previously observed ones. A fact the CURRENT
 * persona cannot read (a 403 yields no fact) keeps the value an earlier persona
 * genuinely read — it is a memory of a backend read, tagged with who observed
 * it, and is replaced the moment any persona can read it again.
 */
export function mergeFacts(previous: JourneyFacts | undefined, next: JourneyFacts): JourneyFacts {
  if (previous === undefined) return next;
  const pick = <T>(fresh: T | undefined, old: T | undefined): T | undefined => fresh ?? old;
  return {
    hire: {
      employeeName: next.hire.employeeName,
      approval: pick(next.hire.approval, previous.hire.approval),
      workflow: pick(next.hire.workflow, previous.hire.workflow),
      employee: pick(next.hire.employee, previous.hire.employee),
      members: pick(next.hire.members, previous.hire.members),
      managerMembers: pick(next.hire.managerMembers, previous.hire.managerMembers),
      selfApproval: pick(next.hire.selfApproval, previous.hire.selfApproval),
    },
    finance: {
      approval: pick(next.finance.approval, previous.finance.approval),
      expense: pick(next.finance.expense, previous.finance.expense),
      utilizationBefore: pick(next.finance.utilizationBefore, previous.finance.utilizationBefore),
      utilizationNow: pick(next.finance.utilizationNow, previous.finance.utilizationNow),
      selfApproval: pick(next.finance.selfApproval, previous.finance.selfApproval),
    },
    // Trace / audit / runtime are NOT remembered: they count only while an
    // audit-capable persona is actually reading them.
    trace: next.trace,
  };
}
