/**
 * Onboarding page: each checklist item shows its owner and state, and a
 * "Mark done" button renders only on the items the SERVER says the caller may
 * complete; the project assignment appears only once the person is active.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { isModuleVisible } from '../src/lib/modules.js';
import {
  progressLabel,
  type OnboardingItem,
  type OnboardingRecord,
} from '../src/lib/onboarding.js';
import { OnboardingView } from '../src/pages/Onboarding.js';

const SCOPE = { organizationId: 'org_1', workspaceId: 'wsp_1' };

const item = (
  key: string,
  owner: OnboardingItem['owner'],
  overrides: Partial<OnboardingItem> = {},
) =>
  ({
    key,
    owner,
    title: `${key} title`,
    done: false,
    canComplete: false,
    ...overrides,
  }) as OnboardingItem;

function record(overrides: Partial<OnboardingRecord> = {}): OnboardingRecord {
  return {
    id: 'onb_1',
    employeeId: 'emp_1',
    employeeName: 'Sarah Thomas',
    status: 'in_progress',
    employeeStatus: 'onboarding',
    jobTitle: 'Backend Developer',
    startDate: '2026-11-01',
    hiringManagerName: 'Rohan Mehta',
    projectId: 'prj_1',
    projectName: 'Mobile Banking Platform',
    assignedToProject: false,
    canAssign: false,
    items: [
      item('paperwork', 'hr', { done: true, doneByName: 'Priya Menon' }),
      item('accounts', 'it'),
      item('equipment', 'it'),
      item('buddy', 'manager'),
      item('orientation', 'hr'),
    ],
    ...overrides,
  };
}

const render = (props: Partial<Parameters<typeof OnboardingView>[0]>): string =>
  renderToString(
    <OnboardingView
      scope={SCOPE}
      onboardings={[]}
      ready={[]}
      onChanged={() => undefined}
      {...props}
    />,
  ).replace(/<!-- -->/g, '');

describe('OnboardingView', () => {
  it('shows HR the hired people waiting to start', () => {
    const html = render({
      ready: [
        {
          employeeId: 'emp_1',
          name: 'Sarah Thomas',
          jobTitle: 'Backend Developer',
          startDate: '2026-11-01',
        },
      ],
    });
    expect(html).toContain('Hired — onboarding not started (1)');
    expect(html).toContain('Backend Developer · starts 2026-11-01');
    expect(html).toContain('Start onboarding');
  });

  it('shows each item with its owner and state, and progress', () => {
    const html = render({ onboardings: [record()] });
    expect(html).toContain('Sarah Thomas');
    expect(html).toContain('hiring manager Rohan Mehta');
    expect(html).toContain('1 of 5 done');
    expect(html).toContain('HR · done by Priya Menon');
    expect(html).toContain('IT · waiting');
    expect(html).toContain('Hiring manager · waiting');
    // Nothing is completable for this caller.
    expect(html).not.toContain('Mark done');
  });

  it('renders "Mark done" only on the items the server allows', () => {
    const html = render({
      onboardings: [
        record({
          items: [
            item('paperwork', 'hr', { done: true }),
            item('accounts', 'it', { canComplete: true }),
            item('equipment', 'it', { canComplete: true }),
            item('buddy', 'manager'),
            item('orientation', 'hr'),
          ],
        }),
      ],
    });
    expect(html.match(/Mark done/g)).toHaveLength(2);
    expect(html).not.toContain('Who is the buddy?');
  });

  it('the manager is asked to name the buddy', () => {
    const html = render({
      onboardings: [record({ items: [item('buddy', 'manager', { canComplete: true })] })],
    });
    expect(html).toContain('Who is the buddy?');
  });

  it('assignment: offered to the hiring manager once active; shown as done afterwards; not before', () => {
    const done = record({
      status: 'completed',
      employeeStatus: 'active',
      items: [item('paperwork', 'hr', { done: true })],
    });
    expect(render({ onboardings: [{ ...done, canAssign: true }] })).toContain(
      'Assign to Mobile Banking Platform',
    );
    expect(render({ onboardings: [done] })).toContain(
      'Ready to be assigned to Mobile Banking Platform by the hiring manager.',
    );
    expect(render({ onboardings: [{ ...done, assignedToProject: true }] })).toContain(
      'Assigned to Mobile Banking Platform',
    );
    expect(render({ onboardings: [record({ canAssign: false })] })).not.toContain('Assign to');
  });

  it('explains the empty state, and the menu item follows the role', () => {
    expect(render({})).toContain('Nobody is being onboarded');
    expect(progressLabel({ items: [item('a', 'hr', { done: true }), item('b', 'it')] })).toBe(
      '1 of 2 done',
    );
    for (const permission of [
      'onboarding.hr',
      'onboarding.it',
      'onboarding.manager',
      'onboarding.read',
    ]) {
      expect(isModuleVisible('Onboarding', [permission])).toBe(true);
    }
    expect(isModuleVisible('Onboarding', ['budgets.read'])).toBe(false);
  });
});
