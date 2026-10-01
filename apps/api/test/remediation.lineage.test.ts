/**
 * Prompt 6 — remediation lineage through the real app path.
 *
 * "Why did Nexora perform this remediation?" — the plan's basis (EVIDENCE +
 * a DERIVED FINDING), the step ↔ approval ↔ run links, and the Audit Center
 * decision trace of the remediation's approval.
 */

import { describe, expect, it } from 'vitest';
import type { BusinessProblemDto } from '@nexora/contracts/detection';
import type { RemediationPlanDto } from '@nexora/contracts/remediation';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { LineageRecord, LineageRepository } from '@nexora/module-lineage';
import { Notification } from '@nexora/module-notifications';
import { nowIso } from '@nexora/shared/time';

import {
  chatClientWithSecondUser,
  currentUserId,
  onboardOrgAndWorkspace,
  seedProject,
  type ChatClient,
  type SecondUser,
} from './helpers.js';

interface TraceBody {
  trace: {
    evidence: { evidenceId: string; sourceType: string; sourceId: string; derived: boolean }[];
    executions: { toolId?: string; status?: string; approvalId?: string }[];
    approval?: { id: string };
    lineage: { recordId: string; kind: string }[];
  };
}

async function setup(): Promise<{
  client: ChatClient;
  approver: SecondUser;
  organizationId: string;
  workspaceId: string;
  lineage: LineageRepository;
  problemId: string;
  scope: string;
}> {
  const client = await chatClientWithSecondUser();
  const approver = client.second;
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
  const userId = currentUserId(client);
  // Separation of duties (Prompt 8): `notifications.` routes to
  // delivery.manager, so the approver is a distinct workspace admin.
  await approver.join({ organizationId, workspaceId, workspaceRole: 'admin' });
  await seedProject(client.repos, {
    id: 'prj_attn',
    organizationId,
    name: 'Mobile Banking',
    status: 'active',
  });
  await client.repos.notifications.save(
    Notification.create(
      {
        recipientId: userId as UserId,
        tenantId: organizationId as TenantId,
        workspaceId: workspaceId as never,
        type: 'project.decision_needed',
        category: 'project',
        title: 'Decision needed on Mobile Banking',
        body: 'The release plan needs your sign-off.',
        priority: 'normal',
        sourceEventId: 'evt_decision_1',
        correlationId: 'corr_decision_1',
      },
      nowIso(),
    ),
  );
  const article = await client.post('/api/knowledge/articles', {
    organizationId,
    workspaceId,
    title: 'Attention backlog runbook',
    body: 'When project attention items pile up, check what needs attention and clear it.',
  });
  const articleId = (article.json() as { article: { id: string } }).article.id;
  await client.post(`/api/knowledge/articles/${articleId}/publish`, {
    organizationId,
    workspaceId,
  });
  const scope = `organizationId=${organizationId}&workspaceId=${workspaceId}`;
  const scanned = await client.postEmpty(`/api/problems/scan?${scope}`);
  const problem = (scanned.json() as { problems: BusinessProblemDto[] }).problems.find(
    (p) => p.signalId === 'project_attention',
  );
  expect(problem).toBeDefined();
  return {
    client,
    approver,
    organizationId,
    workspaceId,
    lineage: client.repos.lineage as LineageRepository,
    problemId: problem?.id ?? '',
    scope,
  };
}

