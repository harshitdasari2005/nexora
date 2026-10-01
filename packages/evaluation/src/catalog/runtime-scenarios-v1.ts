/**
 * @nexora/evaluation — AI runtime observability + execution telemetry
 * scenarios (dataset 1.6.0, NXS-091 …).
 *
 * The principle under test: **observability describes how the runtime
 * PERFORMED; it never decides anything and never exposes anything.** Audit
 * says what happened, lineage says what data/results were connected, and the
 * runtime run record says where the time went and where a run failed.
 *
 * Each scenario re-drives a REAL governed request that an earlier dataset
 * version already covers (same world, same request, same expectations — so
 * the platform behaviour itself stays asserted) and adds post-conditions over
 * the telemetry the real runtime persisted (`runtime_runs`) and over what an
 * operator sees on the real HTTP surface. Nothing here constructs a metric.
 * Durations are only ever compared through booleans (never exact values).
 */

import { extendWorld } from '../factories.js';
import type { ScenarioDefinition, ScenarioWorld, StateCheck } from '../scenario.js';

type Runtime = Extract<StateCheck, { kind: 'runtime' }>;

/** A runtime post-condition over the persisted runs of Aurora. */
function runs(attributes: Omit<Runtime, 'kind' | 'organization'>): Runtime {
  return { kind: 'runtime', organization: 'aurora', ...attributes };
}

