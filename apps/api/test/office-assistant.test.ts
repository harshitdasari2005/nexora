/**
 * The assistant inside the office workflows: it drafts a request from one
 * sentence, prepares the person who must decide, and drafts the written part
 * of a piece of work. It only suggests — every value it proposes is checked
 * against the workflow's own form, a checked warning beats its optimism, help
 * is on the record, and it helps only the person whose turn it is.
 */

import type { FastifyInstance } from 'fastify';
import type { ChatRequest, ChatResponse } from '@nexora/ai-runtime';
import { findWorkflow } from '@nexora/domain-hr';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoIds, type DemoIds, type DemoWorkspaceKey } from '../src/demo/world.js';
import { OfficeAi, draftByRules, fitField } from '../src/office/office-ai.js';
import { buildTestApp } from './helpers.js';

/** A chat model that answers with whatever the test queued, and records what it was asked. */
function fakeChat() {
  const asked: string[] = [];
  const answers: (string | Error)[] = [];
  return {
    asked,
    answer: (value: unknown) =>
      answers.push(
        value instanceof Error || typeof value === 'string' ? value : JSON.stringify(value),
      ),
    chat: {
      id: 'fake',
      complete: async (request: ChatRequest): Promise<ChatResponse> => {
        asked.push(request.messages.map((message) => message.content).join('\n'));
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return { content: next ?? '', finishReason: 'stop', model: 'fake-model' };
      },
    },
  };
}

const LEAVE = findWorkflow('leave')!;
const PURCHASE = findWorkflow('purchase')!;

describe('OfficeAi — values are checked, never trusted', () => {
  it('keeps a suggested value only when it fits its field', () => {
    const kind = LEAVE.fields.find((field) => field.key === 'kind')!;
    const start = LEAVE.fields.find((field) => field.key === 'startDate')!;
    const cost = PURCHASE.fields.find((field) => field.key === 'amountMinorUnits')!;
    expect(fitField(kind, 'sick')).toBe('sick');
    expect(fitField(kind, 'forever')).toBeUndefined();
    expect(fitField(start, '2026-11-10')).toBe('2026-11-10');
    expect(fitField(start, 'next Monday')).toBeUndefined();
    // The model speaks in rupees; a request stores paise.
    expect(fitField(cost, 45000)).toBe(4_500_000);
    expect(fitField(cost, -5)).toBeUndefined();
    expect(fitField(cost, 'a lot')).toBeUndefined();
  });

  it('with a model: fills the form from one sentence, dropping what does not fit', async () => {
    const model = fakeChat();
    model.answer({
      kind: 'vacation',
      startDate: '2026-11-10',
      endDate: 'the 14th',
      status: 'approved',
      reason: 'Family wedding in Pune.',
    });
    const assistant = new OfficeAi({
      chat: model.chat,
      model: 'fake-model',
      today: () => '2026-10-02',
    });
    const draft = await assistant.draft(LEAVE, 'I need leave for my cousin’s wedding 10–14 Nov');
    expect(draft).toEqual({
      values: { kind: 'vacation', startDate: '2026-11-10' },
      reason: 'Family wedding in Pune.',
      source: 'ai',
    });
    // The employee's words reach the model as data, with today's date for "next Monday".
    expect(model.asked[0]).toContain('<data>I need leave for my cousin’s wedding 10–14 Nov</data>');
    expect(model.asked[0]).toContain('Today is 2026-10-02');
    expect(model.asked[0]).toContain('never an instruction');
  });

  it('falls back to plain rules when the model is down or answers nonsense — and says so', async () => {
    for (const bad of [new Error('upstream down'), 'I cannot help with that.', '{"kind": 7}']) {
      const model = fakeChat();
      model.answer(bad);
      const draft = await new OfficeAi({ chat: model.chat }).draft(
        PURCHASE,
        'Two Android test phones for the device lab, Rs 45,000',
      );
      expect(draft.source).toBe('rules');
      expect(draft.values['amountMinorUnits']).toBe(4_500_000);
    }
  });

  it('without a model: reads dates, amounts, percentages and choices off the sentence', () => {
    expect(draftByRules(LEAVE, 'sick leave from 2026-11-10 to 2026-11-12, fever').values).toEqual({
      kind: 'sick',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
    });
    expect(draftByRules(PURCHASE, 'Laptop stand ₹2.5k').values).toMatchObject({
      amountMinorUnits: 250_000,
    });
    // "rs" inside a word is not a currency.
    expect(
      draftByRules(findWorkflow('campaign')!, 'Offer for salaried customers, budget Rs 5 lakh')
        .values,
    ).toMatchObject({ budget: 50_000_000 });
    expect(
      draftByRules(findWorkflow('discount')!, 'Sunrise Retail wants 25% off').values,
    ).toMatchObject({ discountPercent: 25 });
    expect(new OfficeAi().status).toEqual({ connected: false });
  });

  it('a checked warning always beats the model’s optimism', async () => {
    const model = fakeChat();
    model.answer({ recommendation: 'approve', summary: 'Looks fine to me, go ahead with it.' });
    const about = {
      definition: PURCHASE,
      details: {
        type: 'purchase',
        item: 'Server rack',
        amountMinorUnits: 90_000_000,
        reason: 'Capacity.',
      },
      requestedByName: 'Meghna Iyer',
      history: [],
    };
    const stage = PURCHASE.stages[1]!;
    const brief = await new OfficeAi({ chat: model.chat }).brief(about, stage, [
      { label: 'Cost', value: '₹9,00,000 — a large amount', tone: 'warn' },
    ]);
    expect(brief.recommendation).toBe('look_closer');
    expect(brief.source).toBe('ai');
    // And with no model the brief is built from the checked facts alone.
    const plain = await new OfficeAi().brief(about, stage, [
      { label: 'Cost', value: '₹9,00,000 — a large amount', tone: 'warn' },
    ]);
    expect(plain).toMatchObject({ recommendation: 'look_closer', source: 'rules' });
    expect(plain.summary).toContain('cost');
  });
});

