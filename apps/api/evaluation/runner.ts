/**
 * @nexora/app-api — the scenario runner.
 *
 * Drives ONE scenario through the real API surface of a freshly built,
 * freshly seeded {@link ScenarioApp} and records a {@link ScenarioObservation}:
 *
 *   precheck (every membership resolves its expected business role via
 *   GET /api/role-context) → request (chat | remediation | REST) → approval
 *   decision (when declared) → post-condition checks over persisted state →
 *   Audit Center read-back (GET /api/audit/events as each organization's
 *   auditor).
 *
 * The runner OBSERVES; it never judges. Evaluation against expectations is
 * the pure `evaluateScenario` in @nexora/evaluation. Each scenario gets its
 * own app instance, so scenarios are isolated and order-independent.
 */

import { performance } from 'node:perf_hooks';
import type { LightMyRequestResponse } from 'fastify';
import {
  buildReport,
  evaluateScenario,
  validateDataset,
  validateScenario,
  type EvaluationReport,
  type ObservedApproval,
  type ObservedAuditEvent,
  type ObservedCheck,
  type ObservedReference,
  type ObservedStep,
  type ObservedTiming,
  type ScenarioDataset,
  type ScenarioDefinition,
  type ScenarioObservation,
  type ScenarioResult,
  type StateCheck,
  type WorldIndex,
} from '@nexora/evaluation';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { evaluateOperatorCheck, evaluateRuntimeCheck } from './runtime-checks.js';
import { evaluateGovernanceCheck, type StepOutcome } from './governance-checks.js';
import { evaluateLifecycleCheck } from './lifecycle-checks.js';
import { runInvokeTool, runStartWorkflow } from './closure-steps.js';
import { firstWorkflowStepEvent, workflowTraceFailures } from './trace-checks.js';
import { createScenarioApp, type ScenarioApp, type ScenarioAppOptions } from './harness.js';

/** Options of a run. */
export interface RunOptions extends ScenarioAppOptions {
  /** Only run these scenario ids (default: all). */
  only?: readonly string[];
}

/** A mutable observation under construction. */
interface Draft {
  authorization: ScenarioObservation['authorization'];
  runStatus?: string;
  plannedSteps: ObservedStep[];
  finalSteps: ObservedStep[];
  approvals: ObservedApproval[];
  decision?: ScenarioObservation['decision'];
  retrieval?: ObservedReference[];
  response?: string;
  groundingContext: string[];
  verification: ObservedCheck[];
  audit: ObservedAuditEvent[];
  timings: ObservedTiming[];
  errors: string[];
  /** Remediation state for plan/problem checks. */
  plan?: RemediationPlan;
  problemIds: Map<string, string>;
  /** Recorded outcomes of `http` / `decide` lifecycle steps, by label. */
  outcomes: Map<string, StepOutcome>;
  /** The scenario's organization key (resolves the dynamic `{run}` / `{invocation}` placeholders). */
  organization: string;
}

/** The subset of the remediation plan DTO the runner reads. */
interface RemediationPlan {
  id: string;
  status: string;
  version: number;
  replanCount: number;
  outcome?: { status: string };
  steps: { id: string; capabilityId: string; status: string; approvalId?: string }[];
  problem: { id: string; status: string };
}

/** The `done` SSE payload of the chat/approval surfaces. */
interface DonePayload {
  status: string;
  response: string;
  plan: { stepId: string; capabilityId: string; toolId: string }[];
  steps: {
    stepId: string;
    capabilityId: string;
    toolId: string;
    status: string;
    output?: unknown;
    errorCode?: string;
  }[];
  approvals: {
    id?: string;
    capabilityId: string;
    toolId: string;
    status: string;
    sideEffectClass: string;
  }[];
}

/** Runs a whole dataset and builds the machine-readable report. */
export async function runDataset(
  dataset: ScenarioDataset,
  options: RunOptions = {},
): Promise<EvaluationReport> {
  const issues = validateDataset(dataset);
  if (issues.length > 0) {
    throw new Error(
      `Scenario dataset ${dataset.id}@${dataset.version} is invalid:\n- ${issues.join('\n- ')}`,
    );
  }
  const selected =
    options.only === undefined || options.only.length === 0
      ? dataset.scenarios
      : dataset.scenarios.filter((scenario) => options.only?.includes(scenario.id));
  if (
    options.only !== undefined &&
    options.only.length > 0 &&
    selected.length !== options.only.length
  ) {
    const missing = options.only.filter((id) => !dataset.scenarios.some((s) => s.id === id));
    throw new Error(`Unknown scenario id(s): ${missing.join(', ')}`);
  }

  const startedAt = new Date();
  const started = performance.now();
  const results: ScenarioResult[] = [];
  for (const scenario of selected) {
    results.push(evaluateScenario(scenario, await observeScenario(scenario, options)));
  }
  const durationMs = Math.round((performance.now() - started) * 100) / 100;

  return buildReport({ ...dataset, scenarios: selected }, results, {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    environment: {
      harness:
        'in-memory (apps/api buildApp over repository fakes; real routes, AI runtime, engines)',
      aiProvider: options.env?.['AI_PROVIDER'] ?? 'none',
      node: process.version,
      subset:
        selected.length === dataset.scenarios.length ? 'full' : selected.map((s) => s.id).join(','),
    },
  });
}

