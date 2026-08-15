/**
 * @nexora/app-api — connector AI surface registration (S25 Phase 7).
 *
 * Registers the configured external connectors into the Enterprise AI
 * Runtime: one agent identity, one capability + skill per connector tool
 * (AI-discoverable), and one executable `ConnectorAgentTool` per connector
 * tool (the ONLY execution path — ToolExecutor → side-effect guard →
 * approval → verification → audit).
 *
 * Capability naming follows the deterministic matcher's evidence rules:
 * provider-first names ("GitHub Repositories List", "Slack Message Send")
 * make the provider the leading token so the capability matches natural
 * utterances ("What issues are open in our GitHub repository?") without
 * hijacking unrelated intents ("Create a calendar event…" never matches a
 * GitHub capability — verified against the full candidate set).
 *
 * The surface is registered ONLY when connectors are actually configured
 * (env tokens + a binding tenant): an unconfigured connector is not an
 * executable surface, so it is never advertised (fail closed — the AI is
 * never told it can execute something that cannot run).
 */

import type {
  AgentIdentity,
  AgentManifest,
  AgentSkill,
  CapabilityDeclaration,
  ToolContract,
} from '@nexora/contracts/ai';
import type { EventPublisher } from '@nexora/shared/events';
import type { RuntimeRegistry } from '@nexora/ai-runtime/registry';
import { registryEntries } from '@nexora/ai-runtime/registry';
import type { SkillIndex } from '@nexora/ai-runtime/registry';
import type { ExecutableToolRegistry } from '@nexora/ai-runtime/registry';

import { ConnectorAgentTool } from './connector-agent-tool.js';
import type { ConnectorConnectionStore } from './connection-store.js';

/**
 * The connectors agent identity (the owning bounded context). The id is
 * derived from the connector id so every registered connector owns a
 * distinct agent entry (`agt_connectors_github`, `agt_connectors_slack`)
 * — the registry rejects duplicate ids, and one shared identity would
 * collide the moment a second connector registers.
 */
export function connectorAgent(connectorId: string): AgentIdentity {
  return {
    id: `agt_connectors_${connectorId}`,
    name: `connectors:${connectorId}`,
    displayName: `External Connectors Agent (${connectorId})`,
  };
}

/**
 * The provider-first capability display names per connector tool id. These
 * are the matcher-facing names (the leading provider token + entity nouns)
 * — verified against the full candidate set so external intents match
 * precisely and unrelated intents never phantom-match. Connector tools not
 * listed here keep their provider description as the capability name.
 */
const CONNECTOR_CAPABILITY_NAMES: Readonly<Record<string, string>> = {
  'github.repositories.list': 'GitHub Repositories List',
  'github.repositories.get': 'GitHub Repository Get',
  'github.issues.list': 'GitHub Issues Open',
  'github.issues.create': 'GitHub Issue Creation',
  'slack.channels.list': 'Slack Channels List',
  'slack.messages.recent': 'Slack Recent Messages',
  'slack.messages.send': 'Slack Message Send',
};

/** Dependencies of {@link registerConnectorSurface}. */
export interface RegisterConnectorSurfaceOptions {
  /** The platform capability registry (discovery read-model). */
  registry: RuntimeRegistry;
  /** The runtime skill index. */
  skills: SkillIndex;
  /** The executable tool registry (the only execution path). */
  tools: ExecutableToolRegistry;
  /** The tenant-scoped connection store (trusted-scope resolution). */
  store: ConnectorConnectionStore;
  /** Publishes the connector.external_write audit event. */
  publisher?: EventPublisher;
}

/**
 * Registers every configured connector into the AI runtime surface. Each
 * connector contributes its tools as AI-discoverable capabilities
 * (provider-first names) with executable adapters. Registration is additive
 * and connector-agnostic: a future provider registers the same way — no
 * changes across the AI Runtime or the MCP engine.
 */
export function registerConnectorSurface(options: RegisterConnectorSurfaceOptions): void {
  const { registry, skills, tools, store, publisher } = options;
  const seenConnectors = new Set<string>();

  // One agent per connector id, one capability+skill+tool per connector
  // tool (deduplicated across connections sharing a connector).
  for (const connection of store.connections()) {
    const connector = connection.connector;
    if (seenConnectors.has(connector.id)) {
      continue;
    }
    seenConnectors.add(connector.id);
    const agent = connectorAgent(connector.id);

    registry.register(
      registryEntries.agent({
        agent,
        manifest: connectorAgentManifest(agent, connector.tools),
        health: 'healthy',
        owner: connector.id,
        version: '1.0.0',
      }),
    );

    for (const tool of connector.tools) {
      const capabilityId = tool.id;
      const skill = connectorSkill(capabilityId, tool.operationType);
      const contract = connectorToolContract(tool);

      registry.register(
        registryEntries.tool({
          tool: contract,
          owner: connector.id,
          version: '1.0.0',
          ownedByAgents: [agent.id],
        }),
      );
      registry.register(
        registryEntries.capability({
          capability: connectorCapability(tool, capabilityId),
          owner: connector.id,
          version: '1.0.0',
        }),
      );
      skills.index(skill, agent.id, connector.id);
      tools.register(new ConnectorAgentTool({ tool, connector, store, publisher }));
    }
  }
}

/** The skill backing one connector tool (id = tool id for 1:1 resolution). */
function connectorSkill(toolId: string, operationType: 'read' | 'write'): AgentSkill {
  return {
    id: toolId,
    description: 'Runs the external connector tool under the trusted scope',
    toolIds: [toolId],
    autonomyTier: 'supervised',
    requiresApproval: operationType === 'write',
  };
}

/** The canonical tool contract of one connector tool. */
function connectorToolContract(tool: {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
  operationType: 'read' | 'write';
  timeoutMs: number;
}): ToolContract {
  return {
    id: tool.id,
    description: tool.description,
    sideEffectClass: tool.operationType === 'write' ? 'consequential' : 'read_only',
    idempotent: tool.operationType === 'read',
    timeoutMs: tool.timeoutMs,
    inputSchema: tool.inputSchema,
  };
}

/** The capability declaration of one connector tool (AI-discoverable). */
function connectorCapability(
  tool: { id: string; description: string; operationType: 'read' | 'write' },
  capabilityId: string,
): CapabilityDeclaration {
  return {
    id: capabilityId,
    name: CONNECTOR_CAPABILITY_NAMES[tool.id] ?? tool.id,
    description: tool.description,
    skillId: capabilityId,
    sideEffectClass: tool.operationType === 'write' ? 'consequential' : 'read_only',
  };
}

/** Builds the minimal connector agent manifest for the registry. */
function connectorAgentManifest(
  agent: AgentIdentity,
  tools: readonly {
    id: string;
    description: string;
    inputSchema: Record<string, unknown>;
    operationType: 'read' | 'write';
    timeoutMs: number;
  }[],
): AgentManifest {
  return {
    identity: agent,
    version: '1.0.0',
    skills: tools.map((tool) => connectorSkill(tool.id, tool.operationType)),
    tools: tools.map((tool) => connectorToolContract(tool)),
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: ['connector.external_write'],
    subscribedEventTypes: [],
    updatedAt: new Date().toISOString(),
  };
}
