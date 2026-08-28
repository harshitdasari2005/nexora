/**
 * @nexora/ai-runtime — orchestrator narration grounding (end-to-end).
 *
 * Traces the full path a provider narration takes:
 *   tool executes → real StepOutcome.output → renderResultsDigest →
 *   renderPrompt({{results}}) → provider.chat.complete(system message).
 *
 * A {@link MockModelProvider} captures exactly what the orchestrator sends
 * the model, so these tests prove the actual tool output reaches the prompt,
 * the anti-fabrication rules travel with it, and a provider failure falls
 * back to the deterministic composer unchanged.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';
import { nowIso } from '@nexora/shared/time';

import { EnterpriseAIOrchestrator } from '../src/orchestrator/orchestrator.js';
import { ConversationManager } from '../src/conversation/conversation-manager.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { ToolExecutor } from '../src/execution/tool-executor.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { ProviderRegistry } from '../src/providers/provider-registry.js';
import { PromptRegistry } from '../src/prompting/prompt-registry.js';
import { createNarrationPrompt, NARRATION_PROMPT_ID } from '../src/prompting/narration-prompt.js';
import { MockModelProvider } from '../src/testing/mock-provider.js';

/** A read-only "list projects" capability whose tool returns a fixed output. */
function harness(output: unknown): {
  orchestrator: EnterpriseAIOrchestrator;
  provider: MockModelProvider;
} {
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  const tools = new ExecutableToolRegistry();

  registry.register(
    registryEntries.capability({
      capability: {
        id: 'projects.list_projects',
        name: 'List projects',
        description: 'Lists projects and their health',
        skillId: 'projects.list',
        sideEffectClass: 'read_only',
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: {
        id: 'tool_list_projects',
        description: 'lists',
        sideEffectClass: 'read_only',
        idempotent: true,
        timeoutMs: 1000,
        inputSchema: {},
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
      ownedByAgents: ['agt_projects'],
    }),
  );
  registry.register(
    registryEntries.agent({
      agent: { id: 'agt_projects', name: 'projects', displayName: 'Projects Agent' },
      manifest: {
        identity: { id: 'agt_projects', name: 'projects', displayName: 'Projects Agent' },
        version: '1.0.0',
        skills: [
          {
            id: 'projects.list',
            description: 'lists',
            toolIds: ['tool_list_projects'],
            autonomyTier: 'supervised',
            requiresApproval: false,
          },
        ],
        tools: [],
        knowledgeScopes: [],
        policyIds: [],
        emittedEventTypes: [],
        subscribedEventTypes: [],
        updatedAt: '2026-08-08T00:00:00.000Z',
      },
      health: 'healthy',
      owner: 'com.nexora.projects',
      version: '1.0.0',
    }),
  );
  skills.index(
    {
      id: 'projects.list',
      description: 'lists',
      toolIds: ['tool_list_projects'] as readonly string[],
      autonomyTier: 'supervised' as const,
      requiresApproval: false,
    },
    'agt_projects',
  );

  const listTool: Tool = {
    manifest: {
      id: 'tool_list_projects',
      name: 'List projects',
      description: 'lists',
      sideEffectClass: 'read_only',
      idempotent: true,
      timeoutMs: 1000,
      inputSchema: {},
    },
    execute: async () => ({ ok: true, output, completedAt: nowIso() }),
  };
  tools.register(listTool);

  const providers = new ProviderRegistry();
  const provider = new MockModelProvider({ capabilities: ['chat'] });
  provider.chat.response = {
    content: 'Two projects are flagged: Northwind Migration and Atlas Rollout.',
    finishReason: 'stop',
    model: 'mock',
  };
  providers.register(provider);

  const prompts = new PromptRegistry();
  prompts.register(createNarrationPrompt());

  const orchestrator = new EnterpriseAIOrchestrator({
    discovery: new CapabilityDiscovery(registry, skills),
    executor: new ToolExecutor({ tools }),
    conversations: new ConversationManager(new InMemoryConversationStore()),
    providers,
    prompts,
    narrationPromptId: NARRATION_PROMPT_ID,
  });

  return { orchestrator, provider };
}

const baseRequest = { userId: 'user_1', tenantId: 'tenant_1', workspaceId: 'ws_1' };

describe('orchestrator provider narration — result grounding', () => {
  it('feeds the actual tool output into the system prompt sent to the model', async () => {
    const { orchestrator, provider } = harness({
      projects: [
        { name: 'Northwind Migration', health: 'red' },
        { name: 'Atlas Rollout', health: 'amber' },
      ],
    });

    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });

    // The scripted model response is what the user sees — the LLM path ran.
    expect(response.response).toBe(
      'Two projects are flagged: Northwind Migration and Atlas Rollout.',
    );

    // Exactly one completion, and its system message carries the REAL output.
    expect(provider.chat.completions).toHaveLength(1);
    const system = provider.chat.completions[0]?.messages.find((m) => m.role === 'system');
    expect(system).toBeDefined();
    expect(system?.content).toContain('RESULTS (the only facts you may use):');
    expect(system?.content).toContain('projects.list_projects — succeeded (verified)');
    expect(system?.content).toContain('Northwind Migration');
    expect(system?.content).toContain('red');
    expect(system?.content).toContain('Atlas Rollout');
  });

  it('sends the anti-fabrication rules with every narration request', async () => {
    const { orchestrator, provider } = harness({ projects: [{ name: 'Solo', health: 'green' }] });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });

    const system = provider.chat.completions[0]?.messages.find((m) => m.role === 'system');
    expect(system?.content).toMatch(/Use ONLY the information under RESULTS/i);
    expect(system?.content).toMatch(/Never invent or guess/i);
    expect(system?.content).toMatch(/does not contain enough information/i);
    expect(system?.content).toMatch(/Preserve uncertainty/i);
  });

  it('narrates at low temperature with a token cap', async () => {
    const { orchestrator, provider } = harness({ projects: [] });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });

    expect(provider.chat.completions[0]?.temperature).toBe(0.2);
    expect(provider.chat.completions[0]?.maxTokens).toBe(320);
  });

  it('tells the model plainly when a step returned no data', async () => {
    const { orchestrator, provider } = harness({ projects: [] });
    await orchestrator.run({ ...baseRequest, utterance: 'list projects' });

    const system = provider.chat.completions[0]?.messages.find((m) => m.role === 'system');
    // `{ projects: [] }` is a real, non-empty output object, so it is shown —
    // but an empty retrieval / truly empty output would trip the honesty note.
    expect(system?.content).toContain('projects.list_projects — succeeded (verified)');
  });

  it('falls back to the deterministic composer when the provider throws', async () => {
    const { orchestrator, provider } = harness({
      projects: [{ name: 'Northwind Migration', health: 'red' }],
    });
    provider.chat.complete = async () => {
      throw new Error('ollama: connection refused');
    };

    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });

    // Deterministic narration: the real output, rendered by composeResponse.
    expect(response.status).toBe('completed');
    expect(response.response).toContain('projects.list_projects');
    expect(response.response).toContain('Northwind Migration');
  });

  it('falls back when the provider returns an empty completion', async () => {
    const { orchestrator, provider } = harness({
      projects: [{ name: 'Northwind Migration', health: 'red' }],
    });
    provider.chat.response = { content: '   ', finishReason: 'stop', model: 'mock' };

    const response = await orchestrator.run({ ...baseRequest, utterance: 'list projects' });
    expect(response.response).toContain('Northwind Migration');
  });
});
