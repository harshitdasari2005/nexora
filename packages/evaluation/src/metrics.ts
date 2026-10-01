/**
 * @nexora/evaluation — per-scenario metric evaluation (pure).
 *
 * Compares one {@link ScenarioObservation} against its scenario's
 * expectations and produces a {@link ScenarioResult}. Every metric is
 * `pass` / `fail` / `not_applicable` with human-readable details, so a
 * failing scenario always says WHY. No I/O, no clock, no randomness: the
 * same observation always yields the same result.
 *
 * Metric semantics:
 * - intentCorrectness          — the observed intent class (and primary capability) match.
 * - authorizationCorrectness   — allow/deny decision (+ HTTP status / error code) match.
 * - approvalPolicyCorrectness  — an approval gate opened iff required, with the
 *                                expected side-effect class; decisions were accepted.
 * - toolSelectionCorrectness   — every expected tool planned/invoked; no forbidden tool.
 * - retrievalCorrectness       — required sources retrieved; forbidden sources never.
 * - groundingCorrectness       — required facts present, forbidden values absent,
 *                                unsupported-claim rate within bound, failures acknowledged.
 * - executionSuccess           — the execution outcome matches the expectation (a
 *                                correctly REPORTED failure counts as success of the
 *                                scenario's execution expectation).
 * - verificationSuccess        — every persisted-state post-condition holds.
 * - auditCompleteness          — required audit rows exist; forbidden rows don't.
 */

import { WorldIndex } from './factories.js';
import { checkGrounding, type GroundingResult } from './grounding.js';
import type { ObservedAuditEvent, ObservedStep, ScenarioObservation } from './observation.js';
import {
  METRIC_KEYS,
  type AuditEventMatcher,
  type IntentKind,
  type MetricKey,
  type ScenarioCategory,
  type ScenarioDefinition,
} from './scenario.js';

/** A metric verdict. */
export type MetricStatus = 'pass' | 'fail' | 'not_applicable';

/** One metric result. */
export interface MetricResult {
  status: MetricStatus;
  details: readonly string[];
}

/** The overall status of one scenario. */
export type ScenarioStatus = 'passed' | 'failed' | 'known_gap' | 'error';

/** The evaluated result of one scenario. */
export interface ScenarioResult {
  scenarioId: string;
  revision: number;
  title: string;
  category: ScenarioCategory;
  domain: string;
  tags: readonly string[];
  status: ScenarioStatus;
  /** Every applicable metric passed. */
  taskSuccess: boolean;
  metrics: Readonly<Record<MetricKey, MetricResult>>;
  /** Grounding claim accounting (null when the scenario has no response expectation). */
  grounding: {
    totalClaims: number;
    unsupportedClaims: number;
    unsupportedClaimRate: number;
    unsupported: readonly string[];
  } | null;
  latency: { totalMs: number; budgetMs?: number; withinBudget?: boolean };
  /** What was actually observed (compact, for the machine-readable report). */
  observed: {
    intent: IntentKind;
    authorization: ScenarioObservation['authorization'];
    runStatus?: string;
    execution: 'succeeded' | 'failed' | 'not_executed';
    tools: readonly string[];
    approvals: ScenarioObservation['approvals'];
    retrievedSources: readonly string[];
    timings: ScenarioObservation['timings'];
  };
  /** The declared known gap (when any) and whether it no longer reproduces. */
  knownGap?: { reason: string; metrics: readonly MetricKey[]; resolved: boolean };
  failures: readonly string[];
  errors: readonly string[];
}

