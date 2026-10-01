/**
 * @nexora/evaluation — workflow decision-trace closure scenarios
 * (NXS-205 … NXS-210).
 *
 * The principle under test: the Audit Center's decision trace of a workflow
 * event tells the WHOLE truth. A step that executed stays `succeeded` — a later
 * failure and rollback are recorded as a later state, never as a rewritten
 * failure — and the trace names the instance's final state (COMPENSATED /
 * PARTIAL / verified), so an operator reads: Step A executed; Step B failed;
 * compensation executed; final state COMPENSATED. For a composite unit
 * approval the trace also says who AUTHORIZED the composite and who EXECUTED
 * it: the approver authorized the unit, its inner steps ran under the workflow
 * instance within the requester's ceiling, and the approver never executed.
 *
 * Every scenario drives a real approval + workflow execution over seeded data
 * and reads the trace back over the real Audit Center HTTP route (as the
 * organization's auditor) — never a constructed trace.
 *
 * Personas: meera = CEO (requester), vikram = delivery manager (the distinct
 * approver under separation of duties).
 */

import { extendWorld, type WorldBuilder } from '../factories.js';
import type {
  ScenarioDefinition,
  ScenarioExpectations,
  ScenarioWorld,
  StateCheck,
} from '../scenario.js';

const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';
const TAGS = ['lifecycle', 'workflow', 'decision-trace', 'audit'] as const;
const COMPOSITE = 'workflow.hire_and_assign_employee';
const PARTIAL_COMPOSITE = 'workflow.create_project_and_assign_employee';
/** The unit approval is separated from its requester (the inner steps are not held to it — see NXS-148). */
const UNIT_SOD = [{ capabilityPrefix: 'workflow.', separationOfDuties: true }];
const HIRE = 'Hire Sarah Thomas and assign her to the Mobile Banking Platform project';
const HIRE_FAILING = 'Hire Rohan Das and assign him to the Quantum Ledger project';
const PARTIAL_REQUEST = 'Create a project called Payments Hub and assign Nobody Existing to it';
const HR_CAPABILITIES = [
  COMPOSITE,
  'hr.create_employee',
  'projects.find_project',
  'projects.assign_employee',
] as const;

function expectations(
  partial: Partial<ScenarioExpectations> & Pick<ScenarioExpectations, 'intent'>,
): ScenarioExpectations {
  return {
    authorization: { outcome: 'allowed' },
    tools: { expected: [], forbidden: [] },
    approval: { required: false },
    execution: { outcome: 'not_executed' },
    verification: { outcome: 'not_applicable', checks: [] },
    audit: { required: [], forbidden: [] },
    ...partial,
  };
}

/** A composite workflow that was approved and run. */
function composite(
  capability: string,
  outcome: 'succeeded' | 'failed',
  checks: readonly StateCheck[],
): ScenarioExpectations {
  return expectations({
    intent: { kind: 'workflow', capability },
    tools: { expected: [capability], forbidden: [] },
    approval: { required: true, sideEffectClass: 'consequential' },
    execution: { outcome },
    verification: { outcome: 'verified', checks },
  });
}

/** The forward steps of the hire workflow that ran and are NOT rolled back or failed. */
const HIRE_STEPS_EXECUTED = [
  { tool: 'hr.create_employee', purpose: 'step', status: 'succeeded', laterState: 'none' },
  { tool: 'projects.find_project', purpose: 'step', status: 'succeeded', laterState: 'none' },
  { tool: 'projects.assign_employee', purpose: 'step', status: 'succeeded', laterState: 'none' },
] as const;

/** The compensated hire: A executed then undone, B failed, the compensation executed. */
const COMPENSATED_WORKFLOW = {
  state: 'compensated',
  steps: [
    {
      tool: 'hr.create_employee',
      purpose: 'step',
      status: 'succeeded',
      laterState: 'compensated',
    },
    { tool: 'projects.find_project', purpose: 'step', status: 'succeeded', laterState: 'none' },
    { tool: 'projects.assign_employee', purpose: 'step', status: 'failed' },
    { tool: 'hr.revoke_hire', purpose: 'compensation', status: 'succeeded' },
  ],
  // Only the step that truly failed is reported failed — the executed step is never re-labelled.
  failedOnly: ['projects.assign_employee'],
  noteIncludes: ['compensation executed for', 'Final workflow state: COMPENSATED.'],
  rollbackSummary: true,
} as const satisfies NonNullable<Extract<StateCheck, { kind: 'audit_trace' }>['workflow']>;

/** The employee record is retained (offboarded), never deleted. */
const EMPLOYEE_RETAINED: readonly StateCheck[] = [
  {
    kind: 'count',
    entity: 'employee',
    organization: 'aurora',
    named: 'Rohan Das',
    statusNot: ['offboarded', 'cancelled'],
    equals: 0,
  },
  { kind: 'count', entity: 'employee', organization: 'aurora', named: 'Rohan Das', equals: 1 },
];