/** Drives one scenario and returns what was observed. */
export async function observeScenario(
  scenario: ScenarioDefinition,
  options: ScenarioAppOptions = {},
): Promise<ScenarioObservation> {
  const draft: Draft = {
    authorization: { outcome: 'allowed', httpStatus: 0 },
    plannedSteps: [],
    finalSteps: [],
    approvals: [],
    groundingContext: [],
    verification: [],
    audit: [],
    timings: [],
    errors: [],
    problemIds: new Map(),
    outcomes: new Map(),
    organization: scenario.organization,
  };

  const invalid = validateScenario(scenario);
  if (invalid.length > 0) {
    draft.errors.push(...invalid.map((issue) => `invalid scenario: ${issue}`));
    return freeze(draft);
  }

  let harness: ScenarioApp | undefined;
  try {
    harness = await createScenarioApp(scenario.world, {
      ...options,
      ...(scenario.modelFixture === undefined ? {} : { modelFixture: scenario.modelFixture }),
    });
    await precheckRoles(harness, draft);
    if (draft.errors.length === 0) {
      switch (scenario.request.channel) {
        case 'chat':
          await runChat(harness, scenario, draft);
          for (const step of scenario.request.after ?? []) {
            await applyLifecycleStep(harness, scenario.request.actor, step, draft);
          }
          break;
        case 'remediation':
          await runRemediation(harness, scenario, draft);
          for (const step of scenario.request.after ?? []) {
            await applyLifecycleStep(harness, scenario.request.actor, step, draft);
          }
          break;
        case 'http':
          await runHttp(harness, scenario, draft);
          break;
        case 'mcp':
          await runMcp(harness, scenario, draft);
          for (const step of scenario.request.after ?? []) {
            await applyLifecycleStep(harness, scenario.request.actor, step, draft);
          }
          break;
        case 'agent':
          await runAgentChannel(harness, scenario, draft);
          break;
      }
      await verify(harness, scenario, draft);
      await readAudit(harness, scenario, draft);
    }
  } catch (error) {
    draft.errors.push(`harness error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await harness?.close();
  }
  return freeze(draft);
}

// ---------------------------------------------------------------------------
// Precheck
// ---------------------------------------------------------------------------

/** Every workspace membership must resolve its declared business role. */
async function precheckRoles(harness: ScenarioApp, draft: Draft): Promise<void> {
  const world = harness.world;
  for (const user of world.world.users) {
    const memberships = world.world.workspaceMemberships.filter((m) => m.user === user.key);
    if (memberships.length === 0) continue;
    const response = await harness.request(user.key, 'GET', '/api/role-context');
    if (response.statusCode !== 200) {
      draft.errors.push(
        `precheck: role-context for ${user.key} returned HTTP ${response.statusCode}`,
      );
      continue;
    }
    const options = (response.json() as { options: { workspaceId: string; roleId: string }[] })
      .options;
    for (const membership of memberships) {
      const workspaceId = world.workspace(membership.workspace).id;
      const resolved = options.find((option) => option.workspaceId === workspaceId)?.roleId;
      if (resolved !== membership.expectedRole) {
        draft.errors.push(
          `precheck: ${user.key} in ${membership.workspace} resolved role ${resolved ?? 'none'}, expected ${membership.expectedRole}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

async function runChat(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  draft: Draft,
): Promise<void> {
  const request = scenario.request;
  if (request.channel !== 'chat') return;
  const world = harness.world;
  const message = resolvePlaceholders(world, request.message);
  const body: Record<string, unknown> = { message };
  if (request.organization !== undefined)
    body['organizationId'] = world.organization(request.organization).id;
  if (request.workspace !== undefined) body['workspaceId'] = world.workspace(request.workspace).id;
  // The trusted scope is legitimate grounding: the AI is told its
  // organization/workspace, so naming them is never an unsupported claim.
  draft.groundingContext.push(message);
  if (request.organization !== undefined)
    draft.groundingContext.push(world.organization(request.organization).name);
  if (request.workspace !== undefined)
    draft.groundingContext.push(world.workspace(request.workspace).name);

  const response = await timed(draft, 'chat', () =>
    harness.request(request.actor, 'POST', '/api/ai/chat', body),
  );
  if (!recordAuthorization(response, draft)) return;

  const done = sseDone(response);
  if (done === undefined) {
    draft.errors.push('chat: no `done` event in the SSE stream');
    return;
  }
  draft.runStatus = done.status;
  draft.response = done.response;
  const statusByStep = new Map(done.steps.map((step) => [step.stepId, step.status]));
  draft.plannedSteps = done.plan.map((step) => ({
    capabilityId: step.capabilityId,
    toolId: step.toolId,
    status: normalizeStepStatus(statusByStep.get(step.stepId) ?? 'pending'),
  }));
  draft.finalSteps = done.steps.map(toObservedStep);
  // A policy refusal is an authorization outcome: the platform DENIED the
  // action (nothing executed, no approval opened).
  const policyRefusal = done.steps.find(
    (step) => step.status === 'failed' && step.errorCode?.startsWith('POLICY_') === true,
  );
  if (policyRefusal !== undefined) {
    draft.authorization = {
      outcome: 'denied',
      httpStatus: 403,
      errorCode: policyRefusal.errorCode as string,
    };
    draft.finalSteps = [];
    return;
  }
  draft.approvals = done.approvals.map((approval) => ({
    ...(approval.id === undefined ? {} : { id: approval.id }),
    capabilityId: approval.capabilityId,
    status: approval.status,
    sideEffectClass: approval.sideEffectClass,
  }));
  absorbOutputs(done, draft);

  const decision = request.decision;
  const approvalId = done.approvals[0]?.id;
  if (approvalId !== undefined) {
    for (const step of request.afterGate ?? []) {
      await applyLifecycleStep(harness, request.actor, step, draft);
    }
  }
  if (decision === undefined || approvalId === undefined) return;

  if (decision.delayMs !== undefined && decision.delayMs > 0) {
    // A real human think-time between the gate and the decision.
    await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
  }
  const decided = await timed(draft, `decision:${decision.decision}`, () =>
    harness.request(decision.actor, 'POST', `/api/ai/approvals/${approvalId}/decision`, {
      decision: decision.decision,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    }),
  );
  draft.decision = { decision: decision.decision, httpStatus: decided.statusCode };
  if (decided.statusCode !== 200) return;

  if (decision.decision === 'reject') {
    draft.decision.resultStatus = (decided.json() as { status?: string }).status;
    return;
  }
  const resumed = sseDone(decided);
  if (resumed === undefined) {
    draft.errors.push('decision: no `done` event in the resumed SSE stream');
    return;
  }
  draft.decision.resultStatus = resumed.status;
  draft.runStatus = resumed.status;
  draft.response = resumed.response;
  const resumedRefusal = resumed.steps.find(
    (step) =>
      step.status === 'failed' &&
      step.errorCode !== undefined &&
      GOVERNANCE_STEP_CODES.test(step.errorCode),
  );
  if (resumedRefusal !== undefined) {
    // Trusted state changed AFTER the approval (policy version, authority):
    // the approved action was refused at execution and nothing ran.
    draft.authorization = {
      outcome: 'denied',
      httpStatus: 403,
      errorCode: resumedRefusal.errorCode as string,
    };
    draft.finalSteps = [];
    return;
  }
  draft.finalSteps = resumed.steps.map(toObservedStep);
  absorbOutputs(resumed, draft);
}

async function runRemediation(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  draft: Draft,
): Promise<void> {
  const request = scenario.request;
  if (request.channel !== 'remediation') return;
  const world = harness.world;
  const scope = `organizationId=${world.organization(request.organization).id}&workspaceId=${world.workspace(request.workspace).id}`;

  const scanned = await timed(draft, 'scan', () =>
    harness.request(request.actor, 'POST', `/api/problems/scan?${scope}`),
  );
  if (!recordAuthorization(scanned, draft)) return;
  const problems = (scanned.json() as { problems: { id: string; signalId: string }[] }).problems;
  for (const problem of problems) draft.problemIds.set(problem.signalId, problem.id);
  const problemId = draft.problemIds.get(request.signalId);
  if (problemId === undefined) {
    draft.errors.push(
      `remediation: signal ${request.signalId} was not detected (detected: ${problems.map((p) => p.signalId).join(', ') || 'none'})`,
    );
    return;
  }

  const created = await timed(draft, 'plan', () =>
    harness.request(request.actor, 'POST', `/api/problems/${problemId}/plans?${scope}`, {}),
  );
  if (created.statusCode !== 200) {
    draft.errors.push(`remediation: plan creation returned HTTP ${created.statusCode}`);
    return;
  }
  let plan = (created.json() as { plan: RemediationPlan }).plan;
  // step id → capability, across every plan version observed (re-plans mint new steps).
  const stepCapabilities = new Map(plan.steps.map((step) => [step.id, step.capabilityId]));
  draft.plannedSteps = plan.steps.map((step) => ({
    capabilityId: step.capabilityId,
    status: normalizeStepStatus(step.status),
  }));

  // Every step that ever executed, across re-plans (a re-plan resets steps).
  const executed = new Map<string, ObservedStep>();
  const recordExecuted = (current: RemediationPlan) => {
    for (const step of current.steps) {
      const status = normalizeStepStatus(step.status);
      if (status === 'succeeded' || status === 'failed') {
        executed.set(`${current.version}:${step.id}`, { capabilityId: step.capabilityId, status });
      }
    }
  };

  const decidedApprovals = new Set<string>();
  const maxAdvances = request.maxAdvances ?? 4;
  for (let i = 0; i < maxAdvances; i += 1) {
    const advanced = await timed(draft, `advance:${i + 1}`, () =>
      harness.request(request.actor, 'POST', `/api/plans/${plan.id}/advance?${scope}`),
    );
    if (advanced.statusCode !== 200) {
      draft.errors.push(`remediation: advance returned HTTP ${advanced.statusCode}`);
      break;
    }
    plan = (advanced.json() as { plan: RemediationPlan }).plan;
    for (const step of plan.steps) stepCapabilities.set(step.id, step.capabilityId);
    recordExecuted(plan);
    draft.plan = plan;

    const gated = plan.steps.find(
      (step) => step.status === 'AWAITING_APPROVAL' && step.approvalId !== undefined,
    );
    if (gated?.approvalId !== undefined && !decidedApprovals.has(gated.approvalId)) {
      draft.approvals.push({
        id: gated.approvalId,
        capabilityId: gated.capabilityId,
        status: 'pending',
      });
      // Attempts / changes made while the gate is open, BEFORE any decision.
      for (const step of request.afterGate ?? []) {
        await applyLifecycleStep(harness, request.actor, step, draft);
      }
      if (request.decision === undefined) break;
      const decision = request.decision;
      const approvalId = gated.approvalId;
      decidedApprovals.add(approvalId);
      const decided = await timed(draft, `decision:${decision.decision}`, () =>
        harness.request(decision.actor, 'POST', `/api/ai/approvals/${approvalId}/decision`, {
          decision: decision.decision,
          ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        }),
      );
      draft.decision = {
        decision: decision.decision,
        httpStatus: decided.statusCode,
        ...(decided.statusCode === 200
          ? { resultStatus: (decided.json() as { status?: string }).status }
          : {}),
      };
      if (decided.statusCode !== 200 || decision.decision === 'reject') break;
      continue;
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED'].includes(plan.status)) break;
  }

  draft.plan = plan;
  draft.runStatus = plan.status;
  // The governed execution journal is the authoritative record of what ran:
  // a re-plan replaces the plan's steps, but every executed step was
  // journaled against the plan id. Fall back to the plan DTO only when the
  // journal holds nothing for this plan.
  const journal = (
    await harness.agentExecutions.listByTenant(world.organization(request.organization).id, {
      limit: 200,
    })
  ).filter((record) => record.planId === plan.id);
  const journaled = journal
    .filter((record) => record.status === 'completed' || record.status === 'failed')
    .map((record) => ({
      capabilityId:
        (record.stepId === undefined ? undefined : stepCapabilities.get(record.stepId)) ??
        'remediation.step',
      status: record.status === 'completed' ? 'succeeded' : 'failed',
    }));
  draft.finalSteps = journaled.length > 0 ? journaled : [...executed.values()];
}

async function runHttp(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  draft: Draft,
): Promise<void> {
  const request = scenario.request;
  if (request.channel !== 'http') return;
  const resolve = (text: string) => resolvePlaceholders(harness.world, text);
  const body =
    request.body === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(request.body).map(([key, value]) => [
            key,
            typeof value === 'string' ? resolve(value) : value,
          ]),
        );
  const response = await timed(draft, `${request.method} ${request.path.split('?')[0]}`, () =>
    harness.request(request.actor, request.method, resolve(request.path), body),
  );
  recordAuthorization(response, draft);
  for (const step of request.after ?? []) {
    await applyLifecycleStep(harness, request.actor, step, draft);
  }
}

/** Resume-time refusals of an approved chat action (policy changed / expired / denied). */
const GOVERNANCE_STEP_CODES = /^(POLICY_|APPROVAL_)/;

/** Step error codes that are AUTHORIZATION refusals (agent authority / argument guard). */
const AUTHORIZATION_STEP_CODES =
  /^(DELEGATION_|AGENT_|CAPABILITY_|INITIATOR_|FORGED_|RESERVED_ARGUMENT|APPROVAL_|POLICY_)/;

/**
 * Runs the scenario AS a persisted agent (`POST /api/agents/:id/execute`),
 * then optionally changes trusted state between the approval gate and its
 * decision, and finally decides. The initiating user, agent, and
 * delegation are server-resolved; the runner only supplies the path id and
 * an utterance — the same things an attacker controls.
 */
async function runAgentChannel(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  draft: Draft,
): Promise<void> {
  const request = scenario.request;
  if (request.channel !== 'agent') return;
  const world = harness.world;
  const organizationId = world.organization(request.organization).id;
  const scope = `organizationId=${organizationId}&workspaceId=${world.workspace(request.scopeWorkspace ?? request.workspace).id}`;
  const agentId =
    request.agentId === undefined
      ? world.entityId(request.agent)
      : resolvePlaceholders(world, request.agentId);
  const utterance = resolvePlaceholders(world, request.utterance);
  draft.groundingContext.push(utterance, world.organization(request.organization).name);

  const response = await timed(draft, 'agent:execute', () =>
    harness.request(request.actor, 'POST', `/api/agents/${agentId}/execute?${scope}`, {
      utterance,
    }),
  );
  if (response.statusCode === 401 || response.statusCode === 403 || response.statusCode === 404) {
    let code: string | undefined;
    try {
      const error = (response.json() as { error?: { code?: string; reason?: string } }).error;
      code = error?.reason ?? error?.code;
    } catch {
      code = undefined;
    }
    draft.authorization = {
      outcome: 'denied',
      httpStatus: response.statusCode,
      ...(code === undefined ? {} : { errorCode: code }),
    };
    return;
  }
  if (response.statusCode !== 200) {
    draft.authorization = { outcome: 'allowed', httpStatus: response.statusCode };
    draft.errors.push(
      `agent execute failed with HTTP ${response.statusCode}: ${response.body.slice(0, 200)}`,
    );
    return;
  }
  const body = response.json() as { outcome: DonePayload; principal: { id: string } };
  const outcome = body.outcome;
  const refusal = outcome.steps.find(
    (step) =>
      step.status === 'failed' &&
      step.errorCode !== undefined &&
      AUTHORIZATION_STEP_CODES.test(step.errorCode),
  );
  draft.runStatus = outcome.status;
  draft.response = outcome.response;
  draft.plannedSteps = outcome.steps.map((step) => ({
    capabilityId: step.capabilityId,
    toolId: step.toolId,
    status: normalizeStepStatus(step.status),
  }));
  if (refusal !== undefined) {
    // The platform REFUSED the agent: nothing executed.
    draft.authorization = {
      outcome: 'denied',
      httpStatus: 403,
      errorCode: refusal.errorCode as string,
    };
    return;
  }
  draft.authorization = { outcome: 'allowed', httpStatus: 200 };
  draft.finalSteps = outcome.steps.map(toObservedStep);
  draft.approvals = outcome.approvals.map((approval) => ({
    ...(approval.id === undefined ? {} : { id: approval.id }),
    capabilityId: approval.capabilityId,
    status: approval.status,
    sideEffectClass: approval.sideEffectClass,
  }));
  absorbOutputs(outcome, draft);

  const approvalId = outcome.approvals[0]?.id;
  if (approvalId === undefined) return;

  for (const step of request.afterGate ?? []) {
    await applyLifecycleStep(harness, request.actor, step, draft);
  }

  if (request.followUp !== undefined) {
    // The agent runs a second request AS ITSELF (e.g. trying to approve its own gate).
    const followUp = resolvePlaceholders(world, request.followUp).replace('{approval}', approvalId);
    const followed = await timed(draft, 'agent:follow-up', () =>
      harness.request(request.actor, 'POST', `/api/agents/${agentId}/execute?${scope}`, {
        utterance: followUp,
      }),
    );
    if (followed.statusCode === 200) {
      const next = (followed.json() as { outcome: DonePayload }).outcome;
      // The follow-up may only ever plan nothing or fail: any executed step is a violation
      // and stays visible to the tool-selection / execution metrics.
      for (const step of next.steps) {
        draft.finalSteps = [...draft.finalSteps, toObservedStep(step)];
      }
    }
  }

  const decision = request.decision;
  if (decision === undefined) return;
  const decided = await timed(draft, `decision:${decision.decision}`, () =>
    harness.request(decision.actor, 'POST', `/api/ai/approvals/${approvalId}/decision`, {
      decision: decision.decision,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    }),
  );
  draft.decision = { decision: decision.decision, httpStatus: decided.statusCode };
  if (decided.statusCode !== 200) return;
  if (decision.decision === 'reject') {
    draft.decision.resultStatus = (decided.json() as { status?: string }).status;
    return;
  }
  const resumed = sseDone(decided);
  if (resumed === undefined) {
    draft.errors.push('decision: no `done` event in the resumed SSE stream');
    return;
  }
  draft.decision.resultStatus = resumed.status;
  draft.runStatus = resumed.status;
  draft.response = resumed.response;
  const resumedRefusal = resumed.steps.find(
    (step) =>
      step.status === 'failed' &&
      step.errorCode !== undefined &&
      AUTHORIZATION_STEP_CODES.test(step.errorCode),
  );
  if (resumedRefusal !== undefined) {
    // Authority was withdrawn AFTER the approval: the approved action was refused at execution.
    draft.authorization = {
      outcome: 'denied',
      httpStatus: 403,
      errorCode: resumedRefusal.errorCode as string,
    };
    draft.finalSteps = [];
    return;
  }
  draft.finalSteps = resumed.steps.map(toObservedStep);
  absorbOutputs(resumed, draft);
}

/** Applies a trusted lifecycle change (as the scenario's actor, through the real management API). */
async function applyLifecycleStep(
  harness: ScenarioApp,
  actor: string,
  step: NonNullable<
    Extract<ScenarioDefinition['request'], { channel: 'agent' }>['afterGate']
  >[number],
  draft?: Draft,
): Promise<void> {
  const world = harness.world;
  switch (step.kind) {
    case 'http': {
      const dynamic = await dynamicIds(harness, draft);
      const resolve = (text: string) => resolveDynamic(resolvePlaceholders(world, text), dynamic);
      const body =
        step.body === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(step.body).map(([key, value]) => [
                key,
                typeof value === 'string' ? resolve(value) : value,
              ]),
            );
      const response = await harness.request(step.actor, step.method, resolve(step.path), body);
      draft?.outcomes.set(step.label, outcomeOf(response));
      return;
    }
    case 'decide': {
      const dynamic = await dynamicIds(harness, draft);
      const approvalId =
        step.approvalId === undefined
          ? dynamic['approval']
          : resolveDynamic(resolvePlaceholders(world, step.approvalId), dynamic);
      if (approvalId === undefined) {
        throw new Error(`decide ${step.label}: the run opened no approval`);
      }
      const response = await harness.request(
        step.actor,
        'POST',
        `/api/ai/approvals/${approvalId}/decision`,
        {
          ...Object.fromEntries(
            Object.entries(step.extra ?? {}).map(([key, value]) => [
              key,
              typeof value === 'string'
                ? resolveDynamic(resolvePlaceholders(world, value), dynamic)
                : value,
            ]),
          ),
          decision: step.decision,
        },
      );
      draft?.outcomes.set(step.label, outcomeOf(response));
      return;
    }
    case 'replay_claim': {
      const dynamic = await dynamicIds(harness, draft);
      const approvalId = dynamic['approval'];
      if (approvalId === undefined) {
        throw new Error(`replay_claim ${step.label}: the run opened no approval`);
      }
      const claimed = await harness.approvals.claim(approvalId);
      draft?.outcomes.set(step.label, {
        status: claimed ? 200 : 409,
        body: claimed ? 'claimed' : 'refused',
      });
      return;
    }
    case 'decide_expense': {
      const organizationId = world.organization(step.organization).id;
      const workspaceId = world.workspace(step.workspace).id;
      const stored = await harness.repos.expenses.listByWorkspace(
        organizationId as TenantId,
        workspaceId as WorkspaceId,
      );
      const submitted = stored.filter((expense) => expense.status.value === 'pending');
      const target = submitted[submitted.length - 1];
      if (target === undefined) {
        throw new Error(`decide_expense ${step.label}: no submitted expense in ${step.workspace}`);
      }
      const response = await harness.request(
        step.actor,
        'POST',
        `/api/finance/expenses/${target.id}/decide`,
        { organizationId, workspaceId, decision: step.decision },
      );
      draft?.outcomes.set(step.label, outcomeOf(response));
      return;
    }
    case 'disconnect_connector':
      harness.disconnectConnector(step.organization, step.provider);
      return;
    case 'tamper_telemetry': {
      // A hostile writer appends FORGED runs that claim an approved, completed
      // execution (the store is append-only: there is no update to abuse).
      const organizationId = world.organization(step.organization).id;
      const runs = await harness.repos.runtimeRuns!.list(organizationId, { limit: 500 });
      for (const run of runs) {
        const forged = structuredClone(run) as unknown as Record<string, unknown>;
        forged['id'] = `${run.id}_forged`;
        forged['status'] = 'completed';
        delete forged['failure'];
        forged['approval'] = { ...(run.approval ?? {}), state: 'resumed', waitMs: 1 };
        await harness.repos.runtimeRuns!.append(forged as never);
      }
      return;
    }
    case 'start_workflow':
      draft?.outcomes.set(step.label, await runStartWorkflow(harness, step));
      return;
    case 'invoke_tool':
      draft?.outcomes.set(step.label, await runInvokeTool(harness, step));
      return;
    case 'advance_clock':
      harness.setAgentClock(new Date(step.to));
      return;
    case 'claim_and_abandon_approval': {
      const approvalId = (await dynamicIds(harness, draft))['approval'];
      if (approvalId === undefined) {
        throw new Error('claim_and_abandon_approval: the run opened no approval');
      }
      const granted = await harness.approvals.decide(approvalId, {
        decision: 'grant',
        decidedBy: world.user(step.approver).id,
      });
      if (!granted.ok || !(await harness.approvals.claim(approvalId))) {
        throw new Error('claim_and_abandon_approval: the approval could not be claimed');
      }
      return;
    }
    case 'close_budget': {
      const budget = world.entity(step.budget);
      if (budget.kind !== 'budget') return;
      const response = await harness.request(
        step.by,
        'POST',
        `/api/finance/budgets/${budget.id}/close`,
        {
          organizationId: world.organization(budget.organization).id,
          workspaceId: world.workspace(budget.workspace).id,
        },
      );
      if (response.statusCode !== 200) {
        throw new Error(
          `close_budget ${step.budget} failed with HTTP ${response.statusCode}: ${response.body.slice(0, 160)}`,
        );
      }
      return;
    }
    case 'update_article': {
      const article = world.entity(step.article);
      if (article.kind !== 'knowledge_article') return;
      const response = await harness.request(
        step.by,
        'PUT',
        `/api/knowledge/articles/${article.id}`,
        {
          organizationId: world.organization(article.organization).id,
          workspaceId: world.workspace(article.workspace).id,
          title: step.title,
          body: step.body,
        },
      );
      if (response.statusCode !== 200) {
        throw new Error(
          `update_article ${step.article} failed with HTTP ${response.statusCode}: ${response.body.slice(0, 160)}`,
        );
      }
      return;
    }
    case 'ask': {
      const workspace = world.workspace(step.workspace);
      const response = await harness.request(step.actor, 'POST', '/api/ai/chat', {
        message: resolvePlaceholders(world, step.message),
        organizationId: world.organization(workspace.organization).id,
        workspaceId: workspace.id,
      });
      if (response.statusCode !== 200) {
        throw new Error(`ask failed with HTTP ${response.statusCode}`);
      }
      return;
    }
    case 'set_policy': {
      // A trusted operator action (there is deliberately no public write API).
      await harness.repos.policySettings?.append({
        organizationId: world.organization(step.organization).id,
        policyId: step.policyId,
        config: step.config,
        createdBy: world.user(step.by).id,
      });
      return;
    }
    case 'suspend_agent': {
      const agent = world.entity(step.agent);
      if (agent.kind !== 'agent') return;
      const scope = `organizationId=${world.organization(agent.organization).id}&workspaceId=${world.workspace(agent.workspace).id}`;
      const response = await harness.request(
        actor,
        'POST',
        `/api/agents/${agent.id}/suspend?${scope}`,
        {},
      );
      if (response.statusCode !== 200) {
        throw new Error(`suspend_agent ${step.agent} failed with HTTP ${response.statusCode}`);
      }
      return;
    }
    case 'revoke_delegation': {
      const delegation = world.entity(step.delegation);
      if (delegation.kind !== 'delegation') return;
      const agent = world.entity(delegation.agent);
      if (agent.kind !== 'agent') return;
      const scope = `organizationId=${world.organization(agent.organization).id}&workspaceId=${world.workspace(agent.workspace).id}`;
      const response = await harness.request(
        actor,
        'POST',
        `/api/agents/${agent.id}/delegations/${delegation.id}/revoke?${scope}`,
        {},
      );
      if (response.statusCode !== 200) {
        throw new Error(
          `revoke_delegation ${step.delegation} failed with HTTP ${response.statusCode}`,
        );
      }
      return;
    }
  }
}

/** Structured MCP error codes that are AUTHORIZATION / GOVERNANCE refusals (nothing ran). */
const MCP_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'TOOL_NOT_FOUND',
  'INVALID_INPUT',
  'FORBIDDEN',
  'RESERVED_ARGUMENT',
  'ARGUMENT_TOO_DEEP',
  'FORGED_AGENT_CONTEXT',
  'POLICY_DENIED',
  'POLICY_UNAVAILABLE',
  'POLICY_CHANGED_AFTER_APPROVAL',
  'INVALID_ARGUMENTS',
]);

