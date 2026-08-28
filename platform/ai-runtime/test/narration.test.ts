/**
 * @nexora/ai-runtime — deterministic narration tests.
 *
 * The deterministic composer is always the fallback (and the default), so
 * its output has to be legible on its own. These tests pin the retrieval
 * rendering: a knowledge answer is shown as a cited, readable line rather
 * than a raw JSON dump of the tool output.
 */

import { describe, expect, it } from 'vitest';

import { composeResponse } from '../src/orchestrator/narration.js';
import type { StepOutcome } from '../src/orchestrator/request.js';

/** A succeeded step carrying the given tool output. */
function succeededStep(output: unknown): StepOutcome {
  return {
    stepId: 'step_1',
    capabilityId: 'knowledge.search',
    toolId: 'knowledge.search',
    status: 'succeeded',
    verified: true,
    output,
  };
}

describe('composeResponse — retrieval rendering', () => {
  it('renders a knowledge hit as a cited, readable line (not JSON)', () => {
    const response = composeResponse({
      intent: 'What is the deadline for the Mobile Banking project?',
      steps: [
        succeededStep({
          found: true,
          references: [
            {
              title: 'Mobile Banking Project Plan',
              snippet:
                'The Mobile Banking project deadline is June 30. The launch window opens in May.',
            },
          ],
        }),
      ],
      approvals: [],
      status: 'completed',
    });

    expect(response).toContain('Mobile Banking Project Plan');
    expect(response).toContain('June 30');
    // The raw tool-output shape must not leak into the narrative.
    expect(response).not.toContain('"references"');
    expect(response).not.toContain('found');
  });

  it('names up to three sources and counts the rest', () => {
    const response = composeResponse({
      intent: 'expense policy',
      steps: [
        succeededStep({
          references: [
            { title: 'Doc A', snippet: 'a' },
            { title: 'Doc B', snippet: 'b' },
            { title: 'Doc C', snippet: 'c' },
            { title: 'Doc D', snippet: 'd' },
            { title: 'Doc E', snippet: 'e' },
          ],
        }),
      ],
      approvals: [],
      status: 'completed',
    });

    expect(response).toContain('Doc A');
    expect(response).toContain('Doc C');
    expect(response).not.toContain('Doc D');
    expect(response).toContain('+2 more sources');
  });

  it('states plainly when retrieval found nothing accessible', () => {
    const response = composeResponse({
      intent: 'what is the wifi password',
      steps: [succeededStep({ found: false, references: [] })],
      approvals: [],
      status: 'completed',
    });

    expect(response).toContain('no matching knowledge found');
  });

  it('truncates an over-long snippet', () => {
    const long = 'x'.repeat(500);
    const response = composeResponse({
      intent: 'policy',
      steps: [succeededStep({ references: [{ title: 'Long Doc', snippet: long }] })],
      approvals: [],
      status: 'completed',
    });

    expect(response).toContain('…');
    expect(response).not.toContain('x'.repeat(300));
  });

  it('leaves non-retrieval tool output on the generic JSON rendering', () => {
    const response = composeResponse({
      intent: 'list my workspaces',
      steps: [
        {
          stepId: 'step_1',
          capabilityId: 'workspaces.list_workspaces',
          toolId: 'workspaces.list_workspaces',
          status: 'succeeded',
          verified: true,
          output: { workspaces: [{ id: 'wsp_1', name: 'Engineering' }] },
        },
      ],
      approvals: [],
      status: 'completed',
    });

    expect(response).toContain('workspaces.list_workspaces');
    expect(response).toContain('Engineering');
  });
});