/** Evaluates one scenario observation against its definition. */
export function evaluateScenario(
  scenario: ScenarioDefinition,
  observation: ScenarioObservation,
): ScenarioResult {
  const world = new WorldIndex(scenario.world);
  const expected = scenario.expected;
  const tools = observedTools(observation);
  const execution = observedExecution(observation.finalSteps);
  const intent = observedIntent(scenario, observation);

  const metrics = {} as Record<MetricKey, MetricResult>;

  // --- intent -------------------------------------------------------------
  {
    const details: string[] = [];
    if (intent !== expected.intent.kind) {
      details.push(`intent: expected ${expected.intent.kind}, observed ${intent}`);
    }
    const capability = expected.intent.capability;
    if (capability !== undefined) {
      const planned = observation.plannedSteps.map((step) => step.capabilityId);
      if (!planned.includes(capability)) {
        details.push(`capability ${capability} not planned (planned: ${list(planned)})`);
      }
    }
    metrics.intentCorrectness = verdict(details);
  }

  // --- authorization ------------------------------------------------------
  {
    const details: string[] = [];
    const auth = observation.authorization;
    if (auth.outcome !== expected.authorization.outcome) {
      details.push(
        `authorization: expected ${expected.authorization.outcome}, observed ${auth.outcome} (HTTP ${auth.httpStatus})`,
      );
    }
    if (
      expected.authorization.httpStatus !== undefined &&
      auth.httpStatus !== expected.authorization.httpStatus
    ) {
      details.push(
        `HTTP status: expected ${expected.authorization.httpStatus}, observed ${auth.httpStatus}`,
      );
    }
    if (
      expected.authorization.errorCode !== undefined &&
      auth.errorCode !== expected.authorization.errorCode
    ) {
      details.push(
        `error code: expected ${expected.authorization.errorCode}, observed ${auth.errorCode ?? 'none'}`,
      );
    }
    metrics.authorizationCorrectness = verdict(details);
  }

  // --- approval policy ----------------------------------------------------
  {
    const details: string[] = [];
    const opened = observation.approvals.length > 0;
    if (opened !== expected.approval.required) {
      details.push(
        expected.approval.required
          ? 'an approval gate was required but none was opened'
          : `no approval expected, but ${observation.approvals.length} gate(s) opened (${list(observation.approvals.map((a) => a.capabilityId))})`,
      );
    }
    const sideEffect = expected.approval.sideEffectClass;
    if (sideEffect !== undefined) {
      for (const approval of observation.approvals) {
        if (approval.sideEffectClass !== undefined && approval.sideEffectClass !== sideEffect) {
          details.push(
            `gate ${approval.capabilityId}: side-effect class ${approval.sideEffectClass}, expected ${sideEffect}`,
          );
        }
      }
    }
    const decision =
      scenario.request.channel === 'chat' ||
      scenario.request.channel === 'remediation' ||
      scenario.request.channel === 'agent'
        ? scenario.request.decision
        : undefined;
    if (decision !== undefined && expected.approval.required) {
      if (observation.decision === undefined) {
        details.push('the scenario decision was never submitted');
      } else if (observation.decision.httpStatus !== 200) {
        details.push(
          `the ${decision.decision} decision was refused (HTTP ${observation.decision.httpStatus})`,
        );
      }
    }
    metrics.approvalPolicyCorrectness = verdict(details);
  }

  // --- tool selection -----------------------------------------------------
  if (expected.tools.expected.length === 0 && expected.tools.forbidden.length === 0) {
    metrics.toolSelectionCorrectness = notApplicable();
  } else {
    const details: string[] = [];
    for (const tool of expected.tools.expected) {
      if (!tools.includes(tool)) details.push(`expected tool ${tool} was not selected`);
    }
    for (const tool of expected.tools.forbidden) {
      if (tools.includes(tool)) details.push(`forbidden tool ${tool} was selected`);
    }
    metrics.toolSelectionCorrectness = verdict(details);
  }

  // --- retrieval ----------------------------------------------------------
  const retrievedSources = (observation.retrieval ?? []).map((ref) => ref.sourceId);
  if (expected.retrieval === undefined) {
    metrics.retrievalCorrectness = notApplicable();
  } else {
    const details: string[] = [];
    if (observation.retrieval === undefined && expected.retrieval.required.length > 0) {
      details.push('no retrieval ran');
    }
    for (const key of expected.retrieval.required) {
      if (!retrievedSources.includes(world.entityId(key)))
        details.push(`required source ${key} not retrieved`);
    }
    for (const key of expected.retrieval.forbidden) {
      if (retrievedSources.includes(world.entityId(key)))
        details.push(`forbidden source ${key} was retrieved`);
    }
    metrics.retrievalCorrectness = verdict(details);
  }

  // --- grounding ----------------------------------------------------------
  let grounding: GroundingResult | undefined;
  if (expected.response === undefined) {
    metrics.groundingCorrectness = notApplicable();
  } else if (observation.response === undefined) {
    metrics.groundingCorrectness = verdict(['no response was produced']);
  } else {
    grounding = checkGrounding({
      response: observation.response,
      context: observation.groundingContext,
      vocabulary: world.namedValues().map((entry) => entry.value),
      succeededCapabilities: observation.finalSteps
        .filter((step) => step.status === 'succeeded')
        .map((step) => step.capabilityId),
      approvalGranted:
        observation.decision?.decision === 'approve' && observation.decision.httpStatus === 200,
      requiredFacts: expected.response.requiredFacts.map((fact) => fact.value),
      forbiddenValues: expected.response.forbiddenValues,
      acknowledgesFailure: expected.response.acknowledgesFailure,
      maxUnsupportedClaimRate: expected.response.maxUnsupportedClaimRate,
    });
    metrics.groundingCorrectness = verdict(grounding.failures);
  }

  // --- execution ----------------------------------------------------------
  metrics.executionSuccess = verdict(
    execution === expected.execution.outcome
      ? []
      : [`execution: expected ${expected.execution.outcome}, observed ${execution}`],
  );

  // --- verification -------------------------------------------------------
  if (expected.verification.checks.length === 0) {
    metrics.verificationSuccess = notApplicable();
  } else {
    const details: string[] = [];
    if (observation.verification.length !== expected.verification.checks.length) {
      details.push(
        `expected ${expected.verification.checks.length} post-condition(s), evaluated ${observation.verification.length}`,
      );
    }
    for (const check of observation.verification) {
      if (!check.passed)
        details.push(`${check.description} (actual: ${JSON.stringify(check.actual)})`);
    }
    metrics.verificationSuccess = verdict(details);
  }

  // --- audit --------------------------------------------------------------
  if (expected.audit.required.length === 0 && expected.audit.forbidden.length === 0) {
    metrics.auditCompleteness = notApplicable();
  } else {
    const details: string[] = [];
    for (const matcher of expected.audit.required) {
      const count = observation.audit.filter((event) =>
        matchesAudit(event, matcher, scenario.organization, world),
      ).length;
      if (matcher.exactly === undefined ? count === 0 : count !== matcher.exactly) {
        details.push(
          matcher.exactly === undefined
            ? `missing audit event ${describeMatcher(matcher)}`
            : `audit event ${describeMatcher(matcher)}: expected exactly ${matcher.exactly}, observed ${count}`,
        );
      }
    }
    for (const matcher of expected.audit.forbidden) {
      const hit = observation.audit.find((event) =>
        matchesAudit(event, matcher, scenario.organization, world),
      );
      // Described by stable attributes, never by the platform-minted id, so
      // two runs of the same dataset produce byte-identical verdicts.
      if (hit !== undefined) {
        details.push(
          `forbidden audit event ${describeMatcher(matcher)} present (${hit.source}, status ${hit.status}${hit.capabilityId === undefined ? '' : `, ${hit.capabilityId}`})`,
        );
      }
    }
    metrics.auditCompleteness = verdict(details);
  }

  // --- roll-up ------------------------------------------------------------
  const failing = METRIC_KEYS.filter((key) => metrics[key].status === 'fail');
  const taskSuccess = failing.length === 0 && observation.errors.length === 0;
  const failures = failing.flatMap((key) =>
    metrics[key].details.map((detail) => `${key}: ${detail}`),
  );

  let status: ScenarioStatus;
  let knownGap: ScenarioResult['knownGap'];
  if (observation.errors.length > 0) {
    status = 'error';
  } else if (failing.length === 0) {
    status = 'passed';
  } else if (
    scenario.knownGap !== undefined &&
    failing.every((key) => scenario.knownGap?.metrics.includes(key))
  ) {
    status = 'known_gap';
  } else {
    status = 'failed';
  }
  if (scenario.knownGap !== undefined) {
    knownGap = {
      reason: scenario.knownGap.reason,
      metrics: scenario.knownGap.metrics,
      resolved: status === 'passed',
    };
  }

  const totalMs = observation.timings.reduce((sum, timing) => sum + timing.durationMs, 0);
  const budgetMs = expected.latencyBudgetMs;

  return {
    scenarioId: scenario.id,
    revision: scenario.revision,
    title: scenario.title,
    category: scenario.category,
    domain: scenario.domain,
    tags: scenario.tags,
    status,
    taskSuccess,
    metrics,
    grounding:
      grounding === undefined
        ? null
        : {
            totalClaims: grounding.totalClaims,
            unsupportedClaims: grounding.unsupportedClaims,
            unsupportedClaimRate: grounding.unsupportedClaimRate,
            unsupported: grounding.claims
              .filter((claim) => !claim.supported)
              .map((claim) => `${claim.kind}:${claim.value}`),
          },
    latency: {
      totalMs: round(totalMs),
      ...(budgetMs === undefined ? {} : { budgetMs, withinBudget: totalMs <= budgetMs }),
    },
    observed: {
      intent,
      authorization: observation.authorization,
      ...(observation.runStatus === undefined ? {} : { runStatus: observation.runStatus }),
      execution,
      tools,
      approvals: observation.approvals,
      retrievedSources,
      timings: observation.timings.map((timing) => ({
        ...timing,
        durationMs: round(timing.durationMs),
      })),
    },
    ...(knownGap === undefined ? {} : { knownGap }),
    failures,
    errors: observation.errors,
  };
}

