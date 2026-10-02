/**
 * POLICY_HIRING_CHANNEL at the API boundary: an organization that hires
 * through hiring requests turns the policy on from policy administration, and
 * from then on asking the assistant to hire someone directly is refused —
 * before any approval is opened, and even for a request that was already
 * waiting for approval when the policy was turned on.
 */

import { describe, expect, it } from 'vitest';

import type { FakeEmployeeRepository } from './fakes.js';
import {
  chatClient,
  onboardOrgAndWorkspace,
  parseSse,
  seedProject,
  type ChatClient,
} from './helpers.js';

const POLICY = 'POLICY_HIRING_CHANNEL';
const HIRE_TOOL = 'workflow.hire_and_assign_employee';

interface Done {
  status: string;
  response: string;
  steps: { capabilityId: string; status: string; errorCode?: string }[];
  approvals: { id?: string; status: string }[];
}

async function chat(client: ChatClient, workspaceId: string, message: string): Promise<Done> {
  const raw = await client.post('/api/ai/chat', { message, workspaceId });
  expect(raw.statusCode).toBe(200);
  return parseSse(raw.body as string).find((event) => event.event === 'done')?.data as Done;
}
const employeeNames = (client: ChatClient): string[] =>
  [...(client.repos.employees as FakeEmployeeRepository).employees.values()].map(
    (employee) => employee.name.value,
  );

async function office(): Promise<{
  client: ChatClient;
  organizationId: string;
  workspaceId: string;
  setPolicy: (body: Record<string, unknown>) => ReturnType<ChatClient['post']>;
}> {
  const client = await chatClient();
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
  await seedProject(client.repos, {
    id: 'prj_12345678-1234-1234-1234-123456789012',
    organizationId,
    name: 'Mobile Banking',
    status: 'active',
  });
  return {
    client,
    organizationId,
    workspaceId,
    setPolicy: (body) =>
      client.post(
        `/api/policy/policies/${POLICY}/versions?organizationId=${organizationId}&workspaceId=${workspaceId}`,
        body,
      ),
  };
}

describe('POLICY_HIRING_CHANNEL — hiring goes through a hiring request', () => {
  it('is off until the organization turns it on: the direct hire is still an approval-gated action', async () => {
    const { client, workspaceId, organizationId } = await office();
    const list = await client.get(
      `/api/policy/policies?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    const entry = (
      list.json() as { policies: { policyId: string; configurable: boolean; enabled: boolean }[] }
    ).policies.find((policy) => policy.policyId === POLICY);
    expect(entry).toMatchObject({ configurable: true, enabled: false });

    const done = await chat(
      client,
      workspaceId,
      'Hire Sarah and assign her to the Mobile Banking project',
    );
    expect(done.status).toBe('blocked');
    expect(done.approvals[0]?.status).toBe('pending');
  });

  it('accepts exactly one setting', async () => {
    const { setPolicy } = await office();
    for (const config of [{ directHire: 'allow' }, { directHire: 'deny', also: 1 }, {}]) {
      // Refused as invalid (never stored): a validation error, not a new version.
      expect([400, 422], JSON.stringify(config)).toContain(
        (await setPolicy({ config })).statusCode,
      );
    }
    expect((await setPolicy({ config: { directHire: 'deny' } })).statusCode).toBe(201);
  });

  it('once on, the assistant refuses a direct hire before any approval exists, and says why', async () => {
    const { client, workspaceId, setPolicy } = await office();
    expect((await setPolicy({ config: { directHire: 'deny' } })).statusCode).toBe(201);

    const done = await chat(
      client,
      workspaceId,
      'Hire Sarah and assign her to the Mobile Banking project',
    );
    expect(done.status).toBe('failed');
    expect(done.approvals).toEqual([]);
    expect(done.steps).toMatchObject([
      { capabilityId: HIRE_TOOL, status: 'failed', errorCode: 'POLICY_DENIED' },
    ]);
    expect(done.response).toContain('goes through a hiring request');
    expect(employeeNames(client)).not.toContain('Sarah');
  });

  it('a hire that was already waiting for approval cannot be pushed through afterwards', async () => {
    const { client, workspaceId, setPolicy } = await office();
    const waiting = await chat(
      client,
      workspaceId,
      'Hire Sarah and assign her to the Mobile Banking project',
    );
    const approvalId = waiting.approvals[0]?.id;
    expect(approvalId).toMatch(/^apr_/);

    expect((await setPolicy({ config: { directHire: 'deny' } })).statusCode).toBe(201);
    await client.post(`/api/ai/approvals/${approvalId}/decision`, { decision: 'approve' });
    expect(employeeNames(client)).not.toContain('Sarah');
  });

  it('turning it off again restores the previous behaviour', async () => {
    const { client, workspaceId, setPolicy } = await office();
    expect((await setPolicy({ config: { directHire: 'deny' } })).statusCode).toBe(201);
    expect((await setPolicy({ enabled: false, expectedVersion: 1 })).statusCode).toBe(201);
    const done = await chat(
      client,
      workspaceId,
      'Hire Sarah and assign her to the Mobile Banking project',
    );
    expect(done.status).toBe('blocked');
  });
});
