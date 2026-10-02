/**
 * Onboarding — the checklist a new hire goes through, each item owned by the
 * part of the office that does it.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  InvalidEmployeeValueError,
  Onboarding,
  ONBOARDING_ITEMS,
  OnboardingStateError,
  type RecruitingEventContext,
} from '../src/index.js';

const ctx: RecruitingEventContext = {
  actor: { kind: 'user', id: 'usr_hr' },
  correlationId: 'corr',
  organizationId: 'org_1' as TenantId,
};
const start = () =>
  Onboarding.start(
    {
      organizationId: 'org_1' as TenantId,
      employeeId: 'emp_1',
      employeeName: 'Sarah Thomas',
      workspaceId: 'wsp_eng' as WorkspaceId,
      hiringManagerId: 'usr_manager',
      projectId: 'prj_1',
      startedBy: 'usr_hr',
    },
    ctx,
  );

describe('Onboarding', () => {
  it('starts with the standard checklist, nothing done, each item owned by a role', () => {
    const onboarding = start();
    const snapshot = Onboarding.snapshot(onboarding);
    expect(snapshot.status).toBe('in_progress');
    expect(snapshot.items.map((item) => [item.key, item.owner, item.done])).toEqual([
      ['paperwork', 'hr', false],
      ['accounts', 'it', false],
      ['equipment', 'it', false],
      ['buddy', 'manager', false],
      ['orientation', 'hr', false],
    ]);
    expect(onboarding.pullDomainEvents().map((event) => event.type)).toEqual([
      'onboarding.started',
    ]);
  });

  it('records who completed an item and when; an item is completed only once', () => {
    const onboarding = start();
    expect(
      onboarding.completeItem({ key: 'accounts', actorId: 'usr_it', note: ' Mailbox ready ' }, ctx),
    ).toBe(false);
    expect(onboarding.item('accounts')).toMatchObject({
      done: true,
      doneBy: 'usr_it',
      note: 'Mailbox ready',
    });
    expect(() => onboarding.completeItem({ key: 'accounts', actorId: 'usr_it' }, ctx)).toThrow(
      OnboardingStateError,
    );
    expect(() => onboarding.completeItem({ key: 'parking', actorId: 'usr_it' }, ctx)).toThrow(
      InvalidEmployeeValueError,
    );
  });

  it('the buddy item needs the buddy to be named', () => {
    const onboarding = start();
    expect(() => onboarding.completeItem({ key: 'buddy', actorId: 'usr_manager' }, ctx)).toThrow(
      InvalidEmployeeValueError,
    );
    onboarding.completeItem({ key: 'buddy', actorId: 'usr_manager', note: 'Aarav Kulkarni' }, ctx);
    expect(onboarding.item('buddy')?.note).toBe('Aarav Kulkarni');
  });

  it('completes exactly when the LAST item is done', () => {
    const onboarding = start();
    onboarding.pullDomainEvents();
    const keys = ONBOARDING_ITEMS.map((item) => item.key);
    keys.slice(0, -1).forEach((key) => {
      expect(onboarding.completeItem({ key, actorId: 'usr_x', note: 'Someone' }, ctx)).toBe(false);
      expect(onboarding.isCompleted).toBe(false);
    });
    expect(
      onboarding.completeItem({ key: keys.at(-1)!, actorId: 'usr_x', note: 'Someone' }, ctx),
    ).toBe(true);
    expect(onboarding.isCompleted).toBe(true);
    expect(Onboarding.snapshot(onboarding).completedAt).toBeDefined();
    expect(
      onboarding
        .pullDomainEvents()
        .map((event) => event.type)
        .at(-1),
    ).toBe('onboarding.completed');
  });

  it('round-trips through its snapshot', () => {
    const onboarding = start();
    onboarding.completeItem({ key: 'paperwork', actorId: 'usr_hr' }, ctx);
    const snapshot = Onboarding.snapshot(onboarding);
    expect(Onboarding.snapshot(Onboarding.hydrate(JSON.parse(JSON.stringify(snapshot))))).toEqual(
      snapshot,
    );
  });
});