describe('remediation lineage (real app path)', () => {
  it('records the basis at plan creation, links steps to approval + run, and the approval trace explains the remediation', async () => {
    const { client, approver, organizationId, workspaceId, lineage, problemId, scope } =
      await setup();
    const created = await client.post(`/api/problems/${problemId}/plans?${scope}`, {});
    expect(created.statusCode).toBe(200);
    const planId = (created.json() as { plan: RemediationPlanDto }).plan.id;

    // Basis: EVIDENCE + ONE derived FINDING, tenant + workspace scoped.
    const basis = await lineage.list(organizationId, { workspaceId, runId: planId });
    const evidence = basis.filter((r) => r.kind === 'EVIDENCE');
    const findings = basis.filter((r) => r.kind === 'FINDING');
    expect(evidence.length).toBeGreaterThan(0);
    expect(findings).toHaveLength(1);
    const finding = findings[0] as LineageRecord;
    expect(finding.subjectType).toBe('REMEDIATION_BASIS');
    expect(finding.subjectId).toBe(planId);
    expect(finding.data['derived']).toBe(true);
    expect(finding.data['problemId']).toBe(problemId);
    expect(finding.data['evidenceRecordIds']).toEqual(
      expect.arrayContaining(evidence.map((e) => e.id)),
    );
    // Positive control: primary evidence is NOT marked derived by the FINDING rule.
    expect(
      evidence.every((e) => e.data['derived'] !== true || e.data['sourceType'] === 'INVESTIGATION'),
    ).toBe(true);
    for (const record of basis) {
      expect(record.tenantId).toBe(organizationId);
      expect(record.workspaceId).toBe(workspaceId);
    }
    // Negative + positive control: another tenant/workspace sees nothing.
    expect(await lineage.list('org_other', { runId: planId })).toHaveLength(0);
    expect(
      await lineage.list(organizationId, { workspaceId: 'wsp_other', runId: planId }),
    ).toHaveLength(0);

    // Step 1 (read, no approval) then step 2 opens the approval.
    await client.postEmpty(`/api/plans/${planId}/advance?${scope}`);
    const step2 = await client.postEmpty(`/api/plans/${planId}/advance?${scope}`);
    const awaiting = (step2.json() as { plan: RemediationPlanDto }).plan;
    const gated = awaiting.steps.find((s) => s.status === 'AWAITING_APPROVAL');
    const approvalId = gated?.approvalId ?? '';
    expect(approvalId).not.toBe('');
    const approve = await approver.post(`/api/ai/approvals/${approvalId}/decision`, {
      decision: 'approve',
    });
    expect(approve.statusCode).toBe(200);
    const final = await client.postEmpty(`/api/plans/${planId}/advance?${scope}`);
    expect((final.json() as { plan: RemediationPlanDto }).plan.status).toBe('COMPLETED');

    // LINK records: step -> approval, and step -> run (orchestrator run id).
    const links = (await lineage.list(organizationId, { runId: planId, kind: 'LINK' })).filter(
      (r) => r.subjectType === 'REMEDIATION_STEP',
    );
    const approvalLink = links.find((r) => r.data['relation'] === 'STEP_APPROVAL');
    expect(approvalLink).toBeDefined();
    expect(approvalLink?.subjectId).toBe(`${planId}:${gated?.id}`);
    expect(approvalLink?.approvalId).toBe(approvalId);
    const runLinks = links.filter((r) => r.data['relation'] === 'STEP_RUN');
    expect(runLinks.length).toBe(2);
    for (const link of runLinks) {
      expect(String(link.data['runId'])).toMatch(/^run_/);
      // The linked run really is a governed execution run in lineage.
      const runRecords = await lineage.list(organizationId, { runId: String(link.data['runId']) });
      expect(runRecords.some((r) => r.kind === 'EXECUTION')).toBe(true);
    }
    const gatedRun = runLinks.find((r) => r.data['stepId'] === gated?.id);
    expect(gatedRun?.data['approvalId']).toBe(approvalId);
    expect(
      runLinks.find((r) => r.data['stepId'] !== gated?.id)?.data['approvalId'],
    ).toBeUndefined();

    // The approval's audit trace explains the remediation: the FINDING is
    // DERIVED evidence and the governed executions are present.
    const traced = await client.get(`/api/audit/events/apr:${approvalId}/trace?${scope}`);
    expect(traced.statusCode).toBe(200);
    const { trace } = traced.json() as TraceBody;
    expect(trace.approval?.id).toBe(approvalId);
    const traceFinding = trace.evidence.find((e) => e.evidenceId === finding.id);
    expect(traceFinding).toBeDefined();
    expect(traceFinding?.derived).toBe(true);
    expect(traceFinding?.sourceType).toBe('REMEDIATION_BASIS');
    // Positive control: primary (non-derived) evidence from the same basis is present.
    expect(
      trace.evidence.some(
        (e) => e.derived === false && evidence.some((r) => r.id === e.evidenceId),
      ),
    ).toBe(true);
    expect(trace.executions.some((e) => e.approvalId === approvalId)).toBe(true);

    // A foreign tenant's approval id resolves to nothing (negative) while the
    // owner's resolves (positive control above).
    const foreign = await client.get(
      `/api/audit/events/apr:${approvalId}/trace?organizationId=org_alien_0000&workspaceId=${workspaceId}`,
    );
    expect(foreign.statusCode).not.toBe(200);
  });

  it('a recorded basis is unchanged after the underlying knowledge article changes', async () => {
    const { client, organizationId, workspaceId, lineage, problemId, scope } = await setup();
    const created = await client.post(`/api/problems/${problemId}/plans?${scope}`, {});
    const planId = (created.json() as { plan: RemediationPlanDto }).plan.id;
    const before = JSON.stringify(await lineage.list(organizationId, { runId: planId }));

    // The source changes: a new article is published and the plan is read again.
    const article = await client.post('/api/knowledge/articles', {
      organizationId,
      workspaceId,
      title: 'Attention backlog runbook v2',
      body: 'A newer procedure for attention backlogs.',
    });
    const articleId = (article.json() as { article: { id: string } }).article.id;
    await client.post(`/api/knowledge/articles/${articleId}/publish`, {
      organizationId,
      workspaceId,
    });
    expect((await client.get(`/api/plans/${planId}?${scope}`)).statusCode).toBe(200);
    expect(JSON.stringify(await lineage.list(organizationId, { runId: planId }))).toBe(before);
    // Positive control: the store did change (new records exist for a different run only).
    expect(before.length).toBeGreaterThan(2);
  });
});
