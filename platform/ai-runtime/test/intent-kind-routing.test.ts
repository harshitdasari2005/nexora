/**
 * @nexora/ai-runtime — intent-kind routing tests.
 *
 * An entity noun ("expense") names what a sentence is about, not what the
 * user wants done with it. These tests pin the deterministic distinction
 * between information lookups, recommendations, and mutations, and that a
 * state-changing capability can only ever match a command.
 */

import { describe, expect, it } from 'vitest';
import type { CapabilityDeclaration } from '@nexora/contracts/ai';

import { CapabilityMatcher } from '../src/discovery/capability-matcher.js';
import { classifyIntentKind, isReadOnlyIntent } from '../src/discovery/intent-classifier.js';

const capability = (
  id: string,
  name: string,
  sideEffectClass: CapabilityDeclaration['sideEffectClass'],
  description = name,
): CapabilityDeclaration => ({ id, name, description, skillId: `${id}.skill`, sideEffectClass });

const submitExpense = capability(
  'finance.submit_expense',
  'Submit expense',
  'consequential',
  'Submits an expense claim against a budget',
);
const updateExpense = capability(
  'finance.update_expense',
  'Update expense',
  'state_change',
  'Updates an expense claim',
);
const approveExpense = capability(
  'finance.approve_expense',
  'Approve expense',
  'consequential',
  'Approves an expense claim',
);
const listExpenses = capability(
  'finance.list_expenses',
  'List expenses',
  'read_only',
  'Lists expense claims',
);
const listProjects = capability('projects.list', 'List projects', 'read_only', 'Lists projects');
const createProject = capability(
  'projects.create_project',
  'Create project',
  'state_change',
  'Creates a project',
);
const all = [
  submitExpense,
  updateExpense,
  approveExpense,
  listExpenses,
  listProjects,
  createProject,
];

const matched = (intent: string): string[] =>
  new CapabilityMatcher().match(intent, all).map((score) => score.capabilityId);

describe('classifyIntentKind', () => {
  it.each([
    [
      'What does the travel and expense policy say about approval for large expenses?',
      'information',
    ],
    ['How do I submit an expense?', 'information'],
    ['Can I submit an expense over 50,000 without a receipt?', 'information'],
    ['Is an expense above the threshold approved automatically?', 'information'],
    ['Does the policy require approval for expenses?', 'information'],
    ['Show me the expenses for last month', 'information'],
    ['List expenses', 'information'],
    ['Explain the expense approval process', 'information'],
    ['expense policy?', 'information'],
    ["What's the expense limit for travel", 'information'],
  ])('reads %j as information', (text, kind) => {
    expect(classifyIntentKind(text)).toBe(kind);
  });

  it.each([
    ['Should I approve this expense?', 'recommendation'],
    ['What should we do about the overspent budget?', 'recommendation'],
    ['Do you recommend approving the marketing expense?', 'recommendation'],
    ['Suggest which expense to review first', 'recommendation'],
  ])('reads %j as a recommendation', (text, kind) => {
    expect(classifyIntentKind(text)).toBe(kind);
  });

  it.each([
    'Submit an expense for 4,500 against the marketing budget',
    'Approve the travel expense',
    'Update the expense amount to 5,000',
    'Please submit an expense for the offsite',
    'Can you submit an expense for the offsite?',
    'Could you please approve that expense',
    'I want to submit an expense',
    "I'd like to update the expense",
    'Go ahead and approve the expense',
    'Hey Nexora, create a project called Atlas',
    'Hire Sarah Thomas and assign her to Mobile Banking',
  ])('reads %j as an action', (text) => {
    expect(classifyIntentKind(text)).toBe('action');
  });

  it('leaves statements and unknown phrasing unspecified', () => {
    expect(classifyIntentKind('the flagged budgets')).toBe('unspecified');
    expect(classifyIntentKind('   ')).toBe('unspecified');
  });

  it('marks only information and recommendation as read-only', () => {
    expect(isReadOnlyIntent('information')).toBe(true);
    expect(isReadOnlyIntent('recommendation')).toBe(true);
    expect(isReadOnlyIntent('action')).toBe(false);
    expect(isReadOnlyIntent('unspecified')).toBe(false);
  });
});

describe('CapabilityMatcher — intent kind', () => {
  it('never matches a state-changing capability for a policy question', () => {
    const ids = matched(
      'What does the travel and expense policy say about approval for large expenses?',
    );
    expect(ids).not.toContain('finance.submit_expense');
    expect(ids).not.toContain('finance.update_expense');
    expect(ids).not.toContain('finance.approve_expense');
  });

  it('still matches read-only capabilities for an information question', () => {
    expect(matched('What expenses have been claimed?')).toContain('finance.list_expenses');
    expect(matched('What projects do I have?')).toContain('projects.list');
  });

  it('does not match a mutation for a recommendation request', () => {
    const ids = matched('Should I approve this expense?');
    expect(ids).not.toContain('finance.approve_expense');
    expect(ids).not.toContain('finance.submit_expense');
  });

  it('does not match a mutation for a how-to or a permission question', () => {
    expect(matched('How do I submit an expense?')).not.toContain('finance.submit_expense');
    expect(matched('Can I update an expense after approval?')).not.toContain(
      'finance.update_expense',
    );
  });

  it('matches expense submission commands', () => {
    expect(matched('Submit an expense for the offsite')).toContain('finance.submit_expense');
    expect(matched('Please submit an expense for the offsite')).toContain('finance.submit_expense');
    expect(matched('Can you submit an expense for the offsite?')).toContain(
      'finance.submit_expense',
    );
    expect(matched('I want to submit an expense')).toContain('finance.submit_expense');
  });

  it('matches expense update and approval commands', () => {
    expect(matched('Update the expense to 5,000')).toContain('finance.update_expense');
    expect(matched('Approve the expense')).toContain('finance.approve_expense');
    expect(matched('Could you approve that expense?')).toContain('finance.approve_expense');
  });

  it('keeps command matching for other domains unchanged', () => {
    expect(matched('Create a project called Atlas')).toContain('projects.create_project');
  });
});

describe('head-noun rule: a qualifier alone never plans a second state change', () => {
  const flagOverBudget = capability(
    'finance.flag_over_budget_items',
    'Flag Over-Budget Items',
    'consequential',
    'Re-scans active budgets and flags the ones over the utilization threshold for review',
  );
  const finance = [submitExpense, flagOverBudget];
  const plan = (intent: string): string[] =>
    new CapabilityMatcher().match(intent, finance).map((score) => score.capabilityId);

  it.each([
    'Submit an expense of 4,500 against budget Marketing Q3',
    'Submit an expense of 4,500 against the over budget marketing line',
    'Please submit an expense over budget for the offsite',
  ])('plans only the expense step: %s', (intent) => {
    expect(plan(intent)).toEqual(['finance.submit_expense']);
  });

  it.each(['Flag over-budget items', 'Please flag the over budget items in Finance'])(
    'still plans the flag step when asked to flag: %s',
    (intent) => {
      expect(plan(intent)).toContain('finance.flag_over_budget_items');
    },
  );
});