/** Builds the runtime observability scenarios by extending already-covered governed requests. */
export function buildRuntimeScenariosV1(
  base: ScenarioWorld,
  existing: readonly ScenarioDefinition[],
): ScenarioDefinition[] {
  const source = (id: string): ScenarioDefinition => {
    const found = existing.find((scenario) => scenario.id === id);
    if (found === undefined) {
      throw new Error(`runtime scenarios extend ${id}, which is not in the dataset`);
    }
    return found;
  };

  /** Re-drives `sourceId` under a new id, appending telemetry post-conditions. */
  const extend = (
    sourceId: string,
    definition: {
      id: string;
      title: string;
      description: string;
      tags?: readonly string[];
      checks: readonly StateCheck[];
      modelFixture?: ScenarioDefinition['modelFixture'];
      request?: Partial<ScenarioDefinition['request']>;
      world?: ScenarioWorld;
      /** Overrides for what the (re-driven) request is expected to do. */
      expected?: Partial<ScenarioDefinition['expected']>;
    },
  ): ScenarioDefinition => {
    const from = { ...source(sourceId) };
    delete from.knownGap;
    return {
      ...from,
      id: definition.id,
      revision: 1,
      title: definition.title,
      category: 'runtime_observability',
      description: definition.description,
      tags: [...(definition.tags ?? []), 'runtime', 'observability'],
      world: definition.world ?? from.world,
      request: { ...from.request, ...definition.request } as ScenarioDefinition['request'],
      expected: {
        ...from.expected,
        ...definition.expected,
        // A fixture model's fixed narration cannot state world facts, so it
        // is graded on what it must NOT claim (no unsupported claims).
        ...(definition.modelFixture === undefined ||
        definition.modelFixture.behavior === 'error' ||
        from.expected.response === undefined
          ? {}
          : { response: { ...from.expected.response, requiredFacts: [] } }),
        verification: {
          // A scenario that had no post-conditions now has telemetry ones.
          outcome:
            from.expected.verification.outcome === 'not_applicable'
              ? 'verified'
              : from.expected.verification.outcome,
          checks: [...from.expected.verification.checks, ...definition.checks],
        },
      },
      ...(definition.modelFixture === undefined ? {} : { modelFixture: definition.modelFixture }),
    } as ScenarioDefinition;
  };

  const retrieval = 'NXS-071';
  const policyDeny = 'NXS-052';
  const toolFailure = 'NXS-012';
  const approved = 'NXS-003';

  return [
    extend(retrieval, {
      id: 'NXS-091',
      title: 'A successful run records where its time went',
      description:
        'A knowledge question completes. The persisted run has a completed status, a request id, and timing only for the stages that actually ran (request, planning, retrieval, verification, narration) — approval and execution are ABSENT, not zero — and one tool call that succeeded.',
      checks: [
        runs({
          status: 'completed',
          hasRequestId: true,
          stagesPresent: ['REQUEST', 'PLANNING', 'RETRIEVAL', 'VERIFICATION', 'NARRATION'],
          stagesAbsent: ['APPROVAL', 'EXECUTION'],
          toolCalls: 1,
          toolStatus: 'succeeded',
          toolTimed: true,
          equals: 1,
        }),
      ],
    }),
    extend(policyDeny, {
      id: 'NXS-092',
      title: 'A policy denial records the stage where it failed',
      description:
        'Policy refuses an expense against a closed budget. The run failed at the POLICY stage with POLICY_DENIED (class DENIED) and carries the policy id and version that decided — and no tool call, because nothing ran.',
      checks: [
        runs({
          status: 'failed',
          failureStage: 'POLICY',
          failureCode: 'POLICY_DENIED',
          failureClass: 'DENIED',
          policyOutcome: 'DENY',
          toolCalls: 0,
          stagesAbsent: ['EXECUTION', 'APPROVAL'],
          equals: 1,
        }),
      ],
    }),
    extend(toolFailure, {
      id: 'NXS-093',
      title: 'A failing tool is recorded as an execution failure with its timing',
      description:
        'The external provider is down. The run failed at the EXECUTION stage (class EXECUTION, not a denial), the failed tool call has its own timing and status, and it was attempted exactly once — no hidden retry.',
      checks: [
        runs({
          status: 'failed',
          failureStage: 'EXECUTION',
          failureCode: 'TOOL_EXECUTION_FAILED',
          failureClass: 'EXECUTION',
          toolCalls: 1,
          toolStatus: 'failed',
          toolAttempts: 1,
          toolsOrdered: true,
          equals: 1,
        }),
      ],
    }),
    extend(retrieval, {
      id: 'NXS-094',
      title: 'A failing model is recorded, and the run still completes',
      description:
        'The upstream model returns HTTP 500. The model call is recorded as failed (MODEL_ERROR) with no token usage and no cost; narration falls back to the deterministic composer, and the run — whose work succeeded — completes.',
      modelFixture: { execution: 'local', behavior: 'error' },
      checks: [
        runs({
          status: 'completed',
          modelCalls: 1,
          modelStatus: 'failed',
          modelErrorCode: 'MODEL_ERROR',
          narrationSource: 'fallback',
          usageAvailable: false,
          costNull: true,
          equals: 1,
        }),
      ],
    }),
    extend(approved, {
      id: 'NXS-095',
      title: 'Human approval wait is not execution time',
      description:
        'A calendar write waits for a human decision that takes real time. The blocked run records the approval as opened; the resumed run records the measured human wait — and its own latency is SHORTER than that wait, so the wait was never counted as model or tool time.',
      request: { decision: { decision: 'approve', actor: 'meera', delayMs: 400 } },
      checks: [
        runs({ status: 'blocked', approvalState: 'opened', equals: 1 }),
        runs({
          status: 'completed',
          approvalState: 'resumed',
          approvalWaitAtLeastMs: 350,
          durationBelowApprovalWait: true,
          toolCalls: 1,
          equals: 1,
        }),
      ],
    }),
    extend('NXS-015', {
      id: 'NXS-096',
      title: 'A verification failure is not an execution failure',
      description:
        'A remediation step executes and its own tool result verifies, but re-evaluation finds the problem still present. The runtime records the step as a SUCCEEDED, verified tool call inside a completed run — no run failed — while the remediation plan (not telemetry) carries the unresolved outcome.',
      checks: [
        runs({ origin: 'remediation', status: 'completed', toolStatus: 'succeeded', atLeast: 1 }),
        runs({ status: 'failed', equals: 0 }),
      ],
    }),
    extend(toolFailure, {
      id: 'NXS-097',
      title: 'Retries are recorded per attempt — and there are no hidden ones',
      description:
        'Tool retries are recorded attempt by attempt (attempt number, error code, backoff). No production tool is configured to retry, so a failed call reports exactly one attempt and an empty retry list — never a fabricated retry.',
      checks: [runs({ toolCalls: 1, toolAttempts: 1, toolRetries: 0, equals: 1 })],
    }),
    extend(retrieval, {
      id: 'NXS-098',
      title: "Another tenant's operator sees none of this tenant's runs",
      description:
        "An Aurora run exists. Borealis's auditor lists runtime runs for Borealis and sees none of Aurora's; forging Aurora's organization id is refused (403); and Borealis itself recorded no runs.",
      checks: [
        {
          kind: 'runtime_operator',
          organization: 'aurora',
          readerOrganization: 'borealis',
          assert: 'list_hides_foreign',
        },
        { kind: 'runtime', organization: 'borealis', equals: 0 },
      ],
    }),
    extend(approved, {
      id: 'NXS-099',
      title: 'Telemetry records ids, codes and counts — never sensitive content',
      description:
        "A governed calendar write runs end to end. The persisted run contains no secret pattern, no forbidden key (prompt, arguments, tokens, headers, reasoning) and none of the requester's message text.",
      request: { decision: { decision: 'approve', actor: 'meera' } },
      checks: [runs({ noSensitive: true, atLeast: 1 })],
    }),
    extend(retrieval, {
      id: 'NXS-100',
      title: 'A self-hosted model is recorded as local, with its reported usage',
      description:
        'Narration goes to a self-hosted (Ollama-compatible) model over the real transport. The run records the provider, the model, local execution, the reported token counts, and the narration template version with input/output fingerprints — not the prompt.',
      modelFixture: { execution: 'local', behavior: 'ok' },
      checks: [
        runs({
          status: 'completed',
          modelCalls: 1,
          provider: 'ollama',
          execution: 'local',
          modelStatus: 'succeeded',
          modelTimed: true,
          usageAvailable: true,
          tokensAvailable: true,
          narrationSource: 'model',
          promptFingerprints: true,
          equals: 1,
        }),
      ],
    }),
    extend(retrieval, {
      id: 'NXS-101',
      title: 'A hosted model is recorded as cloud, and its credential never appears',
      description:
        'Narration goes to the hosted (Groq) adapter, whose credential is a sentinel value. The run records cloud execution — the fact that content left the deployment — and contains neither the credential nor any secret pattern.',
      modelFixture: { execution: 'cloud', behavior: 'ok' },
      checks: [
        runs({
          status: 'completed',
          provider: 'groq',
          execution: 'cloud',
          modelStatus: 'succeeded',
          noSensitive: true,
          equals: 1,
        }),
      ],
    }),
    extend(retrieval, {
      id: 'NXS-102',
      title: 'Token usage a provider did not report stays unknown',
      description:
        'The model response carries no usage block. The run records usageAvailable=false and token usage as unavailable — never an estimate from the text length.',
      modelFixture: { execution: 'local', behavior: 'no_usage' },
      checks: [
        runs({
          modelCalls: 1,
          modelStatus: 'succeeded',
          usageAvailable: false,
          tokensAvailable: false,
          equals: 1,
        }),
      ],
    }),
    extend(retrieval, {
      id: 'NXS-103',
      title: 'Cost without trusted pricing stays null',
      description:
        'Usage IS reported, but no versioned pricing is configured. The run records the tokens and a cost of null — never an invented price.',
      modelFixture: { execution: 'local', behavior: 'ok' },
      checks: [
        runs({
          modelCalls: 1,
          usageAvailable: true,
          tokensAvailable: true,
          costNull: true,
          equals: 1,
        }),
      ],
    }),
    extend('NXS-007', {
      id: 'NXS-104',
      title: 'A multi-step run records its tool calls in order',
      description:
        'An approved workflow executes several tools. Every call the runtime recorded has a finite duration and the calls are listed in the order they started.',
      checks: [runs({ approvalState: 'resumed', toolsOrdered: true, atLeast: 1 })],
    }),
    extend(approved, {
      id: 'NXS-105',
      title: 'Request, run, tool and execution share one correlation',
      description:
        'The run carries the HTTP request id, and every tool invocation it recorded is the SAME invocation id lineage recorded as an execution under the SAME run id — one thread from request to execution.',
      checks: [
        runs({ status: 'completed', hasRequestId: true, correlatedToLineage: true, equals: 1 }),
      ],
    }),
    extend(toolFailure, {
      id: 'NXS-106',
      title: 'A slow dependency is named as the bottleneck from real timings',
      description:
        "The GitHub connector takes real time to answer. The operator's run detail names that tool as the slowest call — computed from this run's own recorded timings, not an average.",
      // A healthy (slow) dependency: the read SUCCEEDS.
      expected: { execution: { outcome: 'succeeded' }, response: undefined },
      world: extendWorld(base, 'NXS-106', (world) =>
        world.connector('github', {
          organization: 'aurora',
          provider: 'github',
          behavior: 'slow',
          delayMs: 250,
        }),
      ),
      checks: [
        {
          kind: 'runtime_operator',
          organization: 'aurora',
          readerOrganization: 'aurora',
          assert: 'detail_bottleneck_tool',
          tool: 'github.repositories.list',
        },
      ],
    }),
    extend(retrieval, {
      id: 'NXS-107',
      title: "Another tenant's run id is indistinguishable from a missing one",
      description:
        "Borealis's auditor asks for an Aurora run by id and gets the same 404 (same code, same message) as for an id that never existed.",
      checks: [
        {
          kind: 'runtime_operator',
          organization: 'aurora',
          readerOrganization: 'borealis',
          assert: 'detail_not_found',
        },
      ],
    }),
    extend(policyDeny, {
      id: 'NXS-108',
      title: 'A policy denial is never retried',
      description:
        'Denials are final. The refused expense produced no tool call at all — zero attempts, zero retries — so a retry can never re-ask a question policy already answered.',
      checks: [runs({ failureClass: 'DENIED', toolCalls: 0, equals: 1 })],
    }),
    extend('NXS-032', {
      id: 'NXS-109',
      title: 'A security block is distinguishable from an infrastructure failure',
      description:
        'An agent without a delegation is refused. The run is classified DENIED at the AUTHORIZATION stage (AGENT_DENIED) — an operator can tell it apart from a tool or provider failure (class EXECUTION / INFRASTRUCTURE), and nothing ran.',
      checks: [
        runs({
          status: 'failed',
          failureStage: 'AUTHORIZATION',
          failureCode: 'AGENT_DENIED',
          failureClass: 'DENIED',
          toolCalls: 0,
          equals: 1,
        }),
        runs({ failureClass: 'EXECUTION', equals: 0 }),
      ],
    }),
    extend(approved, {
      id: 'NXS-110',
      title: 'The operator detail exposes no secrets',
      description:
        "The operator's run list and run detail — read over the real HTTP surface by the organization's auditor — contain no secret pattern, no forbidden key and none of the requester's message text.",
      request: { decision: { decision: 'approve', actor: 'meera' } },
      checks: [
        {
          kind: 'runtime_operator',
          organization: 'aurora',
          readerOrganization: 'aurora',
          assert: 'detail_safe',
        },
      ],
    }),
  ];
}