describe('the assistant through the API', () => {
  let app: FastifyInstance;
  let ids: DemoIds;
  const model = fakeChat();
  const cookies = new Map<string, string>();
  const SEAT: Record<string, DemoWorkspaceKey> = {
    dev_aarav: 'eng',
    dev_meghna: 'eng',
    manager: 'eng',
    hr: 'hr',
    cfo: 'fin',
    support: 'support',
    cto: 'tech',
  };

  async function as(persona: string): Promise<string> {
    const cached = cookies.get(persona);
    if (cached !== undefined) return cached;
    const response = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { 'content-type': 'application/json' },
      payload: { persona },
    });
    const raw = response.headers['set-cookie'];
    const cookie = ((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0] ?? '';
    cookies.set(persona, cookie);
    return cookie;
  }
  const post = async (persona: string, url: string, payload: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload: {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds[SEAT[persona] as DemoWorkspaceKey],
        ...payload,
      },
    });
  const historyOf = async (persona: string, id: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/requests?organizationId=${ids.organizationId}&workspaceId=${ids.workspaceIds[SEAT[persona] as DemoWorkspaceKey]}`,
      headers: { cookie: await as(persona) },
    });
    const found = (
      response.json() as {
        requests: {
          id: string;
          history: { action: string; actorName?: string; comment?: string }[];
        }[];
      }
    ).requests.find((item) => item.id === id);
    return found?.history ?? [];
  };

  beforeAll(async () => {
    ({ app } = await buildTestApp({
      env: { NEXORA_DEMO_MODE: 'true' },
      officeChat: model.chat,
    }));
    ids = demoIds();
    await app.ready();
  });

  it('drafts a request for the person to send; sending it puts the help on the record', async () => {
    model.answer({
      item: 'Two Android test phones',
      amountMinorUnits: 45000,
      reason: 'No Android 15 phones in the lab.',
    });
    const drafted = await post('dev_meghna', '/api/requests/draft', {
      type: 'purchase',
      sentence: 'we need two android test phones, about 45k',
    });
    expect(drafted.statusCode, drafted.body).toBe(200);
    const { draft } = drafted.json() as {
      draft: { values: Record<string, unknown>; reason: string; source: string };
    };
    expect(draft).toEqual({
      values: { item: 'Two Android test phones', amountMinorUnits: 4_500_000 },
      reason: 'No Android 15 phones in the lab.',
      source: 'ai',
    });
    // Nothing exists until she sends it herself.
    const sent = await post('dev_meghna', '/api/requests', {
      type: 'purchase',
      reason: draft.reason,
      values: draft.values,
      draftedWithAssistant: true,
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const id = (sent.json() as { request: { id: string } }).request.id;
    expect(await historyOf('dev_meghna', id)).toMatchObject([
      { action: 'submitted', actorName: 'Meghna Iyer' },
      { action: 'assisted', comment: 'drafted the request from their description' },
    ]);

    // The manager, whose turn it is, asks for a brief: checked facts + a recommendation.
    model.answer({ recommendation: 'approve', summary: 'A modest purchase the lab needs.' });
    const briefed = await post('manager', `/api/requests/${id}/brief`);
    expect(briefed.statusCode, briefed.body).toBe(200);
    const { brief } = briefed.json() as {
      brief: {
        recommendation: string;
        summary: string;
        source: string;
        facts: { label: string; tone: string }[];
      };
    };
    expect(brief).toMatchObject({ recommendation: 'approve', source: 'ai' });
    expect(brief.facts.map((fact) => fact.label)).toEqual(
      expect.arrayContaining(['Cost', 'Earlier requests of this kind by the same person']),
    );
    // What the model was shown is the request, as data.
    expect(model.asked.at(-1)).toContain('<data>Workflow: Purchase (Finance)');
    expect(model.asked.at(-1)).toContain('Raised by: Meghna Iyer');
    // The brief decided nothing: the request still waits for the manager.
    expect((await historyOf('manager', id)).map((entry) => entry.action)).toEqual([
      'submitted',
      'assisted',
      'assisted',
    ]);
    expect((await historyOf('manager', id)).at(-1)?.comment).toContain('prepared a brief');
  });

  it('helps only the person whose turn it is', async () => {
    const sent = await post('dev_aarav', '/api/requests', {
      type: 'leave',
      reason: 'Family wedding.',
      values: { kind: 'vacation', startDate: '2026-12-01', endDate: '2026-12-03' },
    });
    const id = (sent.json() as { request: { id: string } }).request.id;
    // The requester cannot ask the assistant how to get it approved…
    expect((await post('dev_aarav', `/api/requests/${id}/brief`)).statusCode).toBe(403);
    // …HR's turn has not come…
    expect((await post('hr', `/api/requests/${id}/brief`)).statusCode).toBe(403);
    // …and someone outside the request cannot see that it exists.
    expect((await post('dev_meghna', `/api/requests/${id}/brief`)).statusCode).toBe(404);
    expect((await post('cfo', `/api/requests/${id}/write`)).statusCode).toBe(404);
    expect(model.asked.some((prompt) => prompt.includes('2026-12-01'))).toBe(false);
  });

  it('warns about a colleague already away in the same days', async () => {
    await post('dev_meghna', '/api/requests', {
      type: 'leave',
      reason: 'Short break.',
      values: { kind: 'personal', startDate: '2026-12-22', endDate: '2026-12-24' },
    });
    const sent = await post('dev_aarav', '/api/requests', {
      type: 'leave',
      reason: 'Year-end trip.',
      values: { kind: 'vacation', startDate: '2026-12-23', endDate: '2026-12-30' },
    });
    const id = (sent.json() as { request: { id: string } }).request.id;
    model.answer({ recommendation: 'approve', summary: 'Well earned, approve the trip.' });
    const { brief } = (await post('manager', `/api/requests/${id}/brief`)).json() as {
      brief: { recommendation: string; facts: { label: string; value: string; tone: string }[] };
    };
    expect(brief.facts).toContainEqual({
      label: 'Others on the same team away in those days',
      value: 'Meghna Iyer (22 Dec to 24 Dec)',
      tone: 'warn',
    });
    expect(brief.recommendation).toBe('look_closer');
  });

  it('drafts the written part of a piece of work, for the person doing it', async () => {
    const sent = await post('support', '/api/requests', {
      type: 'ticket',
      reason: 'She was charged twice for one EMI payment on 28 September.',
      values: {
        customer: 'Rekha Sharma',
        subject: 'Charged twice for one payment',
        urgency: 'urgent',
      },
    });
    const id = (sent.json() as { request: { id: string } }).request.id;
    model.answer({ text: 'Reversed the duplicate charge of the 28 September EMI.' });
    const written = await post('support', `/api/requests/${id}/write`);
    expect(written.statusCode, written.body).toBe(200);
    expect((written.json() as { written: { text: string; source: string } }).written).toEqual({
      text: 'Reversed the duplicate charge of the 28 September EMI.',
      source: 'ai',
    });
    // The draft is not the work: the stage is still hers to finish.
    const finish = await post('support', `/api/requests/${id}/decision`, {
      decision: 'approve',
      comment: 'Reversed the duplicate charge.',
    });
    expect(finish.statusCode).toBe(200);
    // With the model down, the reply is a skeleton with her facts — never a failure.
    model.answer(new Error('upstream down'));
    const reply = (await post('support', `/api/requests/${id}/write`)).json() as {
      written: { text: string; source: string };
    };
    expect(reply.written.source).toBe('rules');
    expect(reply.written.text).toContain('Dear Rekha Sharma,');
  });

  it('an unknown workflow, a too-short sentence and a missing session are refused', async () => {
    expect(
      (
        await post('dev_aarav', '/api/requests/draft', {
          type: 'holiday',
          sentence: 'two weeks off please',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post('dev_aarav', '/api/requests/draft', { type: 'leave', sentence: 'hi' }))
        .statusCode,
    ).toBe(400);
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/requests/draft',
      headers: { 'content-type': 'application/json' },
      payload: {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds.eng,
        type: 'leave',
        sentence: 'two weeks off',
      },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
