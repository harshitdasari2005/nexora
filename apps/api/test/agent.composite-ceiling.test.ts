/**
 * Prompt 9 (G2a) — an AGENT-opened composite approval resumes under the
 * agent's own effective capabilities ∩ the requester's, never the requester's
 * full set. The human's approval authorizes the unit as requested; it cannot
 * widen what the agent principal may do (an agent delegated ONLY the composite
 * cannot hire/assign through it). Every refusal has a positive control.
 */

import { describe, expect, it } from 'vitest';
import type { FakeEmployeeRepository } from './fakes.js';
import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  parseSse,
  provisionAgent,
  seedProject,
  type ChatClient,
} from './helpers.js';

const COMPOSITE = 'workflow.hire_and_assign_employee';
const INNER = ['hr.create_employee', 'projects.find_project', 'projects.assign_employee'];
const UTTERANCE = 'Hire Sarah and assign her to the Mobile Banking project';

const employees = (client: ChatClient) =>
  (client.repos.employees as FakeEmployeeRepository).employees;

async function agentRun(delegations: readonly string[]) {
  const client = await chatClient();
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
  await seedProject(client.repos, {
    id: 'prj_12345678-1234-1234-1234-123456789012',
    organizationId,
    name: 'Mobile Banking',
    status: 'active',
  });
  const { agentId } = await provisionAgent(client.repos, {
    organizationId,
    workspaceId,
    definitionId: 'manager',
    grantedBy: currentUserId(client),
    capabilityIds: delegations,
  });
  const run = await client.post(
    `/api/agents/${agentId}/execute?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    { utterance: UTTERANCE },
  );
  expect(run.statusCode).toBe(200);
  const { outcome } = run.json() as { outcome: { approvals?: { id?: string }[] } };
  const approvalId = outcome.approvals?.[0]?.id;
  return { client, approvalId, agentId };
}

describe('agent-run composite approval: the resume ceiling is agent ∩ requester', () => {
  it('an agent delegated ONLY the composite: the human approves, nothing is created', async () => {
    const { client, approvalId } = await agentRun([COMPOSITE]);
    expect(approvalId).toMatch(/^apr_/);
    const decision = await client.post(`/api/ai/approvals/${approvalId}/decision`, {
      decision: 'approve',
    });
    expect(decision.statusCode).toBe(200);
    const done = parseSse(decision.body as string).find((e) => e.event === 'done')?.data as {
      status: string;
      steps: { status: string }[];
    };
    expect(done.steps.some((step) => step.status === 'completed')).toBe(false);
    // The requester (a CEO) COULD hire; the agent's effective capabilities cannot — nothing exists.
    expect(employees(client).size).toBe(0);
    await client.app.close();
  });

  it('the inner capabilities are outside every agent definition: delegating them changes nothing', async () => {
    const { client, approvalId } = await agentRun([COMPOSITE, ...INNER]);
    expect(approvalId).toMatch(/^apr_/);
    const decision = await client.post(`/api/ai/approvals/${approvalId}/decision`, {
      decision: 'approve',
    });
    expect(decision.statusCode).toBe(200);
    expect(employees(client).size).toBe(0);
    await client.app.close();
  });

  it('control: the SAME request through the human chat path (no agent) is unchanged and completes', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });
    const raw = await client.post('/api/ai/chat', { message: UTTERANCE, workspaceId });
    const done = parseSse(raw.body as string).find((e) => e.event === 'done')?.data as {
      approvals: { id?: string }[];
    };
    const decision = await client.post(`/api/ai/approvals/${done.approvals[0]?.id}/decision`, {
      decision: 'approve',
    });
    expect(decision.statusCode).toBe(200);
    expect(employees(client).size).toBe(1);
    await client.app.close();
  });
});