/** Separation of duties for the unit approval only. */
function sodWorld(base: ScenarioWorld, id: string): ScenarioWorld {
  return extendWorld(base, id, (w: WorldBuilder) =>
    w.policy('sod', {
      organization: 'aurora',
      policyId: AUTHORITY,
      config: { rules: UNIT_SOD },
      createdBy: 'meera',
    }),
  );
}

/** The HR agent of Engineering, delegated the composite and its inner steps, under unit SoD. */
function hrAgentWorld(base: ScenarioWorld, id: string): ScenarioWorld {
  return extendWorld(base, id, (w: WorldBuilder) => {
    let out = w.agent('hr-agent', {
      organization: 'aurora',
      workspace: 'aurora-eng',
      definition: 'hr',
      name: 'HR Assistant',
      owner: 'meera',
      status: 'active',
    });
    for (const capability of HR_CAPABILITIES) {
      out = out.delegation(`d-${capability}`, {
        agent: 'hr-agent',
        grantedBy: 'meera',
        capability,
      });
    }
    return out.policy('sod', {
      organization: 'aurora',
      policyId: AUTHORITY,
      config: { rules: UNIT_SOD },
      createdBy: 'meera',
    });
  });
}

/** Builds the workflow decision-trace closure scenarios. */
export function buildTraceClosureScenariosV1(base: ScenarioWorld): ScenarioDefinition[] {
  return [
    // -----------------------------------------------------------------------
    {
      id: 'NXS-205',
      revision: 1,
      title: 'A compensated workflow reads as executed, failed, compensated — not as a success',
      category: 'governed_lifecycle',
      domain: 'people',
      description:
        'The hire-and-assign workflow fails at its last step (the project does not exist) and rolls the hire back. The Audit decision trace of the approval names the instance state COMPENSATED and lays the timeline out honestly: the hire step EXECUTED (its own status stays succeeded, with a later-state reference to its compensation), the assignment FAILED, and the compensation EXECUTED as its own step. No executed step is re-labelled failed, and the employee record is retained, not deleted.',
      tags: [...TAGS, 'compensation', 'trace-semantics'],
      world: base,
      organization: 'aurora',
      workspace: 'aurora-eng',
      request: {
        channel: 'chat',
        actor: 'meera',
        organization: 'aurora',
        workspace: 'aurora-eng',
        message: HIRE_FAILING,
        decision: { decision: 'approve', actor: 'meera' },
      },
      expected: composite(COMPOSITE, 'failed', [
        {
          kind: 'audit_trace',
          organization: 'aurora',
          requires: ['request', 'approval', 'planned', 'executions', 'lineage'],
          workflow: COMPENSATED_WORKFLOW,
        },
        ...EMPLOYEE_RETAINED,
      ]),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-206',
      revision: 1,
      title:
        'The trace of a workflow step event names the instance it belongs to and its final state',
      category: 'governed_lifecycle',
      domain: 'people',
      description:
        'The same failing hire, but the operator opens the trace from a journaled workflow STEP event (wfs:), not from the approval. The step trace carries the same instance state (COMPENSATED) and timeline — the earlier executed step is not shown as a bare success with the outcome missing.',
      tags: [...TAGS, 'compensation', 'workflow-step'],
      world: base,
      organization: 'aurora',
      workspace: 'aurora-eng',
      request: {
        channel: 'chat',
        actor: 'meera',
        organization: 'aurora',
        workspace: 'aurora-eng',
        message: HIRE_FAILING,
        decision: { decision: 'approve', actor: 'meera' },
      },
      expected: composite(COMPOSITE, 'failed', [
        {
          kind: 'audit_trace',
          organization: 'aurora',
          event: 'workflow_step',
          requires: ['executions', 'lineage'],
          workflow: COMPENSATED_WORKFLOW,
        },
        ...EMPLOYEE_RETAINED,
      ]),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-207',
      revision: 1,
      title: 'A partial workflow reads as PARTIAL: the executed step was left behind',
      category: 'governed_lifecycle',
      domain: 'projects',
      description:
        'Create-a-project-and-assign fails at the assignment (the employee does not exist) and has no safe undo for the project. The trace reports PARTIAL with a rollback statement, the project-creation step is shown as executed and NOT rolled back, no compensation step is invented, and the workflow is never described as completed.',
      tags: [...TAGS, 'partial', 'trace-semantics'],
      world: base,
      organization: 'aurora',
      workspace: 'aurora-eng',
      request: {
        channel: 'chat',
        actor: 'meera',
        organization: 'aurora',
        workspace: 'aurora-eng',
        message: PARTIAL_REQUEST,
        decision: { decision: 'approve', actor: 'meera' },
      },
      expected: composite(PARTIAL_COMPOSITE, 'failed', [
        {
          kind: 'audit_trace',
          organization: 'aurora',
          requires: ['approval', 'executions'],
          workflow: {
            state: 'partial',
            steps: [
              {
                tool: 'projects.create_project',
                purpose: 'step',
                status: 'succeeded',
                laterState: 'not_rolled_back',
              },
              { tool: 'projects.assign_employee', purpose: 'step', status: 'failed' },
            ],
            failedOnly: ['projects.assign_employee'],
            noteIncludes: ['Final workflow state: PARTIAL.'],
            rollbackSummary: true,
          },
        },
        {
          kind: 'lineage',
          organization: 'aurora',
          record: 'EXECUTION',
          purpose: 'compensation',
          equals: 0,
        },
      ]),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-208',
      revision: 1,
      title: 'A composite approval authorized the unit — the approver executed none of its steps',
      category: 'governed_lifecycle',
      domain: 'people',
      description:
        'Separation of duties applies to the unit approval: the delivery manager approves the CEO\'s hire-and-assign workflow. The trace states the approval scope (composite_workflow), names the approver as having authorized the composite, records that its inner steps ran under the workflow instance within the requester\'s ceiling, and shows the approver executed NO step. Every inner execution references the unit approval, labelled "authorized the composite" — never as the executor, and never flagged as an input mismatch.',
      tags: [...TAGS, 'approval', 'actor-continuity', 'composite'],
      world: sodWorld(base, 'NXS-208'),
      organization: 'aurora',
      workspace: 'aurora-eng',
      request: {
        channel: 'chat',
        actor: 'meera',
        organization: 'aurora',
        workspace: 'aurora-eng',
        message: HIRE,
        decision: { decision: 'approve', actor: 'vikram' },
      },
      expected: composite(COMPOSITE, 'succeeded', [
        {
          kind: 'audit_trace',
          organization: 'aurora',
          requires: ['approval', 'executions'],
          composite: { requester: 'meera', approver: 'vikram' },
        },
        { kind: 'approval', status: 'completed', decidedBy: 'vikram', separationOfDuties: true },
        {
          kind: 'count',
          entity: 'employee',
          organization: 'aurora',
          named: 'Sarah Thomas',
          equals: 1,
        },
      ]),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-209',
      revision: 1,
      title: 'A succeeded composite reads as executed with no rollback wording',
      category: 'governed_lifecycle',
      domain: 'people',
      description:
        'Control for the compensated and partial traces: the same hire succeeds. Read from a workflow step event, the trace reports a completed state (never COMPENSATED / PARTIAL), every step executed with no later state, no compensation step and no rollback statement — the additions do not change what a healthy workflow trace says.',
      tags: [...TAGS, 'happy-path', 'workflow-step'],
      world: base,
      organization: 'aurora',
      workspace: 'aurora-eng',
      request: {
        channel: 'chat',
        actor: 'meera',
        organization: 'aurora',
        workspace: 'aurora-eng',
        message: HIRE,
        decision: { decision: 'approve', actor: 'meera' },
      },
      expected: composite(COMPOSITE, 'succeeded', [
        {
          kind: 'audit_trace',
          organization: 'aurora',
          event: 'workflow_step',
          requires: ['executions', 'verification'],
          workflow: {
            state: 'verified',
            steps: HIRE_STEPS_EXECUTED,
            failedOnly: [],
            rollbackSummary: false,
          },
        },
        {
          kind: 'lineage',
          organization: 'aurora',
          record: 'EXECUTION',
          purpose: 'compensation',
          equals: 0,
        },
      ]),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-210',
      revision: 1,
      title:
        'Requester, agent and approver stay three distinct principals across a composite trace',
      category: 'governed_lifecycle',
      domain: 'people',
      description:
        'The CEO runs the HR agent, which holds the composite and its inner steps by delegation; the delivery manager approves the unit under separation of duties. The trace names the requester as the actor, the agent as the executor acting for them and the delivery manager only as the approver of the composite — the approver is never the executor — and the workflow ended in a completed state.',
      tags: [...TAGS, 'agent', 'actor-continuity', 'composite'],
      world: hrAgentWorld(base, 'NXS-210'),
      organization: 'aurora',
      workspace: 'aurora-eng',
      request: {
        channel: 'agent',
        actor: 'meera',
        organization: 'aurora',
        workspace: 'aurora-eng',
        agent: 'hr-agent',
        utterance: HIRE,
        decision: { decision: 'approve', actor: 'vikram' },
      },
      expected: composite(COMPOSITE, 'succeeded', [
        {
          kind: 'audit_trace',
          organization: 'aurora',
          requires: ['approval', 'executions'],
          composite: { requester: 'meera', approver: 'vikram', agent: 'hr-agent' },
          workflow: { state: 'verified', steps: HIRE_STEPS_EXECUTED, failedOnly: [] },
        },
        {
          kind: 'count',
          entity: 'employee',
          organization: 'aurora',
          named: 'Sarah Thomas',
          equals: 1,
        },
      ]),
    },
  ];
}