/**
 * Calls Nexora's remote MCP surface exactly as an external MCP client would:
 * a real HTTP listener, the official SDK client, the actor's session cookie,
 * and the workspace header. The tool name and arguments are the untrusted
 * client-side values under test.
 */
async function runMcp(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  draft: Draft,
): Promise<void> {
  const request = scenario.request;
  if (request.channel !== 'mcp') return;
  const world = harness.world;
  const args = Object.fromEntries(
    Object.entries(request.arguments).map(([key, value]) => [
      key,
      typeof value === 'string' ? resolvePlaceholders(world, value) : value,
    ]),
  );
  draft.groundingContext.push(world.organization(request.organization).name);
  if (request.workspace !== undefined)
    draft.groundingContext.push(world.workspace(request.workspace).name);

  await harness.app.listen({ port: 0, host: '127.0.0.1' });
  const address = harness.app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const headers: Record<string, string> = { cookie: harness.sessionCookie(request.actor) };
  if (request.workspace !== undefined) {
    headers['x-nexora-workspace'] = world.workspace(request.workspace).id;
  }
  if (request.agent !== undefined || request.agentId !== undefined) {
    headers['x-nexora-agent'] =
      request.agentId === undefined
        ? world.entityId(request.agent as string)
        : resolvePlaceholders(world, request.agentId);
  }
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), {
    requestInit: { headers },
  });
  const client = new Client({ name: 'nexora-scenario-runner', version: '1.0.0' });
  try {
    try {
      await timed(draft, 'mcp:connect', () => client.connect(transport));
    } catch (error) {
      // The session itself was refused (e.g. a fabricated / foreign agent header → 403).
      draft.authorization = {
        outcome: 'denied',
        httpStatus: 403,
        errorCode: error instanceof Error ? error.message.slice(0, 80) : 'MCP_ERROR',
      };
      return;
    }
    type McpResult = {
      content?: { type: string; text?: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    let result: McpResult | undefined;
    try {
      result = (await timed(draft, `mcp:${request.tool}`, () =>
        client.callTool({ name: request.tool, arguments: args }),
      )) as McpResult;
    } catch (error) {
      // Protocol-level refusal (unknown/hidden tool, invalid params).
      draft.authorization = {
        outcome: 'denied',
        httpStatus: 400,
        errorCode: error instanceof Error ? error.message.slice(0, 80) : 'MCP_ERROR',
      };
    }
    if (result !== undefined) {
      const text = (result.content ?? []).map((part) => part.text ?? '').join('\n');
      const structured = result.structuredContent ?? {};
      const status = typeof structured['status'] === 'string' ? structured['status'] : undefined;
      const code = typeof structured['code'] === 'string' ? structured['code'] : undefined;
      const denied = result.isError === true && MCP_REFUSAL_CODES.has(code ?? '');
      draft.authorization = denied
        ? { outcome: 'denied', httpStatus: 403, ...(code === undefined ? {} : { errorCode: code }) }
        : { outcome: 'allowed', httpStatus: 200 };
      if (!denied) {
        const stepStatus =
          status === 'approval_required'
            ? 'blocked'
            : result.isError === true
              ? 'failed'
              : 'succeeded';
        draft.plannedSteps = [
          { capabilityId: request.tool, toolId: request.tool, status: stepStatus },
        ];
        draft.finalSteps = draft.plannedSteps;
        draft.runStatus = stepStatus === 'succeeded' ? 'completed' : stepStatus;
        draft.response = text;
        if (status === 'approval_required' && typeof structured['approvalId'] === 'string') {
          draft.approvals = [
            {
              id: structured['approvalId'],
              capabilityId: request.tool,
              status: 'pending',
              sideEffectClass: 'consequential',
            },
          ];
        }
        if (result.isError !== true) draft.groundingContext.push(text);
      }
    }

    // Changes / decisions made between the gate and the re-calls.
    for (const step of request.afterGate ?? []) {
      await applyLifecycleStep(harness, request.actor, step, draft);
    }
    // Further calls on the SAME session: each outcome is recorded by label.
    for (const extra of request.additional ?? []) {
      const extraArgs = Object.fromEntries(
        Object.entries(extra.arguments).map(([key, value]) => [
          key,
          typeof value === 'string' ? resolvePlaceholders(world, value) : value,
        ]),
      );
      try {
        const answered = (await client.callTool({
          name: extra.tool,
          arguments: extraArgs,
        })) as McpResult;
        const structured = answered.structuredContent ?? {};
        const code = typeof structured['code'] === 'string' ? structured['code'] : undefined;
        draft.outcomes.set(extra.label, {
          status: answered.isError === true && MCP_REFUSAL_CODES.has(code ?? '') ? 403 : 200,
          ...(code === undefined ? {} : { errorCode: code }),
          body: JSON.stringify(answered),
        });
      } catch (error) {
        draft.outcomes.set(extra.label, {
          status: 400,
          errorCode: error instanceof Error ? error.message.slice(0, 80) : 'MCP_ERROR',
          body: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Verification + audit
// ---------------------------------------------------------------------------

async function verify(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  draft: Draft,
): Promise<void> {
  for (const check of scenario.expected.verification.checks) {
    draft.verification.push(await evaluateCheck(harness, scenario, draft, check));
  }
}

/** A trace section as the runner reads it (loosely typed JSON of the decision trace). */
type TraceSection = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function evaluateCheck(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  draft: Draft,
  check: StateCheck,
): Promise<ObservedCheck> {
  const world = harness.world;
  const repos = harness.repos;
  switch (check.kind) {
    case 'count': {
      const organizationId = world.organization(check.organization).id as TenantId;
      const workspaces = (
        check.workspace === undefined
          ? world.world.workspaces.filter((w) => w.organization === check.organization)
          : [world.workspace(check.workspace)]
      ).map((w) => w.id as WorkspaceId);
      let names: string[] = [];
      if (check.entity === 'calendar_event') {
        for (const workspaceId of workspaces) {
          names.push(
            ...(await repos.calendarEvents.listByWorkspace(organizationId, workspaceId)).map(
              (e) => e.title.value,
            ),
          );
        }
      } else if (check.entity === 'project') {
        names = (await repos.projects.listByOrganization(organizationId)).map((p) => p.name.value);
      } else if (check.entity === 'employee') {
        names = (await repos.employees.listByOrganization(organizationId))
          .filter(
            (e) =>
              (check.status === undefined || e.status.value === check.status) &&
              !(check.statusNot ?? []).includes(e.status.value),
          )
          .map((e) => e.name.value);
      } else if (check.entity === 'budget') {
        for (const workspaceId of workspaces) {
          names.push(
            ...(await repos.budgets.listByWorkspace(organizationId, workspaceId)).map(
              (b) => b.name.value,
            ),
          );
        }
      } else {
        for (const project of await repos.projects.listByOrganization(organizationId)) {
          names.push(
            ...(await repos.resourceAssignments.listByProject(project.id)).map(
              () => project.name.value,
            ),
          );
        }
      }
      const actual =
        check.named === undefined
          ? names.length
          : names.filter((name) => name === check.named).length;
      return {
        description: `${check.entity} count${check.named === undefined ? '' : ` named "${check.named}"`}${check.status === undefined ? '' : ` with status ${check.status}`}${check.statusNot === undefined ? '' : ` excluding status ${check.statusNot.join('/')}`} in ${check.organization}${check.workspace === undefined ? '' : `/${check.workspace}`} = ${check.equals}`,
        passed: actual === check.equals,
        actual,
      };
    }
    case 'runtime':
      return evaluateRuntimeCheck(harness, scenario, check);
    case 'runtime_operator':
      return evaluateOperatorCheck(harness, scenario, check);
    case 'probe':
    case 'probe_history':
    case 'policy_versions':
    case 'approval':
    case 'tool_catalog':
      return evaluateGovernanceCheck(harness, check, draft.outcomes, draft.approvals);
    case 'actor_continuity':
    case 'verification':
    case 'expense':
    case 'budget_utilization':
    case 'workflow_instances':
      return evaluateLifecycleCheck(harness, scenario, check, draft.approvals);
    case 'lineage': {
      const organizationId = world.organization(check.organization).id;
      const records = await repos.lineage!.list(organizationId, {
        kind: check.record,
        ...(check.workspace === undefined
          ? {}
          : { workspaceId: world.workspace(check.workspace).id }),
      });
      const subjectId =
        check.subjectEntity === undefined ? undefined : world.entityId(check.subjectEntity);
      const matched = records.filter((r) => {
        const d = r.data as Record<string, unknown>;
        const policy = d['policy'] as
          { policyId?: string; contextFingerprint?: string } | undefined;
        const workflow = d['workflow'] as { purpose?: string } | undefined;
        return (
          (check.tool === undefined || d['toolId'] === check.tool || r.subjectId === check.tool) &&
          (check.status === undefined || d['status'] === check.status) &&
          (check.origin === undefined || d['origin'] === check.origin) &&
          (check.purpose === undefined || workflow?.purpose === check.purpose) &&
          (check.verified === undefined || d['verified'] === check.verified) &&
          (check.hasApproval === undefined || (r.approvalId !== undefined) === check.hasApproval) &&
          (check.hasPolicy === undefined || (policy !== undefined) === check.hasPolicy) &&
          (check.hasInvocation === undefined ||
            (r.invocationId !== undefined) === check.hasInvocation) &&
          (check.hasContextFingerprint === undefined ||
            (policy?.contextFingerprint !== undefined) === check.hasContextFingerprint) &&
          (check.policyId === undefined || policy?.policyId === check.policyId) &&
          (check.sourceType === undefined || d['sourceType'] === check.sourceType) &&
          (subjectId === undefined || r.subjectId === subjectId) &&
          (check.sourceVersion === undefined || d['sourceVersion'] === check.sourceVersion) &&
          (check.trust === undefined || d['trust'] === check.trust) &&
          (check.connector === undefined || d['connector'] === check.connector) &&
          (check.derived === undefined || (d['derived'] === true) === check.derived) &&
          (check.relation === undefined || d['relation'] === check.relation) &&
          (check.subjectType === undefined || r.subjectType === check.subjectType)
        );
      });
      const actual =
        check.distinctFingerprints === undefined
          ? matched.length
          : new Set(
              matched.map(
                (r) => (r.data as { inputFingerprint?: string }).inputFingerprint ?? r.fingerprint,
              ),
            ).size;
      const expected = check.distinctFingerprints ?? check.equals;
      const passed = expected !== undefined ? actual === expected : actual >= (check.atLeast ?? 1);
      const attrs = Object.entries(check)
        .filter(
          ([key, value]) =>
            ![
              'kind',
              'organization',
              'record',
              'equals',
              'atLeast',
              'distinctFingerprints',
            ].includes(key) && value !== undefined,
        )
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
      return {
        description: `lineage ${check.record}${attrs === '' ? '' : ` [${attrs}]`} ${check.distinctFingerprints !== undefined ? `distinct fingerprints = ${check.distinctFingerprints}` : check.equals !== undefined ? `count = ${check.equals}` : `count >= ${check.atLeast ?? 1}`}`,
        passed,
        actual,
      };
    }
    case 'lineage_integrity': {
      const records = await repos.lineage!.list(world.organization(check.organization).id);
      const executions = records.filter((r) => r.kind === 'EXECUTION');
      const verifications = records.filter((r) => r.kind === 'VERIFICATION');
      let violations = 0;
      if (check.rule === 'verification_links_execution') {
        const ids = new Set(executions.map((r) => r.invocationId));
        violations = verifications.filter((r) => !ids.has((r.data as { of?: string }).of)).length;
        violations += executions.length === 0 ? 1 : 0;
      } else if (check.rule === 'execution_has_verification') {
        const verified = new Set(verifications.map((r) => (r.data as { of?: string }).of));
        violations = executions.filter((r) => !verified.has(r.invocationId)).length;
        violations += executions.length === 0 ? 1 : 0;
      } else {
        const evidenceIds = new Set(records.filter((r) => r.kind === 'EVIDENCE').map((r) => r.id));
        const findings = records.filter((r) => r.kind === 'FINDING');
        violations = findings.filter((r) => {
          const ids = (r.data as { evidenceRecordIds?: string[] }).evidenceRecordIds ?? [];
          return ids.length === 0 || ids.some((id) => !evidenceIds.has(id));
        }).length;
        violations += findings.length === 0 ? 1 : 0;
      }
      return {
        description: `lineage integrity: ${check.rule}`,
        passed: violations === 0,
        actual: violations,
      };
    }
    case 'audit_trace': {
      const approvalId = draft.approvals.find((a) => a.id !== undefined)?.id;
      const organization = world.organization(check.organization);
      if (approvalId === undefined) {
        return {
          description: 'audit trace of the run approval',
          passed: false,
          actual: 'no approval was opened',
        };
      }
      const eventId =
        check.event === 'workflow_step'
          ? await firstWorkflowStepEvent(harness, organization.id, approvalId)
          : `apr:${approvalId}`;
      if (eventId === undefined) {
        return {
          description: 'audit trace of the workflow step',
          passed: false,
          actual: 'the approval started no workflow instance',
        };
      }
      const response = await harness.request(
        organization.auditor.user,
        'GET',
        `/api/audit/events/${encodeURIComponent(eventId)}/trace?organizationId=${organization.id}&workspaceId=${world.workspace(organization.auditor.workspace).id}`,
      );
      if (response.statusCode !== 200) {
        return {
          description: 'audit trace of the run approval',
          passed: false,
          actual: `HTTP ${response.statusCode}`,
        };
      }
      const trace = (
        response.json() as { trace: Record<string, unknown> & Record<string, TraceSection> }
      ).trace;
      const missing: string[] = [];
      for (const section of check.requires) {
        const present =
          section === 'request'
            ? trace['request']?.text !== undefined
            : section === 'evidence'
              ? (trace['evidence'] ?? []).length > 0
              : section === 'derivedEvidence'
                ? (trace['evidence'] ?? []).some((e: { derived: boolean }) => e.derived)
                : section === 'policy'
                  ? trace['policy'] !== undefined
                  : section === 'approval'
                    ? trace['approval'] !== undefined
                    : section === 'planned'
                      ? (trace['planned'] ?? []).length > 0
                      : section === 'executions'
                        ? (trace['executions'] ?? []).length > 0
                        : section === 'verification'
                          ? (trace['executions'] ?? []).length > 0 &&
                            (trace['executions'] ?? []).every(
                              (e: { verified?: boolean }) => e.verified !== undefined,
                            )
                          : (trace['lineage'] ?? []).length > 0;
        if (!present) missing.push(section);
      }
      if (check.policyId !== undefined && trace['policy']?.id !== check.policyId)
        missing.push(`policy=${check.policyId}`);
      if (check.policyVersionRecorded !== undefined) {
        const policy = trace['policy'] as { version?: string; rules?: string[] } | undefined;
        if (
          typeof policy?.version !== 'string' ||
          policy.version.length === 0 ||
          !(policy.rules ?? []).some((rule) => rule.startsWith(`${check.policyVersionRecorded}=`))
        )
          missing.push(`policyVersion=${check.policyVersionRecorded}`);
      }
      if (
        check.executionsMatchApproval === true &&
        !(trace['executions'] ?? []).every(
          (e: { approvalId?: string; matchesApprovedInput?: boolean }) =>
            e.approvalId === undefined || e.matchesApprovedInput === true,
        )
      ) {
        missing.push('executionsMatchApproval');
      }
      missing.push(...workflowTraceFailures(harness, check, trace, approvalId));
      return {
        description: `audit trace${check.event === 'workflow_step' ? ' (wfs step)' : ''} exposes ${check.requires.join(', ')}${check.policyId === undefined ? '' : ` (policy ${check.policyId})`}${check.executionsMatchApproval === true ? ' with executions matching the approval' : ''}${check.workflow === undefined ? '' : ` and workflow state ${check.workflow.state}`}${check.composite === undefined ? '' : ' with composite attribution'}`,
        passed: missing.length === 0,
        actual: missing.length === 0 ? 'complete' : `missing: ${missing.join(', ')}`,
      };
    }
    case 'expense_count': {
      const stored = await repos.expenses.listByWorkspace(
        world.organization(check.organization).id as TenantId,
        world.workspace(check.workspace).id as WorkspaceId,
      );
      return {
        description: `expenses in ${check.organization}/${check.workspace} = ${check.equals}`,
        passed: stored.length === check.equals,
        actual: stored.length,
      };
    }
    case 'delegation_count': {
      const agent = world.entity(check.agent);
      if (agent.kind !== 'agent') throw new Error(`${check.agent} is not an agent`);
      const stored = await repos.agentDelegations?.listByAgent(
        world.organization(agent.organization).id,
        agent.id,
      );
      const actual = stored?.length ?? 0;
      return {
        description: `stored delegations of agent ${check.agent} = ${check.equals}`,
        passed: actual === check.equals,
        actual,
      };
    }
    case 'delegation_status': {
      const delegation = world.entity(check.delegation);
      if (delegation.kind !== 'delegation')
        throw new Error(`${check.delegation} is not a delegation`);
      const agent = world.entity(delegation.agent);
      if (agent.kind !== 'agent') throw new Error(`${delegation.agent} is not an agent`);
      const stored = await repos.agentDelegations?.findById(
        world.organization(agent.organization).id,
        delegation.id,
      );
      const actual = stored?.status ?? null;
      return {
        description: `delegation ${check.delegation} stored status = ${check.equals}`,
        passed: actual === check.equals,
        actual,
      };
    }
    case 'agent_status': {
      const agent = world.entity(check.agent);
      if (agent.kind !== 'agent') throw new Error(`${check.agent} is not an agent`);
      const stored = await repos.agents?.findById(
        world.organization(agent.organization).id,
        agent.id,
      );
      const actual = stored?.status ?? null;
      return {
        description: `agent ${check.agent} status = ${check.equals}`,
        passed: actual === check.equals,
        actual,
      };
    }
    case 'connector_writes': {
      const actual = harness.connectorWrites(check.organization);
      return {
        description: `${check.provider} provider writes in ${check.organization} = ${check.equals}`,
        passed: actual === check.equals,
        actual,
      };
    }
    case 'budget_status': {
      const budget = await repos.budgets.findById(world.entityId(check.budget) as never);
      const actual = budget?.status.value;
      return {
        description: `budget ${check.budget} status = ${check.equals}`,
        passed: actual === check.equals,
        actual: actual ?? null,
      };
    }
    case 'problem_status': {
      const problemId = draft.problemIds.get(check.signalId);
      let actual: string | null = null;
      if (problemId !== undefined) {
        const request = scenario.request;
        const scope =
          request.channel === 'remediation'
            ? `organizationId=${world.organization(request.organization).id}&workspaceId=${world.workspace(request.workspace).id}`
            : `organizationId=${world.organization(check.organization).id}`;
        const response = await harness.request(
          request.actor,
          'GET',
          `/api/problems/${problemId}?${scope}`,
        );
        if (response.statusCode === 200) {
          actual = (response.json() as { problem: { status: string } }).problem.status;
        }
      }
      const passed =
        actual !== null &&
        (check.equals === undefined || actual === check.equals) &&
        (check.not === undefined || actual !== check.not);
      return {
        description: `problem ${check.signalId} status ${check.equals !== undefined ? `= ${check.equals}` : `≠ ${check.not ?? '?'}`}`,
        passed,
        actual,
      };
    }
    case 'plan': {
      const plan = draft.plan;
      const actual =
        plan === undefined
          ? null
          : {
              status: plan.status,
              outcome: plan.outcome?.status ?? null,
              replanCount: plan.replanCount,
            };
      const passed =
        plan !== undefined &&
        (check.status === undefined || plan.status === check.status) &&
        (check.outcome === undefined || plan.outcome?.status === check.outcome) &&
        (check.minReplans === undefined || plan.replanCount >= check.minReplans);
      return {
        description: `remediation plan ${[
          check.status === undefined ? '' : `status = ${check.status}`,
          check.outcome === undefined ? '' : `outcome = ${check.outcome}`,
          check.minReplans === undefined ? '' : `replans ≥ ${check.minReplans}`,
        ]
          .filter(Boolean)
          .join(', ')}`,
        passed,
        actual,
      };
    }
  }
}

/** Reads the Audit Center of every organization the expectations mention, as its auditor. */
async function readAudit(
  harness: ScenarioApp,
  scenario: ScenarioDefinition,
  draft: Draft,
): Promise<void> {
  const world = harness.world;
  const matchers = [...scenario.expected.audit.required, ...scenario.expected.audit.forbidden];
  if (matchers.length === 0) return;
  // One audit read per (organization, workspace) the matchers ask about —
  // the organization's auditor workspace unless a matcher names another.
  const scopes = new Map<string, { organization: string; workspace?: string }>();
  for (const matcher of matchers) {
    const organization = matcher.organization ?? scenario.organization;
    scopes.set(`${organization}|${matcher.workspace ?? ''}`, {
      organization,
      ...(matcher.workspace === undefined ? {} : { workspace: matcher.workspace }),
    });
  }
  const capabilityByApproval = new Map(
    draft.approvals.filter((a) => a.id !== undefined).map((a) => [a.id as string, a.capabilityId]),
  );
  const seen = new Set<string>();
  for (const scope of scopes.values()) {
    const key = scope.organization;
    const organization = world.organization(key);
    const workspaceKey = scope.workspace ?? organization.auditor.workspace;
    // The authorization anchor is ALWAYS the auditor's own workspace; a
    // matcher naming another workspace narrows the returned data with
    // `filterWorkspaceId` (the route's documented contract).
    const url = `/api/audit/events?organizationId=${organization.id}&workspaceId=${world.workspace(organization.auditor.workspace).id}${scope.workspace === undefined ? '' : `&filterWorkspaceId=${world.workspace(workspaceKey).id}`}`;
    const response = await harness.request(organization.auditor.user, 'GET', url);
    if (response.statusCode !== 200) {
      draft.errors.push(`audit: ${key} auditor read returned HTTP ${response.statusCode}`);
      continue;
    }
    const events = (
      response.json() as {
        events: {
          id: string;
          source: string;
          status: string;
          action?: string;
          object?: string;
          detail?: string;
          actorName?: string;
          agent?: { id: string; name?: string };
          policy?: { id: string; version: string; outcome?: string; rules?: readonly string[] };
          delegationIds?: readonly string[];
          origin?: string;
          approvalOutcome?: { decidedByName?: string };
        }[];
      }
    ).events;
    for (const event of events) {
      if (seen.has(`${key}|${event.id}`)) continue;
      seen.add(`${key}|${event.id}`);
      const approvalId = event.id.startsWith('apr:') ? event.id.slice(4) : undefined;
      const capabilityId =
        approvalId === undefined ? undefined : capabilityByApproval.get(approvalId);
      draft.audit.push({
        organization: key,
        id: event.id,
        source: event.source,
        status: event.status,
        ...(capabilityId === undefined ? {} : { capabilityId }),
        // Everything the Audit Center answers with (never secrets): what, who
        // initiated, which agent and delegation, the origin, and who approved.
        text: [
          event.action,
          event.object,
          event.detail,
          event.actorName === undefined ? undefined : `initiated by ${event.actorName}`,
          event.agent === undefined
            ? undefined
            : `agent ${event.agent.id} ${event.agent.name ?? ''}`,
          event.delegationIds === undefined || event.delegationIds.length === 0
            ? undefined
            : `delegation ${event.delegationIds.join(' ')}`,
          event.origin === undefined ? undefined : `origin ${event.origin}`,
          event.policy === undefined
            ? undefined
            : `policy ${event.policy.id}@${event.policy.version} ${event.policy.outcome ?? ''} ${(event.policy.rules ?? []).join(' ')}`,
          event.approvalOutcome?.decidedByName === undefined
            ? undefined
            : `approved by ${event.approvalOutcome.decidedByName}`,
        ]
          .filter(Boolean)
          .join(' \n '),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reduces a response to the recorded outcome of a lifecycle step. */
function outcomeOf(response: LightMyRequestResponse): StepOutcome {
  let errorCode: string | undefined;
  try {
    errorCode = (response.json() as { error?: { code?: string } }).error?.code;
  } catch {
    errorCode = undefined;
  }
  return {
    status: response.statusCode,
    ...(errorCode === undefined ? {} : { errorCode }),
    body: response.body,
  };
}

/** Records the authorization decision; returns true when the request was allowed. */
function recordAuthorization(response: LightMyRequestResponse, draft: Draft): boolean {
  const status = response.statusCode;
  if (status === 401 || status === 403 || status === 404) {
    let errorCode: string | undefined;
    try {
      errorCode = (response.json() as { error?: { code?: string } }).error?.code;
    } catch {
      errorCode = undefined;
    }
    draft.authorization = {
      outcome: 'denied',
      httpStatus: status,
      ...(errorCode === undefined ? {} : { errorCode }),
    };
    return false;
  }
  draft.authorization = { outcome: 'allowed', httpStatus: status };
  if (status >= 400) {
    draft.errors.push(`request failed with HTTP ${status}: ${response.body.slice(0, 200)}`);
    return false;
  }
  return true;
}

/** Folds step outputs (and retrieved references) into the grounding context. */
function absorbOutputs(done: DonePayload, draft: Draft): void {
  for (const step of done.steps) {
    if (step.output === undefined) continue;
    draft.groundingContext.push(JSON.stringify(step.output));
    if (step.capabilityId === 'knowledge.search') {
      const references =
        (step.output as { references?: { documentId: string; title: string; snippet: string }[] })
          .references ?? [];
      draft.retrieval = references.map((ref) => ({
        sourceId: ref.documentId,
        title: ref.title,
        snippet: ref.snippet,
      }));
      for (const ref of references) draft.groundingContext.push(`${ref.title}\n${ref.snippet}`);
    }
  }
}

function toObservedStep(step: DonePayload['steps'][number]): ObservedStep {
  return {
    capabilityId: step.capabilityId,
    toolId: step.toolId,
    status: normalizeStepStatus(step.status),
  };
}

/** Maps AI step and remediation plan-step statuses onto one vocabulary. */
function normalizeStepStatus(status: string): string {
  switch (status) {
    case 'VERIFIED':
    case 'succeeded':
    case 'completed':
      return 'succeeded';
    case 'FAILED':
    case 'failed':
      return 'failed';
    case 'AWAITING_APPROVAL':
    case 'blocked':
    case 'BLOCKED':
      return 'blocked';
    case 'SKIPPED':
    case 'skipped':
      return 'skipped';
    default:
      return 'pending';
  }
}

/** Parses the `done` event of an SSE response body. */
function sseDone(response: LightMyRequestResponse): DonePayload | undefined {
  for (const block of response.body.split(/\r?\n\r?\n/)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (event === 'done' && data.length > 0) return JSON.parse(data.join('\n')) as DonePayload;
  }
  return undefined;
}

/**
 * Identifiers the scenario itself observed (never literal ids in a dataset):
 * `{approval}` the run's first approval, `{plan}` the remediation plan,
 * `{run}` the newest runtime run that executed something (else the newest),
 * `{invocation}` the first recorded execution invocation.
 */
async function dynamicIds(
  harness: ScenarioApp,
  draft: Draft | undefined,
): Promise<Record<string, string | undefined>> {
  if (draft === undefined) return {};
  const organizationId = harness.world.organization(draft.organization).id;
  const runs = await harness.repos.runtimeRuns!.list(organizationId, { limit: 500 });
  const executed = runs.find((run) => run.tools.length > 0);
  const lineage = await harness.repos.lineage!.list(organizationId, { kind: 'EXECUTION' });
  return {
    approval: draft.approvals.find((approval) => approval.id !== undefined)?.id,
    plan: draft.plan?.id,
    run: (executed ?? runs[0])?.id,
    invocation: lineage.find((record) => record.invocationId !== undefined)?.invocationId,
  };
}

/** Substitutes the dynamic `{approval}` / `{plan}` / `{run}` / `{invocation}` placeholders. */
function resolveDynamic(text: string, ids: Record<string, string | undefined>): string {
  return text.replace(
    /\{(approval|plan|run|invocation)\}/g,
    (match, key: string) => ids[key] ?? match,
  );
}

/** Resolves `{org:k}`, `{ws:k}`, `{id:k}`, `{user:k}` placeholders against the world. */
export function resolvePlaceholders(world: WorldIndex, text: string): string {
  return text.replace(/\{(org|ws|id|user):([^}]+)\}/g, (_match, kind: string, key: string) => {
    if (kind === 'org') return world.organization(key).id;
    if (kind === 'ws') return world.workspace(key).id;
    if (kind === 'user') return world.user(key).id;
    return world.entityId(key);
  });
}

async function timed<T>(draft: Draft, label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    draft.timings.push({ label, durationMs: performance.now() - start });
  }
}

function freeze(draft: Draft): ScenarioObservation {
  return {
    authorization: draft.authorization,
    ...(draft.runStatus === undefined ? {} : { runStatus: draft.runStatus }),
    plannedSteps: draft.plannedSteps,
    finalSteps: draft.finalSteps,
    approvals: draft.approvals,
    ...(draft.decision === undefined ? {} : { decision: draft.decision }),
    ...(draft.retrieval === undefined ? {} : { retrieval: draft.retrieval }),
    ...(draft.response === undefined ? {} : { response: draft.response }),
    groundingContext: draft.groundingContext,
    verification: draft.verification,
    audit: draft.audit,
    timings: draft.timings,
    errors: draft.errors,
  };
}
