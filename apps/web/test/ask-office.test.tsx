/**
 * "Tell the office what you need": the box on the desk. A sentence becomes a
 * suggested, filled-in request that the person still has to check and send;
 * when nothing fits, the box says so and points somewhere useful.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AskOffice, workflowOf, type AskState } from '../src/components/AskOffice.js';
import type { Workflow, WorkflowCatalog } from '../src/lib/requests.js';
import { DeskView } from '../src/pages/Desk.js';

const scope = { organizationId: 'org_1', workspaceId: 'wsp_eng' };
const render = (node: JSX.Element): string =>
  renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '');

const leave: Workflow = {
  key: 'leave',
  name: 'Leave',
  description: 'Ask for time off.',
  reasonLabel: 'Why',
  fields: [
    {
      key: 'kind',
      label: 'Kind of leave',
      type: 'choice',
      required: true,
      options: ['vacation', 'sick', 'personal'],
    },
    { key: 'startDate', label: 'First day', type: 'date', required: true },
    { key: 'endDate', label: 'Last day', type: 'date', required: true },
  ],
  stages: [
    { label: 'Manager approves', kind: 'decide' },
    { label: 'HR approves and records it', kind: 'decide' },
  ],
};
const catalog: WorkflowCatalog = {
  departments: [{ name: 'People', workflows: [leave] }],
  assistant: { connected: true, model: 'test-model' },
};
const ask = (state?: AskState): string =>
  render(
    <AskOffice
      scope={scope}
      catalog={catalog}
      {...(state === undefined ? {} : { initialState: state })}
    />,
  );

describe('AskOffice', () => {
  it('invites a sentence, shows what kind of thing to write, and promises nothing more', () => {
    const html = ask();
    expect(html).toContain('Tell the office what you need');
    expect(html).toContain('you check it and send it, and people decide');
    expect(html).toContain('Prepare it');
    expect(html).toContain('The login screen crashes when the OTP is pasted');
  });

  it('shows the suggested request filled in, for the person to check and send', () => {
    const html = ask({
      kind: 'suggested',
      sentence: 'I need Monday to Wednesday off for a wedding',
      workflow: leave,
      suggestion: {
        type: 'leave',
        chosenBy: 'ai',
        draft: {
          values: { kind: 'personal', startDate: '2026-10-05', endDate: '2026-10-07' },
          reason: 'A wedding.',
          source: 'ai',
        },
      },
    });
    expect(html).toContain('That starts a <strong>Leave</strong> request');
    expect(html).toContain('value="2026-10-05"');
    expect(html).toContain('value="2026-10-07"');
    expect(html).toContain('A wedding.');
    // Who it will go to, before it is sent.
    expect(html).toContain('Manager approves');
    expect(html).toContain('HR approves and records it');
    expect(html).toContain('Suggested by the assistant (test-model)');
    expect(html).toContain('>Send<');
  });

  it('says so when the sentence starts no workflow, and where to go instead', () => {
    const html = ask({ kind: 'no_match', sentence: 'who approves purchases?' });
    expect(html).toContain('That does not start any of the office workflows');
    expect(html).toContain('href="/app/requests?organizationId=org_1&amp;workspaceId=wsp_eng"');
    expect(html).toContain('ask the assistant a question');
  });

  it('confirms where a sent request went', () => {
    const html = ask({ kind: 'sent', workflow: leave });
    expect(html).toContain('Your leave request is now with:');
    expect(html).toContain('<strong>Manager approves</strong>');
  });

  it('finds a workflow by key, and nothing for a key the catalog does not have', () => {
    expect(workflowOf(catalog, 'leave')?.name).toBe('Leave');
    expect(workflowOf(catalog, 'delete_everything')).toBeUndefined();
  });
});

describe('the desk', () => {
  const desk = { mine: [], watching: [], starts: [] };
  it('offers the ask box only to someone who may start a workflow', () => {
    const without = render(<DeskView scope={scope} firstName="Aarav" desk={desk} />);
    expect(without).not.toContain('Tell the office what you need');
    const withCatalog = render(
      <DeskView scope={scope} firstName="Aarav" desk={desk} catalog={catalog} />,
    );
    expect(withCatalog).toContain('Tell the office what you need');
  });
});
