/**
 * The weekly review page: the counts are shown as counted, the paragraph on
 * top says who worded it, and waiting work is listed where it waits.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { spokenHours, type ReviewResponse } from '../src/lib/review.js';
import { isModuleVisible } from '../src/lib/modules.js';
import { ReviewView } from '../src/pages/Review.js';

const scope = { organizationId: 'org_1', workspaceId: 'wsp_eng' };
const render = (node: JSX.Element): string =>
  renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '');

const data = (overrides: Partial<ReviewResponse> = {}): ReviewResponse => ({
  review: {
    from: '2026-09-25T12:00:00.000Z',
    to: '2026-10-02T12:00:00.000Z',
    requests: {
      raised: 9,
      finished: 2,
      refused: 1,
      withdrawn: 0,
      inMotion: 6,
      typicalHours: 20,
      draftedWithAssistant: 2,
      assistantHelps: 5,
    },
    waitingAt: [
      { step: 'Manager approves', department: 'Finance, People', count: 3, longestHours: 60 },
      { step: 'Finance approves', department: 'Sales', count: 1, longestHours: 6 },
    ],
    waitingLongest: [
      {
        id: 'ofr_1',
        workflow: 'Purchase',
        summary: 'Two Android test phones, ₹90,000',
        step: 'Manager approves',
        requestedByName: 'Aarav Kulkarni',
        waitingHours: 60,
        stuck: true,
      },
    ],
    departments: [
      { department: 'Finance', raised: 4, finished: 2, inMotion: 2, typicalHours: 20 },
      { department: 'People', raised: 5, finished: 0, inMotion: 4 },
    ],
    tasks: { done: 1, inReview: 1, inProgress: 1, todo: 1, overdue: 2 },
  },
  summary: '9 requests were raised this week and 2 were finished.',
  assistant: { connected: false },
  ...overrides,
});

describe('ReviewView', () => {
  it('shows the counted week, where work waits and what has waited longest', () => {
    const html = render(<ReviewView scope={scope} data={data()} worded={null} />);
    expect(html).toContain('Weekly review');
    expect(html).toContain('Where work is waiting');
    expect(html).toContain('Manager approves');
    expect(html).toContain('Finance, People');
    expect(html).toContain('3 waiting');
    expect(html).toContain('longest 3 days');
    expect(html).toContain('Purchase: Two Android test phones, ₹90,000');
    expect(html).toContain('Raised by Aarav Kulkarni');
    expect(html).toContain('Typical time to finish');
    expect(html).toContain('20 hours');
    expect(html).toContain('2 of 9');
    expect(html).toContain('None yet');
    expect(html).toContain('Past the due date');
  });

  it('says plainly who wrote the paragraph: rules, or the assistant from the counts', () => {
    const byRules = render(<ReviewView scope={scope} data={data()} worded={null} />);
    expect(byRules).toContain('9 requests were raised this week and 2 were finished.');
    expect(byRules).toContain('written by plain rules: no AI model is connected');

    const connected = data({ assistant: { connected: true, model: 'test-model' } });
    const byAssistant = render(
      <ReviewView
        scope={scope}
        data={connected}
        worded={{ text: 'Nine requests moved; three wait on managers.', source: 'ai' }}
      />,
    );
    expect(byAssistant).toContain('Nine requests moved; three wait on managers.');
    expect(byAssistant).toContain('Worded by the assistant (test-model) from the counts below');
    expect(byAssistant).toContain('Every number is counted from the records');
    // While the assistant is still wording it, the counted text is already there.
    const waiting = render(<ReviewView scope={scope} data={connected} worded={null} />);
    expect(waiting).toContain('9 requests were raised this week');
    expect(waiting).toContain('The assistant is wording it');
  });

  it('says so when nothing is waiting', () => {
    const empty = data();
    const html = render(
      <ReviewView
        scope={scope}
        data={{ ...empty, review: { ...empty.review, waitingAt: [], waitingLongest: [] } }}
        worded={null}
      />,
    );
    expect(html).toContain('Nothing is waiting for anyone right now.');
    expect(html).not.toContain('Waiting longest');
  });

  it('is in the menu only for roles that read the organization’s insights', () => {
    expect(isModuleVisible('Weekly review', ['insights.read'])).toBe(true);
    expect(isModuleVisible('Weekly review', ['requests.create'])).toBe(false);
    expect(spokenHours(0.4)).toBe('less than an hour');
    expect(spokenHours(72)).toBe('3 days');
  });
});
