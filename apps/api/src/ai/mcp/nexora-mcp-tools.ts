/**
 * @nexora/app-api — Nexora MCP tool adapters (S24 Phase 5).
 *
 * The seven first-party MCP tools. Each is an ADAPTER over a canonical
 * Agent SDK `Tool` already registered in the AI Runtime's executable
 * registry — the definition (name/description/input schema) comes from the
 * canonical manifest; this module only adds the MCP namespace, the required
 * capability, and the read/write + approval metadata (one canonical
 * definition, native adapter AND MCP adapter — no duplication).
 *
 * Execution:
 * - Read tools invoke the SAME ToolExecutor as the AI (validate → guard →
 *   invoke → verify) under the trusted context. Their application handlers
 *   enforce tenant/workspace scope — MCP never touches repositories.
 * - Write tools run through {@link GovernedWriteAdapter}: the executor's
 *   side-effect guard blocks consequential actions, the existing
 *   ApprovalEngine governs the grant, and execution verifies against
 *   persisted state exactly like the AI path.
 */

import type { ApprovalEngine } from '@nexora/ai-runtime';
import type { ToolExecutor } from '@nexora/ai-runtime/execution';
import type { ExecutableToolRegistry } from '@nexora/ai-runtime/registry';
import type { NexoraMCPContext, NexoraMCPTool, NexoraMCPToolResult } from '@nexora/mcp';
import { toolError } from '@nexora/mcp';

import { GovernedWriteAdapter } from './governed-write-adapter.js';

/** The canonical tool → MCP tool mapping (explicit, stable names). */
const MCP_TOOL_MAP = [
  {
    name: 'nexora.projects.list',
    toolId: 'projects.list',
    requiredCapability: 'projects.list',
    operationType: 'read' as const,
    requiresApproval: false,
  },
  {
    name: 'nexora.projects.get',
    toolId: 'projects.find_project',
    requiredCapability: 'projects.find_project',
    operationType: 'read' as const,
    requiresApproval: false,
  },
  {
    name: 'nexora.documents.search',
    toolId: 'documents.search',
    requiredCapability: 'knowledge.search',
    operationType: 'read' as const,
    requiresApproval: false,
  },
  {
    name: 'nexora.knowledge.search',
    toolId: 'knowledge.search',
    requiredCapability: 'knowledge.search',
    operationType: 'read' as const,
    requiresApproval: false,
  },
  {
    name: 'nexora.notifications.list',
    toolId: 'notifications.list',
    requiredCapability: 'notifications.list',
    operationType: 'read' as const,
    requiresApproval: false,
  },
  {
    name: 'nexora.calendar.create_event',
    toolId: 'calendar.create_event',
    requiredCapability: 'calendar.create_event',
    operationType: 'write' as const,
    requiresApproval: true,
  },
  {
    name: 'nexora.projects.create',
    toolId: 'projects.create_project',
    requiredCapability: 'projects.create_project',
    operationType: 'write' as const,
    requiresApproval: true,
  },
] as const;

/** Dependencies required to build the Nexora MCP tools. */
export interface BuildNexoraMCPToolsOptions {
  /** The AI Runtime executable tool registry (canonical tools). */
  tools: ExecutableToolRegistry;
  /** The AI Runtime ToolExecutor (the single execution path). */
  executor: ToolExecutor;
  /** The AI Runtime ApprovalEngine (the single governance mechanism). */
  approvals: ApprovalEngine;
}

/** Builds the seven first-party Nexora MCP tools. */
export function buildNexoraMCPTools(options: BuildNexoraMCPToolsOptions): readonly NexoraMCPTool[] {
  return MCP_TOOL_MAP.map((entry) => {
    const canonical = options.tools.resolve(entry.toolId);
    if (canonical === undefined) {
      throw new Error(
        `MCP tool ${entry.name} requires the canonical tool ${entry.toolId} — not registered`,
      );
    }
    const manifest = canonical.manifest;
    const definition: NexoraMCPTool['definition'] = {
      name: entry.name,
      description: manifest.description,
      inputSchema: manifest.inputSchema,
      requiredCapability: entry.requiredCapability,
      operationType: entry.operationType,
      requiresApproval: entry.requiresApproval,
      annotations: {
        readOnlyHint: entry.operationType === 'read',
        destructiveHint: entry.operationType === 'write',
        idempotentHint: manifest.idempotent,
      },
    };
    if (entry.operationType === 'write') {
      const adapter = new GovernedWriteAdapter({
        executor: options.executor,
        approvals: options.approvals,
        toolId: entry.toolId,
        capabilityId: entry.requiredCapability,
        intent: manifest.description,
      });
      return {
        definition,
        handle: (args, context) => adapter.invoke(args, context),
      };
    }
    return {
      definition,
      handle: (args, context) => readToolInvoke(options.executor, entry.toolId, args, context),
    };
  });
}

/** Invokes a read tool through the governed executor under the trusted context. */
async function readToolInvoke(
  executor: ToolExecutor,
  toolId: string,
  args: Record<string, unknown>,
  context: NexoraMCPContext,
): Promise<NexoraMCPToolResult> {
  const result = await executor.execute(
    {
      toolId,
      input: args,
      userId: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      runId: context.correlationId,
      autonomyTier: 'supervised',
    },
    false,
  );
  if (result.ok) {
    return { ok: true, output: toOutput(result.output) };
  }
  if (result.error?.code === 'NOT_FOUND') {
    return toolError('TOOL_NOT_FOUND', `Tool not found: ${toolId}`);
  }
  return toolError('EXECUTION_FAILED', result.error?.message ?? 'The read could not be completed');
}

/** Normalizes an executor output to a structured object. */
function toOutput(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}
