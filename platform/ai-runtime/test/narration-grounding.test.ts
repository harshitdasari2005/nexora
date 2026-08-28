/**
 * @nexora/ai-runtime — narration grounding tests.
 *
 * The narration model is handed a deterministic digest of what the run
 * actually produced and a prompt that forbids reporting anything else.
 * These tests pin both halves: the digest is faithful (real outputs in,
 * nothing invented, honest about gaps), and the prompt template carries the
 * anti-fabrication rules and the `{{results}}` binding.
 */

import { describe, expect, it } from 'vitest';

import { renderResultsDigest } from '../src/orchestrator/narration.js';
import type { ApprovalOutcome, StepOutcome } from '../src/orchestrator/request.js';
import { createNarrationPrompt, NARRATION_PROMPT_ID } from '../src/prompting/narration-prompt.js';
import { TemplateRenderer } from '../src/prompting/prompt-renderer.js';

function step(overrides: Partial<StepOutcome>): StepOutcome {
  return {
    stepId: 'step_1',
    capabilityId: 'projects.list',
    toolId: 'projects.list',
    status: 'succeeded',
    verified: true,
    ...overrides,
  };
}

describe('renderResultsDigest — faithful run transcript', () => {
  it('includes the actual tool output verbatim', () => {
    const digest = renderResultsDigest({
      status: 'completed',
      approvals: [],
      steps: [
        step({
          capabilityId: 'projects.list',
          output: { projects: [{ name: 'Mobile Banking', status: 'at_risk' }] },
        }),
      ],
    });

    expect(digest).toContain('Run status: completed');
    expect(digest).toContain('projects.list — succeeded (verified)');
    expect(digest).toContain('Mobile Banking');
    expect(digest).toContain('at_risk');
  });

  it('renders a retrieval result with its source title (citation preserved)', () => {
    const digest = renderResultsDigest({
      status: 'completed',
      approvals: [],
      steps: [
        step({
          capabilityId: 'knowledge.search',
          toolId: 'knowledge.search',
          output: {
            found: true,
            references: [
              {
                title: 'Mobile Banking Project Plan',
                snippet: 'The Mobile Banking project deadline is June 30.',
              },
            ],
          },
        }),
      ],
    });

    expect(digest).toContain('Mobile Banking Project Plan');
    expect(digest).toContain('June 30');
  });

  it('reports a succeeded-but-empty step as returning no data (never omits it)', () => {
    const digest = renderResultsDigest({
      status: 'completed',
      approvals: [],
      steps: [step({ capabilityId: 'projects.list', output: undefined })],
    });

    expect(digest).toContain('returned no data');
    expect(digest).toContain('No substantive data was returned by any step');
  });

  it('reports a failed step without leaking the raw error message', () => {
    const digest = renderResultsDigest({
      status: 'failed',
      approvals: [],
      steps: [
        step({
          capabilityId: 'projects.list',
          status: 'failed',
          verified: false,
          error: 'ECONNREFUSED secret-internal-detail at 10.0.0.5:5432',
        }),
      ],
    });

    expect(digest).toContain('did not complete; no result was returned');
    expect(digest).not.toContain('secret-internal-detail');
    expect(digest).not.toContain('10.0.0.5');
  });

  it('marks a blocked step as awaiting approval and lists the gate', () => {
    const approvals: ApprovalOutcome[] = [
      {
        stepId: 'step_1',
        toolId: 'projects.create_project',
        capabilityId: 'projects.create_project',
        status: 'pending',
        sideEffectClass: 'state_change',
      },
    ];
    const digest = renderResultsDigest({
      status: 'blocked',
      approvals,
      steps: [
        step({
          capabilityId: 'projects.create_project',
          toolId: 'projects.create_project',
          status: 'blocked',
          verified: false,
        }),
      ],
    });

    expect(digest).toContain('blocked, awaiting human approval');
    expect(digest).toContain('Approval gates:');
    expect(digest).toContain('projects.create_project — pending (state_change)');
  });

  it('states plainly when no tools ran at all', () => {
    const digest = renderResultsDigest({ status: 'completed', approvals: [], steps: [] });
    expect(digest).toContain('No tools were executed');
    expect(digest).toContain('No substantive data was returned');
  });

  it('does not add the "no data" note when a step returned real content', () => {
    const digest = renderResultsDigest({
      status: 'completed',
      approvals: [],
      steps: [step({ output: { projects: [{ name: 'Atlas' }] } })],
    });
    expect(digest).not.toContain('No substantive data was returned');
  });
});

describe('createNarrationPrompt — anti-fabrication grounding rules', () => {
  it('declares intent, businessContext, and the results binding', () => {
    const prompt = createNarrationPrompt();
    expect(prompt.id).toBe(NARRATION_PROMPT_ID);
    expect([...prompt.variables].sort()).toEqual(['businessContext', 'intent', 'results']);
    expect(prompt.version).toBe('2.0.0');
  });

  it('explicitly forbids inventing entities and demands honesty about gaps', () => {
    const { text } = createNarrationPrompt();
    expect(text).toMatch(/Use ONLY the information under RESULTS/i);
    expect(text).toMatch(/Never invent or guess/i);
    expect(text).toMatch(/project, person, team, document, identifier/i);
    expect(text).toMatch(/does not contain enough information/i);
    expect(text).toMatch(/Do not infer causes, trends, or next steps/i);
    expect(text).toMatch(/Preserve uncertainty/i);
    expect(text).toMatch(/keep that title in your answer/i);
  });

  it('renders the digest into the {{results}} slot and nothing else', () => {
    const prompt = createNarrationPrompt();
    const rendered = new TemplateRenderer().render(prompt, {
      intent: 'Which projects are at risk?',
      businessContext: 'Domain: Executive\nRole: CEO',
      results: 'Run status: completed\n1. projects.list — succeeded (verified)\n   {"projects":[]}',
    });

    expect(rendered).toContain('INTENT (what the user asked): Which projects are at risk?');
    expect(rendered).toContain('RESULTS (the only facts you may use):');
    expect(rendered).toContain('1. projects.list — succeeded (verified)');
    expect(rendered).not.toContain('{{');
  });
});
