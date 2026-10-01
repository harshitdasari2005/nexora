/**
 * Prompt 9 (G7b) — composite workflow tools preflight EVERY inner step's
 * policy decision against the OUTER approval.
 *
 * Organization approval-authority governance (POLICY_APPROVAL_AUTHORITY) that
 * targets an INNER capability (`hr.`) was never applied to the human decision
 * on the unit approval (opened under the OUTER `workflow.` capability). The
 * unit approval must not silently satisfy it: the composite is refused with
 * `WORKFLOW_INNER_APPROVAL_UNCOVERED` before any step runs (nothing created,
 * audited). Baseline BR-13 stays satisfied by the unit approval, and an outer
 * approval that records the same (or stricter) governance covers it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { buildBaseWorld } from '@nexora/evaluation';

import { createScenarioApp, type ScenarioApp } from '../evaluation/harness.js';

const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';
const CHAT = 'Hire Sarah Composite and assign her to the Atlas project';

interface AuditEvent {
  status: string;
  action: string;
  detail?: string;
}

describe('composite workflow: inner approval governance the outer approval does not cover', () => {
  let harness: ScenarioApp | undefined;
  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  async function setup(rules: Record<string, unknown>[]) {
    harness = await createScenarioApp(buildBaseWorld());
    const app = harness;
    const orgId = app.world.organization('aurora').id;
    const wsId = app.world.workspace('aurora-eng').id;
    if (rules.length > 0) {
      await app.repos.policySettings!.append({
        organizationId: orgId,
        policyId: AUTHORITY,
        config: { rules },
        createdBy: app.world.user('meera').id,
      });
    }
    const chat = await app.request('meera', 'POST', '/api/ai/chat', {
      message: CHAT,
      organizationId: orgId,
      workspaceId: wsId,
    });
    const approvalId = /"id":"(apr_[^"]+)"/.exec(chat.body)?.[1];
    if (approvalId === undefined) throw new Error(`no approval opened: ${chat.body}`);
    return { app, orgId, wsId, approvalId };
  }

  const hired = async (app: ScenarioApp, orgId: string) =>
    (await app.repos.employees.listByOrganization(orgId as never)).filter((employee) =>
      employee.name.value.includes('Sarah Composite'),
    );

  async function blocked(app: ScenarioApp, orgId: string, wsId: string): Promise<AuditEvent[]> {
    const response = await app.request(
      'meera',
      'GET',
      `/api/audit/events?organizationId=${orgId}&workspaceId=${wsId}`,
    );
    return (response.json() as { events: AuditEvent[] }).events.filter(
      (event) => event.detail?.includes('WORKFLOW_INNER_APPROVAL_UNCOVERED') === true,
    );
  }

  it('inner separation-of-duties the outer approval did not record: refused, audited, nothing created', async () => {
    const { app, orgId, wsId, approvalId } = await setup([
      { capabilityPrefix: 'hr.', separationOfDuties: true },
    ]);
    // The outer approval was opened WITHOUT separation of duties.
    expect((await app.approvals.byId(approvalId))?.separationOfDuties).toBe(false);
    const decided = await app.request('meera', 'POST', `/api/ai/approvals/${approvalId}/decision`, {
      decision: 'approve',
    });
    expect(decided.statusCode).toBe(200);
    expect(await hired(app, orgId)).toHaveLength(0);
    expect(decided.body).not.toContain('"status":"completed"');
    expect((await blocked(app, orgId, wsId)).length).toBeGreaterThan(0);
  });

  it('inner required approver role the outer approval did not record: refused', async () => {
    const { app, orgId, approvalId } = await setup([
      { capabilityPrefix: 'hr.', requiredApproverRoleId: 'delivery.manager' },
    ]);
    const decided = await app.request('meera', 'POST', `/api/ai/approvals/${approvalId}/decision`, {
      decision: 'approve',
    });
    expect(decided.statusCode).toBe(200);
    expect(await hired(app, orgId)).toHaveLength(0);
  });

  it('control: governance the OUTER approval records too (same rule on the outer prefix) covers the inner step', async () => {
    const { app, orgId, approvalId } = await setup([
      { capabilityPrefix: 'hr.', separationOfDuties: true },
      { capabilityPrefix: 'workflow.', separationOfDuties: true },
    ]);
    expect((await app.approvals.byId(approvalId))?.separationOfDuties).toBe(true);
    // Distinct approver (SoD): the unit approval now covers the inner requirement.
    const decided = await app.request(
      'vikram',
      'POST',
      `/api/ai/approvals/${approvalId}/decision`,
      {
        decision: 'approve',
      },
    );
    expect(decided.statusCode).toBe(200);
    expect(await hired(app, orgId)).toHaveLength(1);
  });

  it('control: no inner governance (baseline BR-13 only) is satisfied by the unit approval', async () => {
    const { app, orgId, approvalId } = await setup([]);
    const decided = await app.request('meera', 'POST', `/api/ai/approvals/${approvalId}/decision`, {
      decision: 'approve',
    });
    expect(decided.statusCode).toBe(200);
    expect(await hired(app, orgId)).toHaveLength(1);
  });
});
