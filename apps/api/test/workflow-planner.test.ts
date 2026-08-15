/**
 * S24 Phase 4 — capability-aware workflow proposal gating unit tests.
 *
 * The workflow detector is keyword-driven (create + project + assign /
 * hire + assign + project), so it must consult the caller's TRUSTED business
 * capability affinity before producing an executable workflow proposal: a
 * role WITHOUT `workflows.execute` (e.g. Developer) never gets an executable
 * workflow step, and the approval system is never used to grant a capability
 * the role does not possess. An absent/empty affinity (unmapped role) keeps
 * the current unrestricted behavior — matching discovery's safe default.
 */

import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '@nexora/contracts/workflow';

import {
  createWorkflowProposalDetector,
  defaultWorkflowPlannerSpecs,
  WORKFLOW_CAPABILITY_ID,
} from '../src/ai/workflow-planner.js';

/** Builds a minimal valid workflow definition (the detector reads `definition.steps`). */
function definition(
  key: string,
  steps: readonly { id: string; name: string; capabilityId: string }[],
): WorkflowDefinition {
  return {
    id: `wfd_${key}`,
    key,
    version: 1,
    startStepId: steps[0]?.id ?? '',
    steps,
    approvalPoints: {},
    timeoutMs: 60_000,
    status: 'published',
  } as unknown as WorkflowDefinition;
}

/** The registered workflow definitions backing the specs. */
const definitions: Readonly<Record<string, WorkflowDefinition>> = {
  'projects.create_and_assign_employee': definition('projects.create_and_assign_employee', [
    { id: 'create_project', name: 'Create project', capabilityId: 'projects.create_project' },
    { id: 'assign_employee', name: 'Assign employee', capabilityId: 'projects.assign_employee' },
  ]),
  'hr.hire_and_assign_employee': definition('hr.hire_and_assign_employee', [
    { id: 'hire_employee', name: 'Hire employee', capabilityId: 'hr.create_employee' },
    { id: 'assign_employee', name: 'Assign employee', capabilityId: 'projects.assign_employee' },
  ]),
};

function detector() {
  return createWorkflowProposalDetector({
    getDefinition: (key) => definitions[key],
    workflows: defaultWorkflowPlannerSpecs(),
  });
}

const CREATE_AND_ASSIGN_INTENT = 'Create a project called Mobile Banking and assign Sarah to it';

describe('workflow proposal gating (S24 Phase 4)', () => {
  it('produces a proposal when the workflow capability is within the business affinity (CEO)', () => {
    const proposal = detector()({
      intent: CREATE_AND_ASSIGN_INTENT,
      businessCapabilityIds: [
        'projects.find_project',
        'workflow.create_project_and_assign_employee',
      ],
    });
    expect(proposal?.capabilityId).toBe(WORKFLOW_CAPABILITY_ID);
    expect(proposal?.workflowKey).toBe('projects.create_and_assign_employee');
  });

  it('produces NO executable workflow step when the affinity excludes the workflow capability (Developer)', () => {
    const proposal = detector()({
      intent: CREATE_AND_ASSIGN_INTENT,
      // Developer affinity: reads + workflows.read — but NOT workflows.execute.
      businessCapabilityIds: [
        'projects.find_project',
        'knowledge.search',
        'notifications.what_needs_attention',
      ],
    });
    expect(proposal).toBeUndefined();
  });

  it('treats an unknown workflow capability id as absent (fail closed)', () => {
    const proposal = detector()({
      intent: CREATE_AND_ASSIGN_INTENT,
      businessCapabilityIds: ['workflow.unknown_workflow'],
    });
    expect(proposal).toBeUndefined();
  });

  it('keeps the current unrestricted behavior when no affinity is resolved (safe default)', () => {
    const proposal = detector()({ intent: CREATE_AND_ASSIGN_INTENT });
    expect(proposal?.capabilityId).toBe(WORKFLOW_CAPABILITY_ID);
  });

  it('keeps the current unrestricted behavior for an empty affinity (unmapped role)', () => {
    const proposal = detector()({
      intent: CREATE_AND_ASSIGN_INTENT,
      businessCapabilityIds: [],
    });
    expect(proposal?.capabilityId).toBe(WORKFLOW_CAPABILITY_ID);
  });

  it('gates the hire-and-assign workflow the same way', () => {
    const detect = detector();
    const intent = 'Hire Sarah and assign her to the Mobile Banking project';
    const ceo = detect({
      intent,
      businessCapabilityIds: ['workflow.hire_and_assign_employee'],
    });
    expect(ceo?.capabilityId).toBe('workflow.hire_and_assign_employee');

    const developer = detect({
      intent,
      businessCapabilityIds: ['projects.find_project', 'knowledge.search'],
    });
    expect(developer).toBeUndefined();
  });
});
