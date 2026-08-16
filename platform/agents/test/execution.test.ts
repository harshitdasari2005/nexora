/**
 * @nexora/module-agents — governed execution tests (S26 Phase 8).
 *
 * Covers the engine's execution surface:
 * - proposal executions resolve a capability-bound intent (single capability)
 * - free-form executions bind to the agent's ENTIRE registered set
 * - a forged/unknown proposal id resolves to `no-proposal` (fail closed)
 * - a proposal whose required capability is OUTSIDE the agent set resolves
 *   to `capability-escalation` — the agent can never self-grant
 * - outcomes are journaled through the recorder and surface in `recentRuns`
 * - execution without a configured port resolves to `not-configured`
 */

import { describe, expect, it } from 'vitest';
import type {
  ActionProposal,
  AgentExecutionIntent,
  AgentExecutionOutcome,
} from '@nexora/contracts/agent';
import { createInitialCatalog } from '@nexora/module-domains';

import {
  BusinessAgentApplicationService,
  BusinessAgentRegistry,
  INITIAL_AGENTS,
  type AgentExecutionPort,
  type AgentExecutionRecorder,
  type AgentProposalProvider,
  type BusinessAgentContext,
  type BusinessAgentRoleResolver,
} from '../src/index.js';

const catalog = createInitialCatalog();

/** A fixed trusted context. */
const context: BusinessAgentContext = {
  userId: 'usr_alice',
  tenantId: 'org_acme',
  workspaceId: 'wsp_eng',
};

/** A role resolver that always resolves the executive role. */
const roleResolver: BusinessAgentRoleResolver = {
  resolve: async () => 'executive.ceo',
};

/** A proposal provider with a controllable proposal set. */
function providerWith(proposals: readonly ActionProposal[]): AgentProposalProvider {
  return { propose: async () => proposals };
}

/** A recording execution port (captures the intent it received). */
function capturingPort(): {
  port: AgentExecutionPort;
  intents: AgentExecutionIntent[];
  outcomes: AgentExecutionOutcome[];
} {
  const intents: AgentExecutionIntent[] = [];
  const outcomes: AgentExecutionOutcome[] = [];
  const port: AgentExecutionPort = {
    execute: async (_ctx, intent) => {
      intents.push(intent);
      const outcome: AgentExecutionOutcome = {
        status: 'completed',
        runId: `run_${intents.length}`,
        response: 'Done.',
        steps: [
          {
            stepId: 's1',
            capabilityId: intent.allowedCapabilityIds[0] ?? 'none',
            toolId: intent.allowedCapabilityIds[0] ?? 'none',
            status: 'succeeded',
            verified: true,
          },
        ],
        approvals: [],
        decision: { id: 'dec_1', outcome: 'completed', madeAt: '2026-08-15T00:00:00.000Z' },
      };
      outcomes.push(outcome);
      return outcome;
    },
  };
  return { port, intents, outcomes };
}

