/**
 * The office workflows page, and its place on My desk: the catalog is shown as
 * the server published it, a button appears only where the server said the
 * caller may act, the assistant's help is labelled for what it is, and the
 * form's values go to the server in the shape it checks.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { buildDesk, type DeskSources } from '../src/lib/desk.js';
import {
  assistantSourceLabel,
  formFromValues,
  requestRoute,
  requestStatusLabel,
  requestTitle,
  valuesFromForm,
  type OfficeRequest,
  type Workflow,
  type WorkflowCatalog,
} from '../src/lib/requests.js';
import {
  historyLine,
  RequestCard,
  RequestForm,
  RequestsView,
  WorkflowPicker,
} from '../src/pages/Requests.js';

const scope = { organizationId: 'org_1', workspaceId: 'wsp_eng' };
const render = (node: JSX.Element): string =>
  renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '');

const PURCHASE: Workflow = {
  key: 'purchase',
  name: 'Purchase',
  description: 'Ask the company to buy something.',
  reasonLabel: 'Why it is needed',
  fields: [
    { key: 'item', label: 'What should be bought', type: 'text', required: true },
    { key: 'amountMinorUnits', label: 'Cost', type: 'money', required: true },
    { key: 'neededBy', label: 'Needed by', type: 'date', required: false },
  ],
  stages: [
    { label: 'Manager approves', kind: 'decide' },
    { label: 'Finance approves', kind: 'decide' },
  ],
};
const CAMPAIGN: Workflow = {
  key: 'campaign',
  name: 'Marketing campaign',
  description: 'Plan a campaign, get sign-off, launch it, record the results.',
  reasonLabel: 'The idea in a few lines',
  fields: [{ key: 'name', label: 'Campaign name', type: 'text', required: true }],
  stages: [
    { label: 'Marketing head approves the plan', kind: 'decide' },
    { label: 'Marketing launches it', kind: 'do' },
  ],
};
const catalog = (connected: boolean): WorkflowCatalog => ({
  departments: [
    { name: 'Marketing', workflows: [CAMPAIGN] },
    { name: 'Finance', workflows: [PURCHASE] },
  ],
  assistant: connected
    ? { connected: true, model: 'llama-3.3-70b-versatile' }
    : { connected: false },
});

function request(overrides: Partial<OfficeRequest> = {}): OfficeRequest {
  return {
    id: 'ofr_1',
    type: 'purchase',
    workflow: 'Purchase',
    department: 'Finance',
    summary: 'Test devices, ₹45,000',
    reasonLabel: 'Why it is needed',
    reason: 'The lab has no Android 15 phones.',
    fields: [
      { label: 'What should be bought', value: 'Test devices', long: false },
      { label: 'Cost', value: '₹45,000', long: false },
    ],
    status: 'pending',
    pending: { key: 'manager', label: 'Manager approves', kind: 'decide', noteRequired: false },
    stages: [
      { key: 'manager', label: 'Manager approves', kind: 'decide', state: 'current' },
      { key: 'finance', label: 'Finance approves', kind: 'decide', state: 'waiting' },
    ],
    requestedBy: 'usr_dev',
    requestedByName: 'Meghna Iyer',
    mine: false,
    history: [{ at: '2026-10-02T09:00:00.000Z', actorId: 'usr_dev', action: 'submitted' }],
    createdAt: '2026-10-02T09:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
    actions: { canDecide: false, canWithdraw: false },
    ...overrides,
  };
}

describe('workflows in plain words', () => {
  it('names a request, says where it stands and draws its route', () => {
    expect(requestTitle(request())).toBe('Purchase: Test devices, ₹45,000');
    expect(requestTitle(request({ summary: '' }))).toBe('Purchase');
    expect(requestStatusLabel(request())).toBe('Now: Manager approves');
    expect(requestStatusLabel(request({ status: 'approved', pending: undefined }))).toBe(
      'Completed',
    );
    expect(requestRoute(request())).toEqual([
      { label: 'Raised', state: 'done' },
      { label: 'Manager approves', state: 'current' },
      { label: 'Finance approves', state: 'waiting' },
    ]);
  });

  it('tells the history, including what the assistant helped with', () => {
    const base = { at: 't', actorId: 'u', actorName: 'Rohan Mehta' };
    expect(
      historyLine({
        ...base,
        action: 'rejected',
        stage: 'manager',
        stageLabel: 'Manager approves',
        comment: 'Not this sprint.',
      }),
    ).toBe('Manager approves: refused by Rohan Mehta — “Not this sprint.”');
    expect(
      historyLine({
        ...base,
        action: 'assisted',
        comment: 'prepared a brief for "Manager approves" (ai)',
      }),
    ).toBe('The assistant helped Rohan Mehta: prepared a brief for "Manager approves" (ai)');
    expect(
      historyLine({ ...base, action: 'not_required', stage: 'hr', stageLabel: 'HR approves' }),
    ).toBe('“HR approves” not needed: Rohan Mehta holds that seat');
  });

  it('sends amounts as paise and leaves out what was left empty', () => {
    expect(
      valuesFromForm(PURCHASE, { item: ' Test devices ', amountMinorUnits: '45000', neededBy: '' }),
    ).toEqual({
      values: { item: 'Test devices', amountMinorUnits: 4_500_000 },
      problem: null,
    });
    expect(valuesFromForm(PURCHASE, { item: 'Phones' }).problem).toBe('Cost is needed.');
    expect(valuesFromForm(PURCHASE, { item: 'Phones', amountMinorUnits: 'lots' }).problem).toBe(
      'Cost must be a number.',
    );
    expect(valuesFromForm(PURCHASE, { item: 'Phones', amountMinorUnits: '0' }).problem).toBe(
      'Cost must be a number.',
    );
    // What the assistant suggests comes back as rupees in the form.
    expect(
      formFromValues(PURCHASE, { item: 'Phones', amountMinorUnits: 4_500_000, extra: 'x' }),
    ).toEqual({
      item: 'Phones',
      amountMinorUnits: '45000',
    });
  });

  it('says honestly where a suggestion came from', () => {
    expect(assistantSourceLabel('ai', catalog(true).assistant)).toBe(
      'Suggested by the assistant (llama-3.3-70b-versatile). Check it before you send it.',
    );
    expect(assistantSourceLabel('rules', catalog(false).assistant)).toContain(
      'no AI model is connected',
    );
  });
});

describe('RequestsView', () => {
  it('invites a first workflow and says whether an AI model is connected', () => {
    const off = render(
      <RequestsView
        scope={scope}
        requests={[]}
        canCreate
        catalog={catalog(false)}
        onChanged={() => undefined}
      />,
    );
    expect(off).toContain('Nothing in motion yet');
    expect(off).toContain('>Start a workflow<');
    expect(off).toContain('No AI model is connected');
    const on = render(
      <RequestsView
        scope={scope}
        requests={[]}
        canCreate
        catalog={catalog(true)}
        onChanged={() => undefined}
      />,
    );
    expect(on).toContain('The assistant is connected (llama-3.3-70b-versatile)');
    expect(on).toContain('people decide');
  });

  it('puts what waits for the caller first, with the buttons — and only there', () => {
    const html = render(
      <RequestsView
        scope={scope}
        canCreate
        catalog={catalog(false)}
        onChanged={() => undefined}
        requests={[
          request({ id: 'ofr_mine', mine: true, actions: { canDecide: false, canWithdraw: true } }),
          request({ id: 'ofr_decide', actions: { canDecide: true, canWithdraw: false } }),
          request({ id: 'ofr_other' }),
        ]}
      />,
    );
    expect(html.indexOf('Waiting for you')).toBeLessThan(html.indexOf('Started by you'));
    expect(html.indexOf('Started by you')).toBeLessThan(html.indexOf('Others you take part in'));
    expect(html.match(/>Approve</g)).toHaveLength(1);
    expect(html.match(/>Refuse</g)).toHaveLength(1);
    expect(html.match(/Prepare me with the assistant/g)).toHaveLength(1);
    expect(html.match(/>Withdraw</g)).toHaveLength(1);
    expect(html).toContain('Started by Meghna Iyer.');
    expect(html).toContain('Your turn');
  });

  it('hides "Start a workflow" from someone who may not start one', () => {
    const html = render(
      <RequestsView
        scope={scope}
        requests={[request()]}
        canCreate={false}
        catalog={catalog(false)}
        onChanged={() => undefined}
      />,
    );
    expect(html).not.toContain('>Start a workflow<');
  });
});

describe('RequestCard', () => {
  const card = (item: OfficeRequest) =>
    render(
      <RequestCard
        scope={scope}
        request={item}
        assistant={catalog(false).assistant}
        onChanged={() => undefined}
      />,
    );

  it('a piece of work is finished with its written result, and the assistant can draft it', () => {
    const html = card(
      request({
        type: 'ticket',
        workflow: 'Customer problem',
        pending: {
          key: 'reply',
          label: 'Support replies to the customer',
          kind: 'do',
          noteRequired: true,
          noteLabel: 'The reply sent to the customer',
        },
        actions: { canDecide: true, canWithdraw: false },
      }),
    );
    expect(html).toContain('The reply sent to the customer');
    expect(html).toContain('Draft it with the assistant');
    expect(html).toContain('>Mark as done<');
    expect(html).toContain('>Cannot be done<');
    expect(html).not.toContain('>Approve<');
    // Work is done, not weighed: no decision brief here.
    expect(html).not.toContain('Prepare me with the assistant');
  });

  it('shows a refusal with its reason, and why the caller cannot act', () => {
    const refused = card(
      request({
        mine: true,
        status: 'rejected',
        pending: undefined,
        history: [
          { at: 't1', actorId: 'u', action: 'submitted' },
          {
            at: 't2',
            actorId: 'm',
            actorName: 'Rohan Mehta',
            action: 'rejected',
            stage: 'manager',
            comment: 'Release week.',
          },
        ],
      }),
    );
    expect(refused).toContain('Refused by Rohan Mehta: “Release week.”');
    expect(refused).not.toContain('>Approve<');
    const blocked = card(
      request({
        mine: true,
        actions: {
          canDecide: false,
          decideBlockedReason: 'You cannot decide your own request',
          canWithdraw: true,
        },
      }),
    );
    expect(blocked).toContain('You cannot decide your own request');
  });
});

describe('starting a workflow', () => {
  it('offers every department and its workflows with their chains', () => {
    const html = render(
      <WorkflowPicker
        catalog={catalog(false)}
        onPick={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('>Marketing<');
    expect(html).toContain('>Finance<');
    expect(html).toContain('Marketing campaign');
    expect(html).toContain('2 steps: Marketing head approves the plan, then Marketing launches it');
  });

  it('builds the form from the workflow: its fields, its question, its route, the assistant', () => {
    const html = render(
      <RequestForm
        scope={scope}
        workflow={PURCHASE}
        assistant={catalog(false).assistant}
        onSent={() => undefined}
        onCancel={() => undefined}
      />,
    );
    for (const label of ['What should be bought', 'Cost', 'Needed by', 'Why it is needed']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('type="date"');
    expect(html).toContain('Amount in rupees');
    expect(html).toContain('You raise it');
    expect(html).toContain('Finance approves');
    expect(html).toContain('Describe it in a sentence');
    expect(html).toContain('Fill in with the assistant');
  });
});

describe('workflows on My desk', () => {
  const sources = (overrides: Partial<DeskSources> = {}): DeskSources => ({
    requisitions: [],
    canRaiseRequest: false,
    readyRequisitions: [],
    canManageRecruiting: false,
    openings: [],
    readyHires: [],
    canStartOnboarding: false,
    onboardings: [],
    officeRequests: [],
    canRaiseOfficeRequest: false,
    tasks: [],
    canManageTasks: false,
    ...overrides,
  });

  it('a stage that is yours is on your desk; your own request in motion is listed apart', () => {
    const desk = buildDesk(
      sources({
        officeRequests: [
          request({ id: 'ofr_a', actions: { canDecide: true, canWithdraw: false } }),
          request({ id: 'ofr_b', mine: true }),
          request({ id: 'ofr_c', mine: true, status: 'approved', pending: undefined }),
          request({ id: 'ofr_d' }),
        ],
      }),
    );
    expect(desk.mine).toMatchObject([
      {
        title: 'Manager approves: Purchase: Test devices, ₹45,000',
        detail: 'Finance. Started by Meghna Iyer.',
        screen: 'requests',
      },
    ]);
    expect(desk.watching).toMatchObject([
      { title: 'Purchase: Test devices, ₹45,000', detail: 'Now: Manager approves.' },
    ]);
  });

  it('offers to start a workflow only to someone who may', () => {
    expect(buildDesk(sources({ canRaiseOfficeRequest: true })).starts).toMatchObject([
      { title: 'Start an office workflow', screen: 'requests' },
    ]);
    expect(buildDesk(sources()).starts).toEqual([]);
  });
});
