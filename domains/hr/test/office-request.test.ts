/**
 * OfficeRequest: one piece of office work travelling the chain its workflow
 * defines, and the rules that hold whoever calls — stages in order, nobody
 * decides their own request, saying no needs a reason, work that must be
 * written down cannot be finished without it, only the requester withdraws.
 */

import { describe, expect, it } from 'vitest';

import {
  OfficeRequest,
  OfficeRequestNotPermittedError,
  OfficeRequestStateError,
  WORKFLOW_CATALOG,
  WORKFLOW_DEPARTMENTS,
  WORKFLOW_SEATS,
  findWorkflow,
  type OfficeRequestDetails,
} from '../src/index.js';

const ORG = 'org_1' as never;
const TEAM = 'wsp_eng' as never;
const LEAVE: OfficeRequestDetails = {
  type: 'leave',
  kind: 'vacation',
  startDate: '2026-11-10',
  endDate: '2026-11-14',
  reason: 'Family wedding.',
};
const PURCHASE: OfficeRequestDetails = {
  type: 'purchase',
  item: 'Test devices',
  amountMinorUnits: 4_500_000,
  reason: 'Needed for the device lab.',
};
const CAMPAIGN: OfficeRequestDetails = {
  type: 'campaign',
  name: 'Diwali savings offer',
  audience: 'Salaried customers',
  goal: '2,000 new accounts',
  budget: 50_000_000,
  launchDate: '2026-10-20',
  reason: 'Festive season is our best acquisition window.',
};
const EQUIPMENT: OfficeRequestDetails = {
  type: 'equipment',
  item: 'A second monitor',
  reason: 'Reviewing designs side by side.',
};

const raise = (details: OfficeRequestDetails, heldByRequester: string[] = [], by = 'usr_dev') =>
  OfficeRequest.submit({
    organizationId: ORG,
    workspaceId: TEAM,
    requestedBy: by,
    details,
    heldByRequester,
  });
const yes = (request: OfficeRequest, actorId: string, comment?: string) =>
  request.decide({
    stage: request.pendingStage as string,
    decision: 'approve',
    actorId,
    ...(comment === undefined ? {} : { comment }),
  });