/** An in-memory recorder. */
function recordingRecorder(): { recorder: AgentExecutionRecorder; records: unknown[] } {
  const records: unknown[] = [];
  const recorder: AgentExecutionRecorder = {
    record: async (record) => {
      records.push(record);
    },
    listRecent: async (ctx, limit) =>
      (records as { tenantId: string; userId: string; createdAt: string }[])
        .filter((r) => r.tenantId === ctx.tenantId && r.userId === ctx.userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
  };
  return { recorder, records };
}

/** Builds the service under test. */
function buildService(deps: {
  proposals?: readonly ActionProposal[];
  port?: AgentExecutionPort;
  recorder?: AgentExecutionRecorder;
}): BusinessAgentApplicationService {
  const registry = new BusinessAgentRegistry(catalog);
  for (const agent of INITIAL_AGENTS) {
    registry.register(agent);
  }
  return new BusinessAgentApplicationService({
    registry,
    catalog,
    roleResolver,
    proposalProvider: providerWith(deps.proposals ?? []),
    ...(deps.port === undefined ? {} : { execution: deps.port }),
    ...(deps.recorder === undefined ? {} : { recorder: deps.recorder }),
  });
}

/** A proposal the executive agent actually has (within its set). */
const inSetProposal: ActionProposal = {
  id: 'propose_review_attention',
  action: 'Review what needs attention',
  reason: '1 unread notification requires your attention.',
  targetSystem: 'nexora',
  requiredCapability: 'notifications.what_needs_attention',
  requiresApproval: false,
  expectedResult: 'A prioritized list of the real notifications.',
};

describe('BusinessAgentApplicationService.execute (S26 Phase 8)', () => {
  it('executes a proposal restricted to its single required capability', async () => {
    const { port, intents } = capturingPort();
    const service = buildService({ proposals: [inSetProposal], port });

    const result = await service.execute(context, { proposalId: 'propose_review_attention' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.outcome.status).toBe('completed');
    expect(intents).toHaveLength(1);
    expect(intents[0]?.allowedCapabilityIds).toEqual(['notifications.what_needs_attention']);
    expect(intents[0]?.proposal?.id).toBe('propose_review_attention');
    expect(intents[0]?.utterance).toContain('Review what needs attention');
  });

  it('binds a free-form execution to the agent ENTIRE registered capability set', async () => {
    const executive = INITIAL_AGENTS.find((a) => a.id === 'executive');
    expect(executive).toBeDefined();
    const { port, intents } = capturingPort();
    const service = buildService({ port });

    const result = await service.execute(context, {
      utterance: 'What needs my attention across the organization?',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(intents[0]?.allowedCapabilityIds).toEqual([...(executive?.capabilityIds ?? [])]);
    expect(intents[0]?.proposal).toBeUndefined();
  });

  it('rejects an unknown proposal id (fail closed, no execution)', async () => {
    const { port, intents } = capturingPort();
    const service = buildService({ proposals: [inSetProposal], port });

    const result = await service.execute(context, { proposalId: 'propose_forged' });
    expect(result).toEqual({ ok: false, reason: 'no-proposal' });
    expect(intents).toHaveLength(0);
  });

  it('rejects a proposal whose capability is outside the agent set (capability escalation)', async () => {
    const { port, intents } = capturingPort();
    // A forged provider emitting a proposal for a capability the EXECUTIVE
    // agent does not have — the engine must reject it before execution.
    const escalated: ActionProposal = {
      ...inSetProposal,
      id: 'propose_forge_ceo',
      requiredCapability: 'admin.self_grant',
    };
    const service = buildService({ proposals: [escalated], port });

    const result = await service.execute(context, { proposalId: 'propose_forge_ceo' });
    expect(result).toEqual({ ok: false, reason: 'capability-escalation' });
    expect(intents).toHaveLength(0);
  });

  it('rejects a free-form request with no utterance', async () => {
    const { port } = capturingPort();
    const service = buildService({ port });
    const result = await service.execute(context, { utterance: '   ' });
    expect(result).toEqual({ ok: false, reason: 'no-proposal' });
  });

  it('journals the outcome through the recorder and surfaces it in recentRuns', async () => {
    const { port } = capturingPort();
    const { recorder, records } = recordingRecorder();
    const service = buildService({ proposals: [inSetProposal], port, recorder });

    const executed = await service.execute(context, { proposalId: 'propose_review_attention' });
    expect(executed.ok).toBe(true);
    if (!executed.ok) {
      return;
    }
    // The execute response carries the journaled run in the agent DTO.
    expect(executed.agent.recentRuns).toHaveLength(1);
    expect(executed.agent.recentRuns[0]).toMatchObject({
      agentId: 'executive',
      roleId: 'executive.ceo',
      domainId: 'executive',
      tenantId: 'org_acme',
      proposalId: 'propose_review_attention',
      status: 'completed',
    });
    expect(records).toHaveLength(1);

    // A later resolve() also returns the journaled runs (persistence).
    const resolved = await service.resolve(context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.agent.recentRuns).toHaveLength(1);
    expect(resolved.agent.recentRuns[0]?.status).toBe('completed');
  });

  it('fails safely with not-configured when no execution port is wired', async () => {
    const service = buildService({ proposals: [inSetProposal] });
    const result = await service.execute(context, { proposalId: 'propose_review_attention' });
    expect(result).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('fails safely when the caller has no business role', async () => {
    const { port } = capturingPort();
    const registry = new BusinessAgentRegistry(catalog);
    for (const agent of INITIAL_AGENTS) {
      registry.register(agent);
    }
    const service = new BusinessAgentApplicationService({
      registry,
      catalog,
      roleResolver: { resolve: async () => undefined },
      proposalProvider: providerWith([inSetProposal]),
      execution: port,
    });
    const result = await service.execute(context, { proposalId: 'propose_review_attention' });
    expect(result).toEqual({ ok: false, reason: 'no-role' });
  });

  it('fails safely when the role has no agent registered', async () => {
    const { port } = capturingPort();
    const registry = new BusinessAgentRegistry(catalog);
    for (const agent of INITIAL_AGENTS) {
      registry.register(agent);
    }
    const service = new BusinessAgentApplicationService({
      registry,
      catalog,
      // finance.cfo has no agent — fails safe.
      roleResolver: { resolve: async () => 'finance.cfo' },
      proposalProvider: providerWith([inSetProposal]),
      execution: port,
    });
    const result = await service.execute(context, { proposalId: 'propose_review_attention' });
    expect(result).toEqual({ ok: false, reason: 'no-agent' });
  });
});
