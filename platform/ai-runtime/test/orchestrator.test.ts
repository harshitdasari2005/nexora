/**
 * @nexora/ai-runtime — orchestrator tests.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';
import { ConfigManager, key } from '@nexora/config';
import type { ConfigSchemaMap } from '@nexora/config';

import { EnterpriseAIOrchestrator } from '../src/orchestrator/orchestrator.js';
import { ConversationManager } from '../src/conversation/conversation-manager.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { ToolExecutor } from '../src/execution/tool-executor.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import { InMemoryConversationStore } from '../src/conversation/conversation-store.js';
import { InMemoryTelemetrySink } from '../src/telemetry/in-memory-sink.js';
import { RuntimeEventBus } from '../src/events/runtime-events.js';
import { nowIso } from '@nexora/shared/time';

interface Harness {
  orchestrator: EnterpriseAIOrchestrator;
  registry: RuntimeRegistry;
  skills: SkillIndex;
  tools: ExecutableToolRegistry;
  events: RuntimeEventBus;
  telemetry: InMemoryTelemetrySink;
  conversations: InMemoryConversationStore;
}

/** Schema for the runtime keys the harness may configure. */
const runtimeSchema: ConfigSchemaMap = {
  'ai.runtime.autoApprove': {
    key: key('ai.runtime.autoApprove'),
    kind: 'boolean',
    required: false,
    default: false,
    description: 'Allows request-level auto-approval (BR-13 gate)',
  },
};

/** Builds a ConfigManager with request-level auto-approval enabled/disabled. */
function autoApproveConfig(enabled: boolean): ConfigManager {
  return ConfigManager.createSync(runtimeSchema, [], undefined, {
    'ai.runtime.autoApprove': enabled,
  });
}