/** Every tool/capability id planned or invoked. */
export function observedTools(observation: ScenarioObservation): readonly string[] {
  const ids = new Set<string>();
  for (const step of [...observation.plannedSteps, ...observation.finalSteps]) {
    ids.add(step.capabilityId);
    if (step.toolId !== undefined) ids.add(step.toolId);
  }
  for (const approval of observation.approvals) ids.add(approval.capabilityId);
  return [...ids].sort();
}

/** The execution outcome implied by the final steps. */
export function observedExecution(
  steps: readonly ObservedStep[],
): 'succeeded' | 'failed' | 'not_executed' {
  const executed = steps.filter((step) => step.status === 'succeeded' || step.status === 'failed');
  if (executed.length === 0) return 'not_executed';
  return executed.some((step) => step.status === 'failed') ? 'failed' : 'succeeded';
}

/** The observed intent class. */
export function observedIntent(
  scenario: ScenarioDefinition,
  observation: ScenarioObservation,
): IntentKind {
  if (observation.authorization.outcome === 'denied') return 'refused';
  if (scenario.request.channel === 'remediation') return 'remediation';
  const planned = observation.plannedSteps.map((step) => step.capabilityId);
  if (planned.length === 0) return 'clarification';
  if (planned.some((capability) => capability.startsWith('workflow.'))) return 'workflow';
  if (observation.approvals.length > 0) return 'action';
  return 'information';
}