describe('the workflow catalog', () => {
  it('covers every department of the office', () => {
    const covered = new Set(WORKFLOW_CATALOG.map((definition) => definition.department));
    expect([...WORKFLOW_DEPARTMENTS].filter((department) => !covered.has(department))).toEqual([]);
    expect(WORKFLOW_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it('every workflow is well formed', () => {
    const keys = new Set<string>();
    for (const definition of WORKFLOW_CATALOG) {
      expect(keys.has(definition.key), definition.key).toBe(false);
      keys.add(definition.key);
      expect(definition.key.length).toBeLessThanOrEqual(32);
      expect(definition.stages.length, definition.key).toBeGreaterThan(0);
      // At least one stage belongs to someone other than the requester.
      expect(
        definition.stages.some((stage) => stage.seat !== 'requester'),
        definition.key,
      ).toBe(true);
      const stageKeys = definition.stages.map((stage) => stage.key);
      expect(new Set(stageKeys).size, definition.key).toBe(stageKeys.length);
      for (const stage of definition.stages) {
        expect(WORKFLOW_SEATS, `${definition.key}.${stage.key}`).toContain(stage.seat);
        if (stage.noteRequired === true) expect(stage.noteLabel).toBeDefined();
      }
      const fieldKeys = definition.fields.map((field) => field.key);
      expect(new Set(fieldKeys).size, definition.key).toBe(fieldKeys.length);
      expect(fieldKeys).not.toContain('type');
      expect(fieldKeys).not.toContain('reason');
      for (const field of definition.fields) {
        if (field.type === 'choice') expect(field.options?.length ?? 0).toBeGreaterThan(1);
      }
      for (const key of definition.summaryFields) expect(fieldKeys, definition.key).toContain(key);
      expect(findWorkflow(definition.key)).toBe(definition);
    }
  });
});

describe('OfficeRequest — the chain', () => {
  it('each workflow travels its own chain', () => {
    expect(raise(LEAVE).stages).toEqual(['manager', 'hr']);
    expect(raise(PURCHASE).stages).toEqual(['manager', 'finance']);
    expect(raise(CAMPAIGN).stages).toEqual(['marketing', 'finance', 'legal', 'launch', 'results']);
    expect(raise(LEAVE).pendingStage).toBe('manager');
    expect(raise(LEAVE).status).toBe('pending');
  });

  it('is finished only after every stage, in order', () => {
    const request = raise(LEAVE);
    expect(() => request.decide({ stage: 'hr', decision: 'approve', actorId: 'usr_hr' })).toThrow(
      OfficeRequestStateError,
    );
    yes(request, 'usr_manager');
    expect(request.pendingStage).toBe('hr');
    yes(request, 'usr_hr', 'Enjoy.');
    expect(request.status).toBe('approved');
    expect(OfficeRequest.snapshot(request).history.map((entry) => entry.action)).toEqual([
      'submitted',
      'approved',
      'approved',
    ]);
  });

  it('nobody decides their own request', () => {
    const request = raise(LEAVE);
    expect(request.decisionBlocker('usr_dev')).toBe('You cannot decide your own request');
    expect(request.decisionBlocker('usr_manager')).toBeUndefined();
    expect(() => yes(request, 'usr_dev')).toThrow(OfficeRequestNotPermittedError);
    expect(request.pendingStage).toBe('manager');
  });

  it('saying no needs a reason, ends the request, and nothing can follow it', () => {
    const request = raise(PURCHASE);
    expect(() =>
      request.decide({ stage: 'manager', decision: 'reject', actorId: 'usr_manager' }),
    ).toThrow(/reason is required/);
    expect(request.status).toBe('pending');
    request.decide({
      stage: 'manager',
      decision: 'reject',
      actorId: 'usr_manager',
      comment: 'Use the shared devices.',
    });
    expect(request.status).toBe('rejected');
    expect(() =>
      request.decide({ stage: 'finance', decision: 'approve', actorId: 'usr_cfo' }),
    ).toThrow(OfficeRequestStateError);
  });

  it('only the requester withdraws, and only while it is pending', () => {
    const request = raise(EQUIPMENT);
    expect(() => request.withdraw('usr_manager')).toThrow(OfficeRequestNotPermittedError);
    request.withdraw('usr_dev');
    expect(request.status).toBe('withdrawn');
    expect(() => request.withdraw('usr_dev')).toThrow(OfficeRequestStateError);
  });
});

describe('OfficeRequest — work stages', () => {
  it('work whose result must be written down cannot be finished without it', () => {
    const request = raise(CAMPAIGN);
    yes(request, 'usr_marketing');
    yes(request, 'usr_cfo');
    yes(request, 'usr_legal');
    expect(request.pendingStage).toBe('launch');
    expect(() => yes(request, 'usr_marketing')).toThrow(/needs to be written down/);
    yes(request, 'usr_marketing', 'Emails and app banners went out on the 20th.');
    expect(request.pendingStage).toBe('results');
    yes(request, 'usr_marketing', '2,340 new accounts against a goal of 2,000.');
    expect(request.status).toBe('approved');
  });

  it('the requester may do their own part of the work, but still not decide', () => {
    // The marketing head raises the campaign: the plan is decided by someone else…
    const request = raise(CAMPAIGN, [], 'usr_marketing');
    expect(() => yes(request, 'usr_marketing')).toThrow(OfficeRequestNotPermittedError);
    yes(request, 'usr_ceo');
    yes(request, 'usr_cfo');
    yes(request, 'usr_legal');
    // …and the launch is her own work.
    expect(request.decisionBlocker('usr_marketing')).toBeUndefined();
    yes(request, 'usr_marketing', 'Launched on every channel.');
    expect(request.pendingStage).toBe('results');
  });

  it('a step that belongs to the requester can be taken only by them', () => {
    const request = raise(EQUIPMENT);
    yes(request, 'usr_manager');
    yes(request, 'usr_it');
    expect(request.pendingStage).toBe('received');
    expect(request.decisionBlocker('usr_it')).toBe(
      'Only the person who raised this can take this step',
    );
    expect(() => yes(request, 'usr_it')).toThrow(OfficeRequestNotPermittedError);
    yes(request, 'usr_dev');
    expect(request.status).toBe('approved');
  });
});

describe('OfficeRequest — decisions the requester would have to take themselves', () => {
  it('are recorded as not required and passed over wherever they sit in the chain', () => {
    const first = raise(LEAVE, ['manager']);
    expect(first.pendingStage).toBe('hr');
    const later = raise(LEAVE, ['hr']);
    expect(later.pendingStage).toBe('manager');
    yes(later, 'usr_manager');
    expect(later.status).toBe('approved');
    expect(OfficeRequest.snapshot(later).history.map((entry) => entry.action)).toEqual([
      'submitted',
      'not_required',
      'approved',
    ]);
  });

  it('a request nobody else would touch keeps its last decision for someone above', () => {
    const request = raise(LEAVE, ['manager', 'hr']);
    expect(request.pendingStage).toBe('hr');
    expect(request.decisionBlocker('usr_dev')).toBe('You cannot decide your own request');
    // The same when the only other stage is the requester's own work.
    const content = raise(
      {
        type: 'content',
        title: 'Five ways to save',
        channel: 'blog',
        draft: 'Pay a little extra…',
        reason: 'For new borrowers.',
      },
      ['marketing', 'publish'],
      'usr_marketing',
    );
    expect(content.pendingStage).toBe('marketing');
  });

  it('when someone else does part of the work, the requester’s own decision is not needed', () => {
    const escalation = raise(
      {
        type: 'escalation',
        customer: 'Rekha Sharma',
        subject: 'Statement download fails',
        severity: 'high',
        reason: 'Restarting did not help.',
      },
      ['support', 'reply'],
      'usr_support',
    );
    expect(escalation.pendingStage).toBe('fix');
  });

  it('work is never passed over', () => {
    const request = raise(CAMPAIGN, ['marketing', 'launch', 'results'], 'usr_marketing');
    expect(request.pendingStage).toBe('finance');
    yes(request, 'usr_cfo');
    yes(request, 'usr_legal');
    expect(request.pendingStage).toBe('launch');
  });
});

describe('OfficeRequest — what the requester fills in', () => {
  const invalid: [string, OfficeRequestDetails][] = [
    ['a period ending before it starts', { ...LEAVE, endDate: '2026-11-01' }],
    ['something that is not a date', { ...LEAVE, startDate: 'next week' }],
    ['a choice outside the options', { ...LEAVE, kind: 'forever' }],
    ['money that is zero', { ...PURCHASE, amountMinorUnits: 0 }],
    ['money given as text', { ...PURCHASE, amountMinorUnits: '4500' }],
    [
      'a missing required field',
      { type: 'purchase', amountMinorUnits: 100, reason: 'Needed now.' },
    ],
    ['no reason', { ...EQUIPMENT, reason: 'pls' }],
    ['an unknown workflow', { type: 'holiday', reason: 'Because.' }],
  ];
  for (const [name, details] of invalid) {
    it(`refuses ${name}`, () => {
      expect(() => raise(details)).toThrow();
    });
  }

  it('keeps only the workflow’s own fields, trimmed, and stamps the currency on money', () => {
    const request = raise({ ...PURCHASE, item: '  Test devices  ', isAdmin: 'yes' });
    expect(OfficeRequest.snapshot(request).details).toEqual({
      type: 'purchase',
      item: 'Test devices',
      amountMinorUnits: 4_500_000,
      currency: 'INR',
      reason: 'Needed for the device lab.',
    });
  });

  it('survives storage: a hydrated request behaves the same', () => {
    const request = raise(PURCHASE);
    yes(request, 'usr_manager');
    const again = OfficeRequest.hydrate(structuredClone(OfficeRequest.snapshot(request)));
    expect(again.pendingStage).toBe('finance');
    expect(again.version).toBe(request.version);
    yes(again, 'usr_cfo');
    expect(again.status).toBe('approved');
  });
});
