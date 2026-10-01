/**
 * @nexora/app-api — runtime observability state checks (Prompt 7).
 *
 * Every check reads what the REAL runtime persisted (`runtime_runs`) or what
 * the REAL operator HTTP surface returns. Nothing here constructs a metric.
 * Durations are only compared through booleans, never exact values, so a
 * check is deterministic across runs.
 */

import type { ObservedCheck, ScenarioDefinition, StateCheck } from '@nexora/evaluation';
import { findForbiddenKeys, findSecrets, type RuntimeRun } from '@nexora/module-observability';

import { MODEL_FIXTURE_API_KEY, type ScenarioApp } from './harness.js';

type RuntimeCheck = Extract<StateCheck, { kind: 'runtime' }>;
type OperatorCheck = Extract<StateCheck, { kind: 'runtime_operator' }>;

/** The plain text the scenario's requester typed (must never appear in telemetry). */
function utteranceOf(scenario: ScenarioDefinition): string | undefined {
  const request = scenario.request;
  if (request.channel === 'chat') return request.message;
  if (request.channel === 'agent') return request.utterance;
  return undefined;
}

function runMatches(
  run: RuntimeRun,
  check: RuntimeCheck,
  lineageInvocations: ReadonlyMap<string, Set<string>>,
  forbiddenText: readonly string[],
): boolean {
  const tool = run.tools[0];
  const model = run.models[0];
  const present = new Set(run.stages.map((stage) => stage.stage));
  const record = JSON.stringify(run);
  const ordered =
    run.tools.every(
      (call, index) =>
        Number.isFinite(call.durationMs) &&
        call.durationMs >= 0 &&
        (index === 0 || call.startOffsetMs >= (run.tools[index - 1]?.startOffsetMs ?? 0)),
    ) && run.tools.length >= 1;
  return (
    (check.status === undefined || run.status === check.status) &&
    (check.origin === undefined || run.origin === check.origin) &&
    (check.failureStage === undefined || run.failure?.stage === check.failureStage) &&
    (check.failureCode === undefined || run.failure?.code === check.failureCode) &&
    (check.failureClass === undefined || run.failure?.class === check.failureClass) &&
    (check.stagesPresent ?? []).every((stage) => present.has(stage as never)) &&
    (check.stagesAbsent ?? []).every((stage) => !present.has(stage as never)) &&
    (check.toolCalls === undefined || run.tools.length === check.toolCalls) &&
    (check.toolStatus === undefined || tool?.status === check.toolStatus) &&
    (check.toolId === undefined || tool?.toolId === check.toolId) &&
    (check.toolAttempts === undefined || tool?.attempts === check.toolAttempts) &&
    (check.toolRetries === undefined || tool?.retries.length === check.toolRetries) &&
    (check.toolTimed === undefined ||
      ((tool?.durationMs ?? 0) > 0 && (present.has('EXECUTION') || present.has('RETRIEVAL'))) ===
        check.toolTimed) &&
    (check.modelTimed === undefined || (model?.durationMs ?? 0) > 0 === check.modelTimed) &&
    (check.toolsOrdered === undefined || ordered === check.toolsOrdered) &&
    (check.modelCalls === undefined || run.models.length === check.modelCalls) &&
    (check.provider === undefined || model?.provider === check.provider) &&
    (check.execution === undefined || model?.execution === check.execution) &&
    (check.modelStatus === undefined || model?.status === check.modelStatus) &&
    (check.modelErrorCode === undefined || model?.errorCode === check.modelErrorCode) &&
    (check.narrationSource === undefined || model?.narrationSource === check.narrationSource) &&
    (check.usageAvailable === undefined || model?.usageAvailable === check.usageAvailable) &&
    (check.tokensAvailable === undefined || run.tokenUsage.available === check.tokensAvailable) &&
    (check.costNull === undefined || (run.cost.estimated === null) === check.costNull) &&
    (check.promptFingerprints === undefined ||
      (model?.promptTemplateId !== undefined &&
        model.promptVersion !== undefined &&
        model.inputFingerprint !== undefined &&
        (model.status === 'failed' || model.outputFingerprint !== undefined)) ===
        check.promptFingerprints) &&
    (check.approvalState === undefined || run.approval?.state === check.approvalState) &&
    (check.approvalWaitAtLeastMs === undefined ||
      (run.approval?.waitMs ?? -1) >= check.approvalWaitAtLeastMs) &&
    (check.durationBelowApprovalWait === undefined ||
      (run.approval?.waitMs !== undefined && run.durationMs < run.approval.waitMs) ===
        check.durationBelowApprovalWait) &&
    (check.policyOutcome === undefined ||
      run.policies.some((policy) => policy.outcome === check.policyOutcome)) &&
    (check.hasRequestId === undefined || (run.requestId !== undefined) === check.hasRequestId) &&
    (check.correlatedToLineage === undefined ||
      (run.tools.length > 0 &&
        run.tools.every(
          (call) => lineageInvocations.get(run.id)?.has(call.invocationId) === true,
        )) === check.correlatedToLineage) &&
    (check.noSensitive === undefined ||
      (findSecrets(run).length === 0 &&
        findForbiddenKeys(run).length === 0 &&
        !record.includes(MODEL_FIXTURE_API_KEY) &&
        forbiddenText.every((text) => text.length === 0 || !record.includes(text))) ===
        check.noSensitive)
  );
}