function matchesAudit(
  event: ObservedAuditEvent,
  matcher: AuditEventMatcher,
  defaultOrganization: string,
  world: WorldIndex,
): boolean {
  if (event.organization !== (matcher.organization ?? defaultOrganization)) return false;
  if (event.source !== matcher.source) return false;
  if (matcher.status !== undefined && event.status !== matcher.status) return false;
  if (matcher.capability !== undefined && event.capabilityId !== matcher.capability) return false;
  if (
    matcher.mentions !== undefined &&
    !event.text.toLowerCase().includes(resolveMention(world, matcher.mentions).toLowerCase())
  ) {
    return false;
  }
  return true;
}

/** `{id:key}` in a `mentions` matcher resolves to the fixture's deterministic id. */
function resolveMention(world: WorldIndex, mention: string): string {
  return mention.replace(/\{id:([^}]+)\}/g, (_match, key: string) => world.entityId(key));
}

function describeMatcher(matcher: AuditEventMatcher): string {
  return `{${Object.entries(matcher)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')}}`;
}

function verdict(details: readonly string[]): MetricResult {
  return { status: details.length === 0 ? 'pass' : 'fail', details };
}

function notApplicable(): MetricResult {
  return { status: 'not_applicable', details: [] };
}

function list(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join(', ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
