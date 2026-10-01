/**
 * Intent-kind routing regressions, end to end through the real chat API.
 *
 * "expense" names an entity, not a wish: a policy question must retrieve
 * knowledge and open NO approval, while every command form of the same noun
 * must still reach the governed write path. Each case runs the message
 * through the scenario harness (real routes, runtime, approval engine).
 */

import { describe, expect, it } from 'vitest';
import { buildDatasetV1, type ScenarioDefinition } from '@nexora/evaluation';

import { observeScenario } from '../evaluation/runner.js';

const template = buildDatasetV1().scenarios.find((s) => s.id === 'NXS-005') as ScenarioDefinition;

/** Runs one message as Rahul (CFO) in the Finance workspace; returns what was observed. */
async function observe(message: string) {
  const scenario: ScenarioDefinition = {
    ...template,
    id: 'TST-INTENT',
    knownGap: undefined,
    request: { ...(template.request as object), message } as ScenarioDefinition['request'],
  };
  const observation = await observeScenario(scenario, {});
  return {
    approvals: observation.approvals,
    tools: observation.plannedSteps.map((step) => step.capabilityId),
    sources: observation.retrieval ?? [],
    errors: observation.errors,
  };
}

describe('information questions never open a write path', () => {
  it.each([
    'What does the travel and expense policy say about approval for large expenses?',
    'How do I submit an expense?',
    'Can I submit an expense over 50,000 without a receipt?',
    'Does an expense need approval above the threshold?',
    'Tell me about the expense policy',
  ])('%s', async (message) => {
    const observed = await observe(message);
    expect(observed.approvals).toEqual([]);
    expect(observed.tools).not.toContain('finance.submit_expense');
    expect(observed.tools).not.toContain('finance.flag_over_budget_items');
  });

  it('retrieves the policy for the canonical policy question', async () => {
    const observed = await observe(
      'What does the travel and expense policy say about approval for large expenses?',
    );
    expect(observed.tools).toEqual(['knowledge.search']);
    expect(observed.sources.length).toBeGreaterThan(0);
  });
});

describe('recommendation requests do not mutate', () => {
  it('"Should I approve…" is read-only', async () => {
    const observed = await observe('Should I approve the Q3 campaign expense?');
    expect(observed.approvals).toEqual([]);
  });
});

describe('command forms still reach the governed write path', () => {
  it.each([
    'Submit an expense of 4,500 for the Q3 marketing campaign',
    'Please submit an expense of 4,500 for the Q3 marketing campaign',
    'Can you submit an expense of 4,500 for the Q3 marketing campaign?',
    'I want to submit an expense of 4,500 for the Q3 marketing campaign',
  ])('%s', async (message) => {
    const observed = await observe(message);
    expect(observed.tools).toContain('finance.submit_expense');
  });
});

describe('an expense submission plans ONLY the expense step', () => {
  it.each([
    'Submit an expense of 4,500 INR for vendor onboarding against budget Marketing Q3',
    'Submit an expense of 4,500 INR for the offsite against the over budget marketing line',
  ])('%s', async (message) => {
    const observed = await observe(message);
    expect(observed.tools).toEqual(['finance.submit_expense']);
  });

  it('still plans the flag step when the request asks to flag over-budget items', async () => {
    const observed = await observe('Flag over-budget items in Finance');
    expect(observed.tools).toEqual(['finance.flag_over_budget_items']);
  });
});