/** Counts persisted runtime runs matching every stated attribute. */
export async function evaluateRuntimeCheck(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  check: RuntimeCheck,
): Promise<ObservedCheck> {
  const organizationId = harness.world.organization(check.organization).id;
  const runs = await harness.repos.runtimeRuns!.list(organizationId, { limit: 500 });
  const lineage = await harness.repos.lineage!.list(organizationId);
  const lineageInvocations = new Map<string, Set<string>>();
  for (const record of lineage) {
    if (record.kind === 'EXECUTION' && record.invocationId !== undefined) {
      const set = lineageInvocations.get(record.runId) ?? new Set<string>();
      set.add(record.invocationId);
      lineageInvocations.set(record.runId, set);
    }
  }
  const utterance = utteranceOf(scenario);
  const matched = runs.filter((run) =>
    runMatches(run, check, lineageInvocations, utterance === undefined ? [] : [utterance]),
  );
  const attrs = Object.entries(check)
    .filter(
      ([key, value]) =>
        !['kind', 'organization', 'equals', 'atLeast'].includes(key) && value !== undefined,
    )
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('|') : String(value)}`)
    .join(' ');
  const actual = matched.length;
  return {
    description: `runtime runs${attrs === '' ? '' : ` [${attrs}]`} ${check.equals !== undefined ? `count = ${check.equals}` : `count >= ${check.atLeast ?? 1}`}`,
    passed: check.equals !== undefined ? actual === check.equals : actual >= (check.atLeast ?? 1),
    actual,
  };
}

/** What an operator sees over the real HTTP surface. */
export async function evaluateOperatorCheck(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  check: OperatorCheck,
): Promise<ObservedCheck> {
  const world = harness.world;
  const target = world.organization(check.organization);
  const reader = world.organization(check.readerOrganization);
  const readerWorkspaceId = world.workspace(reader.auditor.workspace).id;
  const scope = `organizationId=${reader.id}&workspaceId=${readerWorkspaceId}`;
  const targetRuns = await harness.repos.runtimeRuns!.list(target.id, { limit: 500 });
  const description = `operator ${check.assert}${check.tool === undefined ? '' : ` [tool=${check.tool}]`}`;

  if (check.assert === 'list_hides_foreign') {
    const response = await harness.request(
      reader.auditor.user,
      'GET',
      `/api/ops/runtime/runs?${scope}&limit=200`,
    );
    const visible = new Set(
      ((response.json() as { runs?: { id: string }[] }).runs ?? []).map((run) => run.id),
    );
    const leaked = targetRuns.filter((run) => visible.has(run.id)).length;
    const targetWorkspace = world.world.workspaces.find(
      (w) => w.organization === check.organization,
    );
    const forged = await harness.request(
      reader.auditor.user,
      'GET',
      `/api/ops/runtime/runs?organizationId=${target.id}&workspaceId=${targetWorkspace === undefined ? '' : world.workspace(targetWorkspace.key).id}`,
    );
    const passed =
      response.statusCode === 200 &&
      targetRuns.length > 0 &&
      leaked === 0 &&
      forged.statusCode === 403;
    return {
      description,
      passed,
      actual: `leaked=${leaked} target=${targetRuns.length} forged=${forged.statusCode}`,
    };
  }

  if (check.assert === 'detail_not_found') {
    const foreign = targetRuns[0];
    const foreignResponse = await harness.request(
      reader.auditor.user,
      'GET',
      `/api/ops/runtime/runs/${foreign?.id ?? 'none'}?${scope}`,
    );
    const missingResponse = await harness.request(
      reader.auditor.user,
      'GET',
      `/api/ops/runtime/runs/run_00000000-0000-0000-0000-000000000000?${scope}`,
    );
    const shape = (body: unknown): unknown => {
      const error = (body as { error?: { code?: string; message?: string } }).error;
      return { code: error?.code, message: error?.message };
    };
    const passed =
      foreign !== undefined &&
      foreignResponse.statusCode === 404 &&
      missingResponse.statusCode === 404 &&
      JSON.stringify(shape(foreignResponse.json())) ===
        JSON.stringify(shape(missingResponse.json()));
    return {
      description,
      passed,
      actual: `${foreignResponse.statusCode}/${missingResponse.statusCode}`,
    };
  }

  const newest = targetRuns[0];
  const detail = await harness.request(
    reader.auditor.user,
    'GET',
    `/api/ops/runtime/runs/${newest?.id ?? 'none'}?${scope}`,
  );
  if (check.assert === 'detail_safe') {
    const body = detail.body;
    const list = await harness.request(
      reader.auditor.user,
      'GET',
      `/api/ops/runtime/runs?${scope}&limit=50`,
    );
    const utterance = utteranceOf(scenario);
    const unsafe = [detail.body, list.body].some(
      (text) =>
        findSecrets(JSON.parse(text)).length > 0 ||
        findForbiddenKeys(JSON.parse(text)).length > 0 ||
        text.includes(MODEL_FIXTURE_API_KEY) ||
        (utterance !== undefined && text.includes(utterance)),
    );
    return {
      description,
      passed: newest !== undefined && detail.statusCode === 200 && body.length > 0 && !unsafe,
      actual: unsafe ? 'sensitive content present' : `status=${detail.statusCode}`,
    };
  }
  const bottleneck = (detail.json() as { bottleneck?: { tool?: { toolId?: string } } }).bottleneck;
  return {
    description,
    passed: detail.statusCode === 200 && bottleneck?.tool?.toolId === check.tool,
    actual: bottleneck?.tool?.toolId ?? `status=${detail.statusCode}`,
  };
}