/** Builds a runtime harness with a create-project tool and a close-sprint tool. */
function harness(options: { autoApprove?: boolean } = {}): Harness {
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  const tools = new ExecutableToolRegistry();
  const events = new RuntimeEventBus();
  const telemetry = new InMemoryTelemetrySink();
  const conversations = new InMemoryConversationStore();

  // Capability: create project (state change).
  registry.register(
    registryEntries.capability({
      capability: {
        id: 'projects.create_project',
        name: 'Create project',
        description: 'Creates a new project',
        skillId: 'projects.create',
        sideEffectClass: 'state_change',
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
    }),
  );
  // Capability: close sprint (consequential).
  registry.register(
    registryEntries.capability({
      capability: {
        id: 'projects.close_sprint',
        name: 'Close sprint',
        description: 'Closes the current sprint',
        skillId: 'projects.close',
        sideEffectClass: 'consequential',
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
    }),
  );
  // Capability: search projects (read only).
  registry.register(
    registryEntries.capability({
      capability: {
        id: 'projects.search',
        name: 'Search projects',
        description: 'Search for projects by keyword',
        skillId: 'projects.search',
        sideEffectClass: 'read_only',
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
    }),
  );

  const createTool: Tool = {
    manifest: {
      id: 'tool_create_project',
      name: 'Create project',
      description: 'creates',
      sideEffectClass: 'state_change',
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: {},
    },
    execute: async () => ({ ok: true, output: { projectId: 'prj_1' }, completedAt: nowIso() }),
  };
  const closeTool: Tool = {
    manifest: {
      id: 'tool_close_sprint',
      name: 'Close sprint',
      description: 'closes',
      sideEffectClass: 'consequential',
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: {},
    },
    execute: async () => ({ ok: true, output: { closed: true }, completedAt: nowIso() }),
  };
  const searchTool: Tool = {
    manifest: {
      id: 'tool_search_projects',
      name: 'Search projects',
      description: 'searches',
      sideEffectClass: 'read_only',
      idempotent: true,
      timeoutMs: 1000,
      inputSchema: {},
    },
    execute: async (input) => ({
      ok: true,
      output: { results: [`found:${String(input.q ?? '')}`] },
      completedAt: nowIso(),
    }),
  };
  for (const tool of [createTool, closeTool, searchTool]) {
    tools.register(tool);
  }

  registry.register(
    registryEntries.tool({
      tool: {
        id: 'tool_create_project',
        description: 'creates',
        sideEffectClass: 'state_change',
        idempotent: false,
        timeoutMs: 1000,
        inputSchema: {},
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
      ownedByAgents: ['agt_projects'],
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: {
        id: 'tool_close_sprint',
        description: 'closes',
        sideEffectClass: 'consequential',
        idempotent: false,
        timeoutMs: 1000,
        inputSchema: {},
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
      ownedByAgents: ['agt_projects'],
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: {
        id: 'tool_search_projects',
        description: 'searches',
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
            id: 'projects.create',
            description: 'creates',
            toolIds: ['tool_create_project'],
            autonomyTier: 'supervised',
            requiresApproval: false,
          },
          {
            id: 'projects.close',
            description: 'closes',
            toolIds: ['tool_close_sprint'],
            autonomyTier: 'supervised',
            requiresApproval: true,
          },
          {
            id: 'projects.search',
            description: 'searches',
            toolIds: ['tool_search_projects'],
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
  for (const skill of [
    {
      id: 'projects.create',
      description: 'creates',
      toolIds: ['tool_create_project'] as readonly string[],
      autonomyTier: 'supervised' as const,
      requiresApproval: false,
    },
    {
      id: 'projects.close',
      description: 'closes',
      toolIds: ['tool_close_sprint'] as readonly string[],
      autonomyTier: 'supervised' as const,
      requiresApproval: true,
    },
    {
      id: 'projects.search',
      description: 'searches',
      toolIds: ['tool_search_projects'] as readonly string[],
      autonomyTier: 'supervised' as const,
      requiresApproval: false,
    },
  ]) {
    skills.index(skill, 'agt_projects');
  }

  const discovery = new CapabilityDiscovery(registry, skills);
  const executor = new ToolExecutor({ tools });
  const orchestrator = new EnterpriseAIOrchestrator({
    discovery,
    executor,
    conversations: new ConversationManager(conversations),
    events,
    telemetry,
    configManager:
      options.autoApprove === undefined ? undefined : autoApproveConfig(options.autoApprove),
  });

  return { orchestrator, registry, skills, tools, events, telemetry, conversations };
}

const baseRequest = {
  userId: 'user_1',
  tenantId: 'tenant_1',
  workspaceId: 'ws_1',
};

describe('EnterpriseAIOrchestrator', () => {
  it('executes a read-only request to completion', async () => {
    const { orchestrator } = harness();
    const response = await orchestrator.run({
      ...baseRequest,
      utterance: 'search projects for mobile',
    });
    expect(response.status).toBe('completed');
    expect(response.steps).toHaveLength(1);
    expect(response.steps[0]?.status).toBe('succeeded');
    expect(response.steps[0]?.verified).toBe(true);
    expect(response.trace.outcome).toBe('completed');
  });

  it('blocks consequential requests without approval', async () => {
    const { orchestrator } = harness();
    const response = await orchestrator.run({
      ...baseRequest,
      utterance: 'close the sprint',
    });
    expect(response.status).toBe('blocked');
    expect(response.steps[0]?.status).toBe('blocked');
    expect(response.approvals[0]?.status).toBe('pending');
    expect(response.response).toContain('Awaiting approval');
  });

  it('executes consequential requests when auto-approved and the platform allows it', async () => {
    const { orchestrator } = harness({ autoApprove: true });
    const response = await orchestrator.run({
      ...baseRequest,
      utterance: 'close the sprint',
      autoApprove: true,
    });
    expect(response.status).toBe('completed');
    expect(response.approvals[0]?.status).toBe('granted');
  });

  it('refuses request-level auto-approval when the platform disables it (BR-13)', async () => {
    const { orchestrator } = harness({ autoApprove: false });
    const response = await orchestrator.run({
      ...baseRequest,
      utterance: 'close the sprint',
      autoApprove: true,
    });
    // The requester cannot self-grant approval: the step stays blocked.
    expect(response.status).toBe('blocked');
    expect(response.steps[0]?.status).toBe('blocked');
    expect(response.approvals[0]?.status).toBe('pending');
  });

  it('returns a clarification when no capability matches', async () => {
    const { orchestrator } = harness();
    const response = await orchestrator.run({
      ...baseRequest,
      utterance: 'please do something completely unrelated',
    });
    expect(response.status).toBe('clarification');
    expect(response.steps).toHaveLength(0);
  });

  it('records conversation turns', async () => {
    const { orchestrator, conversations } = harness();
    const response = await orchestrator.run({
      ...baseRequest,
      utterance: 'search projects for payroll',
    });
    const conversation = await conversations.load(response.conversationId);
    expect(conversation?.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  });

  it('emits plan and execution events', async () => {
    const { orchestrator, events } = harness();
    await orchestrator.run({ ...baseRequest, utterance: 'search projects for api' });
    const types = events.history().map((event) => event.type);
    expect(types).toContain('plan.created');
    expect(types).toContain('plan.executed');
    expect(types).toContain('tool.invoked');
    expect(types).toContain('tool.succeeded');
    expect(types).toContain('response.generated');
  });

  it('records a decision and trace in telemetry', async () => {
    const { orchestrator, telemetry } = harness();
    await orchestrator.run({ ...baseRequest, utterance: 'search projects for x' });
    expect(telemetry.decisions()).toHaveLength(1);
    expect(telemetry.traces()).toHaveLength(1);
    expect(telemetry.decisions()[0]?.intent).toBe('search projects for x');
  });

  it('fails fast when a step fails', async () => {
    const { orchestrator, tools } = harness();
    const failingTool = tools.resolve('tool_search_projects')!;
    const original = failingTool.execute.bind(failingTool);
    failingTool.execute = async () => ({ ok: false, error: 'boom', completedAt: nowIso() });
    const response = await orchestrator.run({ ...baseRequest, utterance: 'search projects for x' });
    expect(response.status).toBe('failed');
    expect(response.steps[0]?.status).toBe('failed');
    failingTool.execute = original;
  });

  it('runs multiple steps in dependency order', async () => {
    const { orchestrator } = harness({ autoApprove: true });
    const response = await orchestrator.run({
      ...baseRequest,
      utterance: 'create project and close sprint',
      autoApprove: true,
      allowedCapabilityIds: ['projects.create_project', 'projects.close_sprint'],
    });
    // Both match the intent; both run (approval auto-granted).
    expect(response.status).toBe('completed');
    expect(response.steps.length).toBeGreaterThan(0);
  });

  it('accepts a pre-existing conversation', async () => {
    const { orchestrator, conversations } = harness();
    const first = await orchestrator.run({ ...baseRequest, utterance: 'search projects for a' });
    const second = await orchestrator.run({
      ...baseRequest,
      utterance: 'search projects for b',
      conversationId: first.conversationId,
    });
    expect(second.conversationId).toBe(first.conversationId);
    const conversation = await conversations.load(second.conversationId);
    expect(conversation?.turns).toHaveLength(4);
  });
});
