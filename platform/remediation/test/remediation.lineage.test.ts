/**
 * Prompt 6 — remediation evidence provenance + lineage.
 *
 * The plan-time EVIDENCE + derived FINDING records are the append-only
 * historical basis of the decision; steps link to approvals and governed
 * runs. Evidence informs — it never gates anything.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryLineageRepository, fingerprintOf } from '@nexora/module-lineage';
import type { BusinessProblemDto } from '@nexora/contracts/detection';

import { buildService, completedOutcome, FakeExecutionPort, problemFixture } from './helpers.js';
import type { RemediationAgent } from '../src/application/remediation-ports.js';

const context = { userId: 'usr_alex', tenantId: 'org_a', workspaceId: 'wsp_1' };
const executive: RemediationAgent = {
  id: 'executive',
  roleId: 'executive.ceo',
  domainId: 'executive',
  capabilityIds: ['projects.find_project', 'calendar.create_event'],
};

function richProblem(): BusinessProblemDto {
  return problemFixture({
    evidence: [
      { id: 'evd_1', source: 'measurements', fact: 'wf_auth failed 6 times.' },
      {
        id: 'evd_2',
        source: 'projects',
        entityType: 'project',
        entityId: 'prj_9',
        entityTitle: 'Apollo',
        fact: 'Project Apollo is late.',
      },
      {
        id: 'evd_3',
        source: 'knowledge',
        entityId: 'kn_1',
        entityTitle: 'AUTH-017',
        fact: 'AUTH-017 describes the fix.',
      },
    ],
  });
}

describe('remediation lineage', () => {
  it('records EVIDENCE + one derived FINDING at plan creation, scoped to the tenant/workspace', async () => {
    const lineage = new InMemoryLineageRepository();
    const problems = new Map([['prb_1', richProblem()]]);
    const { service } = buildService({ agent: executive, problems, lineage });
    const created = await service.createPlan(context, { problemId: 'prb_1' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const planId = created.plan.id;

    const records = await lineage.list('org_a', { workspaceId: 'wsp_1', runId: planId });
    const evidence = records.filter((r) => r.kind === 'EVIDENCE');
    const findings = records.filter((r) => r.kind === 'FINDING');
    // 3 problem evidence items + the grounding solution's source article.
    expect(evidence).toHaveLength(4);
    expect(findings).toHaveLength(1);
    const types = evidence.map((r) => `${r.subjectType}:${r.subjectId}`);
    expect(types).toContain('PROJECT:prj_9');
    expect(types).toContain('KNOWLEDGE_ARTICLE:kn_1');
    expect(evidence.some((r) => r.subjectType === 'INVESTIGATION')).toBe(true);
    const investigation = evidence.find((r) => r.subjectType === 'INVESTIGATION');
    expect(investigation?.data['derived']).toBe(true);
    expect(investigation?.data['trust']).toBe('SYSTEM_STATE');
    const project = evidence.find((r) => r.subjectType === 'PROJECT');
    expect(project?.data['derived']).toBeUndefined();
    expect(project?.data['trust']).toBe('PERSISTED_BUSINESS_RECORD');
    expect(project?.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const finding = findings[0]!;
    expect(finding.subjectType).toBe('REMEDIATION_BASIS');
    expect(finding.subjectId).toBe(planId);
    expect(finding.data['derived']).toBe(true);
    expect(finding.data['problemId']).toBe('prb_1');
    expect(finding.data['signalId']).toBe('workflow_failure');
    expect(finding.data['groundedSolutionId']).toBe('sol_1');
    expect([...(finding.data['evidenceRecordIds'] as string[])].sort()).toEqual(
      evidence.map((r) => r.id).sort(),
    );
    expect(finding.data['evidenceFingerprint']).toBe(
      fingerprintOf(evidence.map((r) => r.fingerprint as string).sort()),
    );
    // Scope: every record carries tenant + workspace; another tenant sees none.
    for (const record of records) {
      expect(record.tenantId).toBe('org_a');
      expect(record.workspaceId).toBe('wsp_1');
    }
    expect(await lineage.list('org_b', { runId: planId })).toHaveLength(0);
    expect(await lineage.list('org_a', { workspaceId: 'wsp_other', runId: planId })).toHaveLength(
      0,
    );
  });

  it('records nothing and changes nothing when lineage is absent (positive control: present)', async () => {
    const withoutLineage = buildService({ agent: executive });
    const created = await withoutLineage.service.createPlan(context, { problemId: 'prb_1' });
    expect(created.ok).toBe(true);
    const lineage = new InMemoryLineageRepository();
    const withLineage = buildService({ agent: executive, lineage });
    const created2 = await withLineage.service.createPlan(context, { problemId: 'prb_1' });
    expect(created2.ok).toBe(true);
    if (!created2.ok) return;
    expect((await lineage.list('org_a', { runId: created2.plan.id })).length).toBeGreaterThan(0);
  });

  it('links step -> approval -> governed run with the orchestrator run id', async () => {
    const lineage = new InMemoryLineageRepository();
    const execution = new FakeExecutionPort();
    execution.outcomes.push(
      completedOutcome({ runId: 'run_read' }),
      completedOutcome({ runId: 'run_calendar' }),
    );
    const { service, approvals, recorder, reevaluator } = buildService({
      agent: executive,
      lineage,
      execution,
    });
    const created = await service.createPlan(context, { problemId: 'prb_1' });
    if (!created.ok) throw new Error('plan');
    const planId = created.plan.id;
    await service.advance(context, planId); // read step
    const waiting = await service.advance(context, planId); // opens approval
    if (!waiting.ok) throw new Error('advance');
    const gated = waiting.plan.steps[1]!;
    const approvalId = gated.approvalId!;
    [...approvals.requests.values()].find((r) => r.id === approvalId)!.status = 'granted';
    reevaluator.stillPresent.set('prb_1', false);
    await service.advance(context, planId);

    const links = (await lineage.list('org_a', { runId: planId, kind: 'LINK' })).map(
      (r) => r.data as Record<string, unknown>,
    );
    const approvalLink = links.find((d) => d['relation'] === 'STEP_APPROVAL');
    expect(approvalLink).toMatchObject({ planId, stepId: gated.id, approvalId });
    const runLinks = links.filter((d) => d['relation'] === 'STEP_RUN');
    expect(runLinks.map((d) => d['runId'])).toEqual(['run_read', 'run_calendar']);
    const calendarRun = runLinks.find((d) => d['stepId'] === gated.id);
    expect(calendarRun).toMatchObject({ approvalId, problemId: 'prb_1', runId: 'run_calendar' });
    // The ungated read step's run link has no approval (positive control above).
    expect(runLinks.find((d) => d['stepId'] !== gated.id)?.['approvalId']).toBeUndefined();
    // Records are addressable by step and by approval.
    const byStep = await lineage.list('org_a', {
      subjectType: 'REMEDIATION_STEP',
      subjectId: `${planId}:${gated.id}`,
    });
    expect(byStep).toHaveLength(2);
    expect((await lineage.list('org_a', { approvalId })).length).toBe(2);
    // The journal now carries the approval id for the gated step only.
    const journal = recorder.records as { stepId: string; approvalId?: string }[];
    expect(journal.find((r) => r.stepId === gated.id)?.approvalId).toBe(approvalId);
    expect(journal.find((r) => r.stepId !== gated.id)?.approvalId).toBeUndefined();
  });

  it('journals delegation ids from the outcome steps', async () => {
    const execution = new FakeExecutionPort();
    execution.outcomes.push(
      completedOutcome({
        steps: [
          {
            stepId: 's1',
            capabilityId: 'projects.find_project',
            toolId: 't',
            status: 'succeeded',
            verified: true,
            delegationId: 'dlg_1',
          },
        ],
      }),
    );
    const { service, recorder } = buildService({ agent: executive, execution });
    const created = await service.createPlan(context, { problemId: 'prb_1' });
    if (!created.ok) throw new Error('plan');
    await service.advance(context, created.plan.id);
    expect((recorder.records[0] as { delegationIds?: string[] }).delegationIds).toEqual(['dlg_1']);
  });

  it('the recorded evidence is unchanged after the underlying source changes, and a replan appends (never rewrites)', async () => {
    const lineage = new InMemoryLineageRepository();
    const problems = new Map([['prb_1', richProblem()]]);
    const { service } = buildService({ agent: executive, problems, lineage });
    const created = await service.createPlan(context, { problemId: 'prb_1' });
    if (!created.ok) throw new Error('plan');
    const planId = created.plan.id;
    const before = await lineage.list('org_a', { runId: planId });
    const beforeSnapshot = JSON.stringify(before);

    // The live evidence + article change AFTER the plan was created.
    const changed = richProblem();
    problems.set('prb_1', {
      ...changed,
      evidence: [
        { id: 'evd_1', source: 'measurements', fact: 'wf_auth failed 60 times.' },
        {
          id: 'evd_3',
          source: 'knowledge',
          entityId: 'kn_1',
          entityTitle: 'AUTH-017 v2',
          fact: 'AUTH-017 was re-indexed with a new version.',
        },
      ],
    });
    // Reading the plan back recomputes the live problem, but not the record.
    await service.getById(context, planId);
    expect(JSON.stringify(await lineage.list('org_a', { runId: planId }))).toBe(beforeSnapshot);

    // Positive control: a replan sees the NEW evidence and appends NEW records,
    // leaving the originals byte-identical.
    const replanned = await service.replan(context, planId);
    expect(replanned.ok).toBe(true);
    const after = await lineage.list('org_a', { runId: planId });
    expect(after.length).toBeGreaterThan(before.length);
    expect(JSON.stringify(after.slice(0, before.length))).toBe(beforeSnapshot);
    const findings = after.filter((r) => r.kind === 'FINDING');
    expect(findings).toHaveLength(2);
    expect(findings[0]!.data['evidenceFingerprint']).not.toBe(
      findings[1]!.data['evidenceFingerprint'],
    );
    expect(findings[1]!.data['trigger']).toBe('REPLAN');
  });
});
