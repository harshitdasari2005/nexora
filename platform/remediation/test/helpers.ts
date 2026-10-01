/**
 * @nexora/module-remediation — in-memory test doubles (Phase 10).
 */

import type { AgentExecutionIntent, AgentExecutionOutcome } from '@nexora/contracts/agent';
import type { BusinessProblemDto } from '@nexora/contracts/detection';

import type { LineageRepository } from '@nexora/module-lineage';
import { RemediationApplicationService } from '../src/application/remediation-application-service.js';
import { DefaultApprovalRoutingPolicy } from '../src/application/approval-routing.js';
import { InMemoryPlanStore } from '../src/application/plan-store.js';
import type {
  RemediationAgent,
  RemediationAgentResolver,
  RemediationApprovalEngine,
  RemediationCapabilityMetadata,
  RemediationCapabilityProvider,
  RemediationContext,
  RemediationExecutionPort,
  RemediationExecutionRecorder,
  RemediationProblemLifecyclePort,
  RemediationProblemProvider,
  RemediationProblemReevaluator,
} from '../src/application/remediation-ports.js';

/** A fixed agent resolver (swappable per test). */
export function agentResolver(
  agent: RemediationAgent | undefined = {
    id: 'executive',
    roleId: 'executive.ceo',
    domainId: 'executive',
    capabilityIds: ['projects.find_project', 'calendar.create_event', 'finance.review_ledger'],
  },
): RemediationAgentResolver {
  return {
    async resolve() {
      return agent;
    },
  };
}

/** A problem provider backed by a mutable map. */
export function problemProvider(
  problems: Map<string, BusinessProblemDto>,
): RemediationProblemProvider {
  return {
    async getById(context, problemId) {
      const problem = problems.get(problemId);
      return problem === undefined || problem.tenantId !== context.tenantId ? undefined : problem;
    },
    async listByIds(context, problemIds) {
      return problemIds
        .map((problemId) => problems.get(problemId))
        .filter(
          (problem): problem is BusinessProblemDto =>
            problem !== undefined && problem.tenantId === context.tenantId,
        );
    },
  };
}

/** A reevaluator whose answer + fresh DTO can be mutated per test. */
export class FakeReevaluator implements RemediationProblemReevaluator {
  /** stillPresent per problemId; defaults to true. */
  stillPresent = new Map<string, boolean>();
  /** The fresh problem returned; defaults to the provider's current DTO. */
  freshProblems = new Map<string, BusinessProblemDto>();

  constructor(readonly problems: Map<string, BusinessProblemDto>) {}

  async reevaluate(context: RemediationContext, problemId: string) {
    const problem = this.problems.get(problemId);
    if (problem === undefined || problem.tenantId !== context.tenantId) {
      return undefined;
    }
    return {
      stillPresent: this.stillPresent.get(problemId) ?? true,
      problem: this.freshProblems.get(problemId) ?? problem,
    };
  }
}

/** A lifecycle port that records transitions (and allows injecting failures). */
export class FakeLifecycle implements RemediationProblemLifecyclePort {
  transitions: { problemId: string; status: string }[] = [];
  allow = true;

  async transition(context: RemediationContext, problemId: string, status: string) {
    this.transitions.push({ problemId, status });
    return this.allow;
  }
}

/** A capability provider backed by a map. */
export function capabilityProvider(
  capabilities: ReadonlyMap<string, RemediationCapabilityMetadata>,
): RemediationCapabilityProvider {
  return {
    async resolve(capabilityId) {
      return capabilities.get(capabilityId);
    },
  };
}

/** The default capability metadata map used across tests. */
export function defaultCapabilities(): Map<string, RemediationCapabilityMetadata> {
  return new Map([
    [
      'projects.find_project',
      {
        capabilityId: 'projects.find_project',
        name: 'Find Project',
        sideEffectClass: 'read_only',
        toolId: 'projects.find_project',
      },
    ],
    [
      'calendar.create_event',
      {
        capabilityId: 'calendar.create_event',
        name: 'Create Calendar Event',
        sideEffectClass: 'consequential',
        toolId: 'calendar.create_event',
      },
    ],
    [
      'finance.review_ledger',
      {
        capabilityId: 'finance.review_ledger',
        name: 'Review Ledger',
        sideEffectClass: 'read_only',
        toolId: 'finance.review_ledger',
      },
    ],
  ]);
}

/** A recording execution port (outcomes settable per invocation). */
export class FakeExecutionPort implements RemediationExecutionPort {
  calls: { context: RemediationContext; intent: AgentExecutionIntent }[] = [];
  outcomes: AgentExecutionOutcome[] = [];

  async execute(context: RemediationContext, intent: AgentExecutionIntent) {
    this.calls.push({ context, intent });
    const outcome =
      this.outcomes.shift() ??
      completedOutcome({
        steps: [
          {
            stepId: 's1',
            capabilityId: intent.allowedCapabilityIds[0] ?? '',
            toolId: 'tool',
            status: 'succeeded',
            verified: true,
          },
        ],
      });
    return outcome;
  }
}

/** A recording execution journal. */
export class FakeRecorder implements RemediationExecutionRecorder {
  records: unknown[] = [];
  async record(input: Parameters<RemediationExecutionRecorder['record']>[0]) {
    this.records.push(input);
  }
}

/** An in-memory approval engine keyed by resume key (dedupe + decisions). */
export class FakeApprovalEngine implements RemediationApprovalEngine {
  requests = new Map<string, { id: string; status: string; resumeKey: string; tenantId: string }>();
  nextStatus = 'pending';
  /** Every `open` input, for asserting the authoritative approver requirement. */
  opened: Array<Parameters<RemediationApprovalEngine['open']>[0]> = [];

