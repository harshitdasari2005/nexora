import { describe, expect, it } from 'vitest';

import { checkGrounding, type GroundingInput } from '../src/grounding.js';

function input(overrides: Partial<GroundingInput>): GroundingInput {
  return {
    response: '',
    context: [],
    vocabulary: [],
    succeededCapabilities: [],
    approvalGranted: false,
    requiredFacts: [],
    forbiddenValues: [],
    ...overrides,
  };
}

describe('checkGrounding', () => {
  it('supports entity and numeric claims that appear in the grounding context', () => {
    const result = checkGrounding(
      input({
        response:
          'Mobile Banking Platform is at risk; the 30 June go-live and INR 50,000 threshold apply.',
        context: [
          'Mobile Banking Platform is at risk: the 30 June go-live is uncertain. Above INR 50000.',
        ],
        vocabulary: ['Mobile Banking Platform', 'Atlas Data Migration'],
      }),
    );
    expect(result.unsupportedClaims).toBe(0);
    expect(result.claims.map((claim) => claim.kind)).toEqual(['entity', 'numeric', 'numeric']);
    expect(result.failures).toEqual([]);
  });

  it('flags a world entity the response mentions but no source supports (e.g. another tenant)', () => {
    const result = checkGrounding(
      input({
        response: 'Fleet Telematics Rollout is on track.',
        context: ['Mobile Banking Platform is at risk.'],
        vocabulary: ['Fleet Telematics Rollout', 'Mobile Banking Platform'],
      }),
    );
    expect(result.unsupportedClaims).toBe(1);
    expect(result.unsupportedClaimRate).toBe(1);
    expect(result.failures[0]).toContain('entity:Fleet Telematics Rollout');
  });

  it('treats a completion claim as supported only by a succeeded step of that capability family', () => {
    const claimed = input({ response: 'I scheduled the review and created the project.' });
    const unsupported = checkGrounding(claimed);
    expect(unsupported.claims.filter((claim) => claim.kind === 'action')).toEqual([
      { kind: 'action', value: 'scheduled', supported: false },
      { kind: 'action', value: 'created', supported: false },
    ]);

    const supported = checkGrounding({
      ...claimed,
      succeededCapabilities: ['calendar.create_event', 'projects.create_project'],
    });
    expect(supported.unsupportedClaims).toBe(0);
  });

  it('never reads negated or conditional verbs as claims', () => {
    const result = checkGrounding(
      input({
        response:
          'The event was not created. It will be scheduled after approval, and nothing is assigned until you approve.',
      }),
    );
    expect(result.claims.filter((claim) => claim.kind === 'action')).toEqual([]);
  });

  it('ignores machine identifiers, UUIDs, and timestamps (references, not assertions)', () => {
    const result = checkGrounding(
      input({
        response:
          '- finance.flag_over_budget_items: done — {"id":"bud_6438a726-4b93-43af-803f-54aacd8c1fca","createdAt":"2026-09-29T09:03:45.123Z"}',
        vocabulary: ['Finance'],
      }),
    );
    expect(result.totalClaims).toBe(0);
  });

  it('reports missing required facts, forbidden values, and unacknowledged failures', () => {
    const result = checkGrounding(
      input({
        response: 'Here are your repositories: mobile-banking. Borealis plans an acquisition.',
        requiredFacts: ['30 June'],
        forbiddenValues: ['Borealis'],
        acknowledgesFailure: true,
      }),
    );
    expect(result.missingFacts).toEqual(['30 June']);
    expect(result.forbiddenFound).toEqual(['Borealis']);
    expect(result.failureAcknowledged).toBe(false);
    expect(result.failures).toHaveLength(3);
  });

  it('recognizes a failure acknowledgement generically (never an exact message)', () => {
    for (const response of [
      'I could not complete "List my repositories".',
      'The provider is unavailable right now.',
      'That request was rejected.',
    ]) {
      expect(checkGrounding(input({ response, acknowledgesFailure: true })).failures).toEqual([]);
    }
  });

  it('applies the unsupported-claim tolerance', () => {
    const base = input({
      response: 'Atlas Data Migration and Mobile Banking Platform.',
      context: ['Mobile Banking Platform'],
      vocabulary: ['Atlas Data Migration', 'Mobile Banking Platform'],
    });
    expect(checkGrounding(base).failures).toHaveLength(1);
    expect(checkGrounding({ ...base, maxUnsupportedClaimRate: 0.5 }).failures).toEqual([]);
  });

  it('is case/format-insensitive for facts (dashes, quotes, whitespace)', () => {
    const result = checkGrounding(
      input({
        response: 'The   PORTFOLIO risk review — Q3 applies.',
        requiredFacts: ['portfolio risk review - q3'],
      }),
    );
    expect(result.missingFacts).toEqual([]);
  });
});
