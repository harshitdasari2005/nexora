/**
 * @nexora/ai-runtime — long tool-result narration tests.
 *
 * A large structured tool result must never crowd the entity name, id,
 * status, or outcome out of the response (regression: a blind 400-character
 * slice of the serialized JSON cut off the tool's own message).
 */

import { describe, expect, it } from 'vitest';

import { composeResponse, renderResultsDigest } from '../src/orchestrator/narration.js';
import type { StepOutcome } from '../src/orchestrator/request.js';

function step(output: unknown, overrides: Partial<StepOutcome> = {}): StepOutcome {
  return {
    stepId: 'step_1',
    capabilityId: 'workflow.hire_and_assign_employee',
    toolId: 'workflow.hire_and_assign_employee',
    status: 'succeeded',
    verified: true,
    output,
    ...overrides,
  };
}

/** A workflow-shaped output whose timeline alone exceeds any small budget. */
function workflowOutput(stepCount: number) {
  return {
    workflow: {
      id: 'wfi_123',
      definitionKey: 'hr.hire_and_assign_employee',
      status: 'succeeded',
      steps: Array.from({ length: stepCount }, (_, i) => ({
        stepId: `step_${i}`,
        name: `Long running step number ${i}`,
        capabilityId: `some.namespaced.capability_${i}`,
        toolId: `some.namespaced.capability_${i}`,
        status: 'succeeded',
      })),
      startedAt: '2026-09-01T09:00:00.000Z',
      finishedAt: '2026-09-01T09:00:01.000Z',
    },
    message: 'Sarah Thomas was hired and assigned to Mobile Banking Platform successfully.',
  };
}

describe('composeResponse — long structured outputs', () => {
  it('serializes far beyond the old 400-character cut, yet still leads with the tool message', () => {
    const output = workflowOutput(12);
    expect(JSON.stringify(output).length).toBeGreaterThan(1500);
    const response = composeResponse({
      intent: 'Hire Sarah Thomas',
      steps: [step(output)],
      approvals: [],
      status: 'completed',
    });
    expect(response).toContain('Sarah Thomas was hired and assigned to Mobile Banking Platform');
    expect(response).toContain('workflow.status: succeeded');
    expect(response).toContain('workflow.id: wfi_123');
    expect(response).toContain('(verified)');
  });

  it('keeps the entity even when the message is not the first serialized key', () => {
    // `message` is LAST in the object — a prefix slice would have dropped it.
    const output = workflowOutput(20);
    const keys = Object.keys(output);
    expect(keys[keys.length - 1]).toBe('message');
    const response = composeResponse({
      intent: 'Hire Sarah Thomas',
      steps: [step(output)],
      approvals: [],
      status: 'completed',
    });
    expect(response).toContain('Sarah Thomas');
    expect(response).toContain('Mobile Banking Platform');
  });

  it('bounds the response and says how many fields were omitted', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`field_${i}`, `value number ${i} `.repeat(4)]),
    );
    const response = composeResponse({
      intent: 'x',
      steps: [step({ name: 'Quantum Ledger', id: 'prj_9', status: 'active', ...wide })],
      approvals: [],
      status: 'completed',
    });
    expect(response).toContain('name: Quantum Ledger');
    expect(response).toContain('id: prj_9');
    expect(response).toContain('status: active');
    expect(response).toMatch(/\(\+\d+ more fields?\)/);
    expect(response.length).toBeLessThan(1200);
  });

  it('never cuts a field value in the middle of an identifier', () => {
    const response = composeResponse({
      intent: 'x',
      steps: [
        step({
          project: { id: 'prj_abcdef0123456789', name: 'Atlas Data Migration' },
          notes: 'n'.repeat(900),
        }),
      ],
      approvals: [],
      status: 'completed',
    });
    expect(response).toContain('project.id: prj_abcdef0123456789');
    expect(response).toContain('project.name: Atlas Data Migration');
  });

  it('renders list results as a count plus whole items, and counts what does not fit', () => {
    const response = composeResponse({
      intent: 'x',
      steps: [
        step({
          projects: Array.from({ length: 30 }, (_, i) => ({
            name: `Project ${i}`,
            status: 'active',
          })),
        }),
      ],
      approvals: [],
      status: 'completed',
    });
    expect(response).toContain('projects: 30 items [name=Project 0 status=active; name=Project 1');
    expect(response).toMatch(/\(\+\d+ more\)/);
    // No item is cut in half: every shown item is complete.
    expect(response).not.toMatch(/name=Project \d+ status=acti[^v]/);
  });

  it('keeps EVERY scalar field of a listed entity, not just its label', () => {
    const response = composeResponse({
      intent: 'x',
      steps: [
        step({
          workspaces: [{ id: 'wsp_1', name: 'Engineering', slug: 'engineering', status: 'active' }],
          notifications: [{ title: 'Project created', body: 'Mobile Banking was created' }],
        }),
      ],
      approvals: [],
      status: 'completed',
    });
    expect(response).toContain('slug=engineering');
    expect(response).toContain('Mobile Banking was created');
  });

  it('marks a truncated plain-string output instead of cutting silently', () => {
    const response = composeResponse({
      intent: 'x',
      steps: [step('a'.repeat(2000))],
      approvals: [],
      status: 'completed',
    });
    expect(response).toContain('…');
    expect(response.length).toBeLessThan(800);
  });

  it('reports a failed step with its error and no fabricated output', () => {
    const response = composeResponse({
      intent: 'Hire Rohan Das',
      steps: [step(undefined, { status: 'failed', error: 'The project could not be found' })],
      approvals: [],
      status: 'failed_partial',
    });
    expect(response).toContain('Failed 1 step(s)');
    expect(response).toContain('The project could not be found');
  });
});