  async open(input: Parameters<RemediationApprovalEngine['open']>[0]) {
    const existing = this.requests.get(input.resumeKey);
    if (existing !== undefined) {
      return { id: existing.id };
    }
    this.opened.push(input);
    const id = `apr_${this.requests.size + 1}`;
    this.requests.set(input.resumeKey, {
      id,
      status: this.nextStatus,
      resumeKey: input.resumeKey,
      tenantId: input.tenantId,
    });
    return { id };
  }

  async byResumeKey(tenantId: string, resumeKey: string) {
    const request = this.requests.get(resumeKey);
    return request === undefined || request.tenantId !== tenantId ? undefined : request;
  }

  async decisionStatus(id: string) {
    for (const request of this.requests.values()) {
      if (request.id === id) {
        if (request.status === 'rejected') {
          return 'rejected';
        }
        if (request.status === 'expired') {
          return 'expired';
        }
        if (request.status === 'granted' || request.status === 'approved') {
          return 'granted';
        }
        return 'pending';
      }
    }
    return undefined;
  }
}

/** Builds a completed execution outcome. */
export function completedOutcome(
  overrides: Partial<AgentExecutionOutcome> = {},
): AgentExecutionOutcome {
  return {
    status: 'completed',
    runId: 'run_1',
    response: 'The action completed and was verified.',
    steps: [
      { stepId: 's1', capabilityId: 'c1', toolId: 't1', status: 'succeeded', verified: true },
    ],
    approvals: [],
    ...overrides,
  };
}

/** Builds a failed execution outcome. */
export function failedOutcome(message = 'The tool failed'): AgentExecutionOutcome {
  return {
    status: 'failed',
    runId: 'run_fail',
    response: message,
    steps: [
      {
        stepId: 's1',
        capabilityId: 'c1',
        toolId: 't1',
        status: 'failed',
        verified: false,
        error: message,
      },
    ],
    approvals: [],
  };
}

/** The standard test problem fixture (a workflow-failure problem). */
export function problemFixture(overrides: Partial<BusinessProblemDto> = {}): BusinessProblemDto {
  return {
    id: 'prb_1',
    correlationId: 'workflow_failure:org_a:org:wf_auth',
    signalId: 'workflow_failure',
    signalName: 'Workflow failure',
    tenantId: 'org_a',
    workspaceId: 'wsp_1',
    title: 'wf_auth requires attention',
    description: 'wf_auth failed 6 times.',
    severity: 'high',
    status: 'DETECTED',
    detectedAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    affectedEntities: [{ type: 'workflow', id: 'wf_auth', title: 'wf_auth' }],
    remediationCapabilities: ['projects.find_project', 'calendar.create_event'],
    evidence: [{ id: 'evd_1', source: 'measurements', fact: 'wf_auth failed 6 times.' }],
    rootCauses: [],
    solutions: [
      {
        id: 'sol_1',
        source: 'knowledge',
        title: 'AUTH-017 Authentication correction',
        description: 'Correct the authentication configuration.',
        reference: { id: 'kn_1', title: 'AUTH-017 Authentication correction' },
        applicability: 'APPLICABLE',
        confidence: 'MEDIUM',
        requiredCapabilities: ['projects.find_project', 'calendar.create_event'],
      },
    ],
    recommendation: { summary: 'Known solution found.' },
    ...overrides,
  };
}

/** A problem WITHOUT any applicable solution (Case B). */
export function noSolutionProblem(overrides: Partial<BusinessProblemDto> = {}): BusinessProblemDto {
  return problemFixture({
    solutions: [],
    recommendation: { summary: 'No known solution found.' },
    ...overrides,
  });
}

/** Composes a service with the standard fakes (overridable per test). */
export function buildService(
  overrides: {
    agent?: RemediationAgent | undefined;
    problems?: Map<string, BusinessProblemDto>;
    reevaluator?: FakeReevaluator;
    lifecycle?: FakeLifecycle;
    capabilities?: ReadonlyMap<string, RemediationCapabilityMetadata>;
    execution?: FakeExecutionPort;
    recorder?: FakeRecorder;
    approvals?: FakeApprovalEngine;
    store?: InMemoryPlanStore;
    lineage?: LineageRepository;
  } = {},
) {
  const problems =
    overrides.problems ?? new Map<string, BusinessProblemDto>([['prb_1', problemFixture()]]);
  const reevaluator = overrides.reevaluator ?? new FakeReevaluator(problems);
  const lifecycle = overrides.lifecycle ?? new FakeLifecycle();
  const execution = overrides.execution ?? new FakeExecutionPort();
  const recorder = overrides.recorder ?? new FakeRecorder();
  const approvals = overrides.approvals ?? new FakeApprovalEngine();
  const store = overrides.store ?? new InMemoryPlanStore();
  const service = new RemediationApplicationService({
    store,
    agentResolver: agentResolver(overrides.agent),
    problemProvider: problemProvider(problems),
    reevaluator,
    lifecycle,
    capabilities: capabilityProvider(overrides.capabilities ?? defaultCapabilities()),
    routing: new DefaultApprovalRoutingPolicy(),
    approvals,
    execution,
    recorder,
    ...(overrides.lineage === undefined ? {} : { lineage: overrides.lineage }),
  });
  return { service, problems, reevaluator, lifecycle, execution, recorder, approvals, store };
}

/** Asserts a plan DTO's steps are PENDING in sequence order. */
export function stepActions(plan: {
  steps: readonly { action: string; capabilityId: string; sequence: number }[];
}) {
  return plan.steps.map((step) => ({
    sequence: step.sequence,
    capabilityId: step.capabilityId,
    action: step.action,
  }));
}
