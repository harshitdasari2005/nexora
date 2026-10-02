/**
 * OfficeRequest: the chain a request travels and the rules that hold whoever
 * calls — stages in order, nobody decides their own request, a rejection needs
 * a reason and ends the request, only the requester withdraws.
 */

import { describe, expect, it } from 'vitest';

import {
  OfficeRequest,
  OfficeRequestNotPermittedError,
  OfficeRequestStateError,
  type OfficeRequestDetails,
  type OfficeRequestStage,
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
  currency: 'INR',
  reason: 'Needed for the device lab.',
};
const ACCESS: OfficeRequestDetails = {
  type: 'access',
  what: 'Production logs (read only)',
  reason: 'On-call rotation starts Monday.',
};

const raise = (details: OfficeRequestDetails, notRequired: OfficeRequestStage[] = []) =>
  OfficeRequest.submit({
    organizationId: ORG,
    workspaceId: TEAM,
    requestedBy: 'usr_dev',
    details,
    notRequired,
  });

describe('OfficeRequest — the chain', () => {
  it('each kind of request travels its own chain, starting with the manager', () => {
    expect(raise(LEAVE).stages).toEqual(['manager', 'hr']);
    expect(raise(PURCHASE).stages).toEqual(['manager', 'finance']);
    expect(raise(ACCESS).stages).toEqual(['manager', 'it']);
    expect(raise(LEAVE).pendingStage).toBe('manager');
    expect(raise(LEAVE).status).toBe('pending');
  });

  it('is approved only after every stage, in order', () => {
    const request = raise(LEAVE);
    expect(() => request.decide({ stage: 'hr', decision: 'approve', actorId: 'usr_hr' })).toThrow(
      OfficeRequestStateError,
    );
    request.decide({ stage: 'manager', decision: 'approve', actorId: 'usr_manager' });
    expect(request.status).toBe('pending');
    expect(request.pendingStage).toBe('hr');
    request.decide({ stage: 'hr', decision: 'approve', actorId: 'usr_hr', comment: 'Enjoy.' });
    expect(request.status).toBe('approved');
    expect(request.pendingStage).toBeUndefined();
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
    expect(() =>
      request.decide({ stage: 'manager', decision: 'approve', actorId: 'usr_dev' }),
    ).toThrow(OfficeRequestNotPermittedError);
    expect(request.pendingStage).toBe('manager');
  });

  it('a rejection needs a reason, ends the request, and nothing can follow it', () => {
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
    const request = raise(ACCESS);
    expect(() => request.withdraw('usr_manager')).toThrow(OfficeRequestNotPermittedError);
    request.withdraw('usr_dev');
    expect(request.status).toBe('withdrawn');
    expect(() => request.withdraw('usr_dev')).toThrow(OfficeRequestStateError);
    expect(() =>
      request.decide({ stage: 'manager', decision: 'approve', actorId: 'usr_manager' }),
    ).toThrow(OfficeRequestStateError);
  });
});

describe('OfficeRequest — stages the requester would have to decide themselves', () => {
  it('are recorded as not required, and the request waits at the next one', () => {
    const request = raise(LEAVE, ['manager']);
    expect(request.pendingStage).toBe('hr');
    expect(OfficeRequest.snapshot(request).history).toMatchObject([
      { action: 'submitted' },
      { action: 'not_required', stage: 'manager' },
    ]);
  });

  it('a later stage is passed over when the chain reaches it', () => {
    const request = raise(LEAVE, ['hr']);
    expect(request.pendingStage).toBe('manager');
    request.decide({ stage: 'manager', decision: 'approve', actorId: 'usr_manager' });
    expect(request.status).toBe('approved');
    expect(OfficeRequest.snapshot(request).history.map((entry) => entry.action)).toEqual([
      'submitted',
      'not_required',
      'approved',
    ]);
  });

  it('never approves itself: at least one other person always decides', () => {
    const request = raise(LEAVE, ['manager', 'hr']);
    expect(request.status).toBe('pending');
    expect(request.pendingStage).toBe('hr');
    expect(request.decisionBlocker('usr_dev')).toBe('You cannot decide your own request');
    request.decide({ stage: 'hr', decision: 'approve', actorId: 'usr_hr' });
    expect(request.status).toBe('approved');
  });
});

describe('OfficeRequest — what the requester fills in', () => {
  const invalid: [string, OfficeRequestDetails][] = [
    ['leave ending before it starts', { ...LEAVE, endDate: '2026-11-01' } as OfficeRequestDetails],
    ['leave without real dates', { ...LEAVE, startDate: 'next week' } as OfficeRequestDetails],
    ['an unknown kind of leave', { ...LEAVE, kind: 'forever' } as never],
    ['a purchase that costs nothing', { ...PURCHASE, amountMinorUnits: 0 } as OfficeRequestDetails],
    ['a purchase without a currency', { ...PURCHASE, currency: 'rupees' } as OfficeRequestDetails],
    ['a purchase of nothing', { ...PURCHASE, item: ' ' } as OfficeRequestDetails],
    ['access to nothing', { ...ACCESS, what: '' } as OfficeRequestDetails],
    ['no reason', { ...ACCESS, reason: 'pls' } as OfficeRequestDetails],
    ['an unknown type', { type: 'holiday', reason: 'Because.' } as never],
  ];
  for (const [name, details] of invalid) {
    it(`refuses ${name}`, () => {
      expect(() => raise(details)).toThrow();
    });
  }

  it('keeps a valid request as given, trimmed', () => {
    const request = raise({ ...ACCESS, what: '  VPN  ' } as OfficeRequestDetails);
    expect(OfficeRequest.snapshot(request).details).toEqual({
      type: 'access',
      what: 'VPN',
      reason: 'On-call rotation starts Monday.',
    });
  });

  it('survives storage: a hydrated request behaves the same', () => {
    const request = raise(PURCHASE);
    request.decide({ stage: 'manager', decision: 'approve', actorId: 'usr_manager' });
    const again = OfficeRequest.hydrate(structuredClone(OfficeRequest.snapshot(request)));
    expect(again.pendingStage).toBe('finance');
    expect(again.version).toBe(request.version);
    again.decide({ stage: 'finance', decision: 'approve', actorId: 'usr_cfo' });
    expect(again.status).toBe('approved');
  });
});