describe('renderResultsDigest — long structured outputs', () => {
  it('keeps the headline, id, and status of a large output within the digest budget', () => {
    const digest = renderResultsDigest({
      steps: [step(workflowOutput(40))],
      approvals: [],
      status: 'completed',
    });
    expect(digest).toContain('Sarah Thomas was hired and assigned to Mobile Banking Platform');
    expect(digest).toContain('workflow.status: succeeded');
    expect(digest.length).toBeLessThan(2000);
  });
});

describe('composeResponse — failed runs and tool-vetted detail', () => {
  it('shows the rollback outcome the tool vetted, but never the raw failure message', () => {
    const response = composeResponse({
      intent: 'Hire Rohan Das',
      steps: [
        step(undefined, {
          status: 'failed',
          error: 'Step find_project (Find project) failed: internal lookup exploded at 10.0.0.7',
          detail: 'Rolled back: Hire employee. Nothing was left behind.',
        }),
      ],
      approvals: [],
      status: 'failed',
    });
    expect(response).toContain('I could not complete "Hire Rohan Das"');
    expect(response).toContain('Rolled back: Hire employee. Nothing was left behind.');
    expect(response).not.toContain('10.0.0.7');
    expect(response).not.toContain('exploded');
  });

  it('stays the generic failure sentence when no detail was vetted', () => {
    const response = composeResponse({
      intent: 'Hire Rohan Das',
      steps: [step(undefined, { status: 'failed', error: 'raw internal text' })],
      approvals: [],
      status: 'failed',
    });
    expect(response).toBe('I could not complete "Hire Rohan Das". The plan could not be executed.');
  });

  it('gives the model digest the vetted outcome but not the raw error', () => {
    const digest = renderResultsDigest({
      steps: [
        step(undefined, {
          status: 'failed',
          error: 'raw internal text',
          detail: 'Partially completed — NOT rolled back: Create project.',
        }),
      ],
      approvals: [],
      status: 'failed',
    });
    expect(digest).toContain('Outcome: Partially completed — NOT rolled back: Create project.');
    expect(digest).not.toContain('raw internal text');
  });
});
