/**
 * Test helper: one hire through the REAL office chain over HTTP, with the demo
 * office — the manager asks, the CEO and Finance approve, HR opens the
 * position, interviews and makes the offer, the candidate accepts, HR, IT and
 * the manager onboard them, and the manager puts them on the project.
 */

import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';

import type { DemoIds, DemoWorkspaceKey } from '../src/demo/world.js';

/** What the chain produced. */
export interface HiredThroughChain {
  requisitionId: string;
  openingId: string;
  candidateId: string;
  employeeId: string;
  onboardingId: string;
}

/** Runs the whole chain for `name` and returns the ids it created. */
export async function hireThroughChain(
  app: FastifyInstance,
  ids: DemoIds,
  name: string,
): Promise<HiredThroughChain> {
  const cookies = new Map<string, string>();
  const as = async (persona: string): Promise<string> => {
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
  };
  const post = async <T>(
    persona: string,
    workspace: DemoWorkspaceKey,
    url: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: await as(persona), 'content-type': 'application/json' },
      payload: {
        organizationId: ids.organizationId,
        workspaceId: ids.workspaceIds[workspace],
        ...payload,
      },
    });
    expect(response.statusCode, `${url}: ${response.body}`).toBeLessThan(300);
    return response.json() as T;
  };

  const { requisition } = await post<{ requisition: { id: string } }>(
    'manager',
    'eng',
    '/api/hiring/requisitions',
    {
      jobTitle: 'Senior Backend Developer',
      department: 'Engineering Delivery',
      projectId: ids.projectId,
      headcount: 1,
      employmentType: 'full_time',
      salaryMinMinorUnits: 180_000_000,
      salaryMaxMinorUnits: 240_000_000,
      currency: 'INR',
      justification: 'The mobile banking rebuild needs another engineer.',
      urgency: 'high',
    },
  );
  const decision = `/api/hiring/requisitions/${requisition.id}/decision`;
  await post('ceo', 'eng', decision, { decision: 'approve' });
  await post('cfo', 'fin', decision, { decision: 'approve' });
  const { opening } = await post<{ opening: { id: string } }>(
    'hr',
    'hr',
    '/api/recruiting/openings',
    { requisitionId: requisition.id, description: 'Build and run the banking backend services.' },
  );
  const { candidate } = await post<{ candidate: { id: string } }>(
    'hr',
    'hr',
    `/api/recruiting/openings/${opening.id}/candidates`,
    { name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`, source: 'referral' },
  );
  const base = `/api/recruiting/candidates/${candidate.id}`;
  await post('hr', 'hr', `${base}/advance`);
  await post('hr', 'hr', `${base}/advance`);
  await post('manager', 'eng', `${base}/feedback`, {
    rating: 5,
    recommendation: 'strong_yes',
    notes: 'Excellent system design.',
  });
  await post('hr', 'hr', `${base}/offer`, {
    salaryMinorUnits: 210_000_000,
    startDate: '2026-11-01',
  });
  const { employeeId } = await post<{ employeeId: string }>('hr', 'hr', `${base}/offer/response`, {
    response: 'accept',
  });
  const { onboarding } = await post<{ onboarding: { id: string } }>('hr', 'hr', '/api/onboarding', {
    employeeId,
  });
  const item = (persona: string, workspace: DemoWorkspaceKey, key: string, note?: string) =>
    post(
      persona,
      workspace,
      `/api/onboarding/${onboarding.id}/items/${key}/complete`,
      note === undefined ? {} : { note },
    );
  await item('hr', 'hr', 'paperwork');
  await item('hr', 'hr', 'orientation');
  await item('dev_aarav', 'eng', 'accounts');
  await item('dev_aarav', 'eng', 'equipment');
  await item('manager', 'eng', 'buddy', 'Aarav Kulkarni');
  await post('manager', 'eng', `/api/projects/${ids.projectId}/assignments`, { employeeId });
  return {
    requisitionId: requisition.id,
    openingId: opening.id,
    candidateId: candidate.id,
    employeeId,
    onboardingId: onboarding.id,
  };
}
