/**
 * @nexora/app-api — Nexora MCP server composition (S24 Phase 5).
 *
 * Builds the Nexora-owned MCP server from the SAME AI Runtime surface the
 * chat endpoint uses (executable tools + approval engine) and the SAME
 * trusted role-resolution seam (membership → business role → capability
 * affinity). The caller's identity is process-scope trust (supplied
 * out-of-band); the business domain/role/capabilities are DERIVED
 * server-side — an MCP client can never claim a role or a capability.
 */

import {
  ToolExecutor,
  emitSecurityDecision,
  checkArgumentTrust,
} from '@nexora/ai-runtime/execution';
import type { AIBusinessContext } from '@nexora/ai-runtime';
import { NexoraMCPServer, type NexoraMCPContext } from '@nexora/mcp';
import { prefixedId } from '@nexora/shared/ids';

import type { AiRuntime } from '../runtime.js';
import { classifyFailure } from '@nexora/module-observability';

import { withMcpRunKey } from './mcp-run-scope.js';
import { buildNexoraMCPTools } from './nexora-mcp-tools.js';

/** The server name/version advertised over the MCP protocol. */
export const NEXORA_MCP_SERVER_NAME = 'nexora-mcp';
export const NEXORA_MCP_SERVER_VERSION = '1.0.0';

/** The trusted identity of the MCP connection (established out-of-band). */
export interface NexoraMCPTrustedIdentity {
  /** The authenticated user id (process-spawn trust). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The verified workspace scope, when workspace-scoped (trusted). */
  workspaceId?: string;
  /** Correlation id for tracing + approval correlation. */
  correlationId?: string;
  /**
   * The validated agent principal the stdio process operates as (Prompt 4),
   * with its CURRENT effective capabilities. Validated by the entry point
   * against persisted state before the server starts — never self-asserted.
   */
  agent?: {
    agent: { agentId: string; definitionId: string; name: string };
    effectiveCapabilityIds: readonly string[];
  };
}

/** Options of {@link buildNexoraMCPServer}. */
export interface BuildNexoraMCPServerOptions {
  /** The composed AI Runtime (tools + approvals). */
  runtime: Pick<AiRuntime, 'tools' | 'approvals'> &
    Partial<
      Pick<AiRuntime, 'securitySink' | 'agentAuthority' | 'policy' | 'lineage' | 'runTelemetry'>
    >;
  /**
   * Resolves the TRUSTED business context from membership + the Phase 1
   * catalog — the SAME builder the AI route uses (one source of truth).
   * The MCP layer never accepts domain/role/capability claims from input.
   */
  resolveBusinessContext: (context: {
    userId: string;
    tenantId: string;
    workspaceId?: string;
  }) => Promise<AIBusinessContext | undefined>;
  /**
   * The trusted identity of a single-context connection (stdio: the
   * spawning parent supplies it out-of-band). OMIT for the authenticated
   * HTTP surface — each session resolves its own trusted context from the
   * authenticated request (S24 Phase 6).
   */
  identity?: NexoraMCPTrustedIdentity;
}

/**
 * Builds the Nexora MCP server: wires the governed execution path
 * (ToolExecutor + ApprovalEngine over the AI runtime's tools) and registers
 * the first-party MCP tools. With `identity` (stdio) the trusted context is
 * resolved once at build; without it (HTTP) the server serves per-session
 * contexts resolved from each authenticated request.
 */
export async function buildNexoraMCPServer(
  options: BuildNexoraMCPServerOptions,
): Promise<NexoraMCPServer> {
  const securitySink = options.runtime.securitySink;
  const executor = new ToolExecutor({
    tools: options.runtime.tools,
    ...(securitySink === undefined ? {} : { securitySink }),
    // Prompt 4: MCP invocations bound to an agent principal are re-authorized
    // against its delegations at execution time (fail closed when absent).
    ...(options.runtime.agentAuthority === undefined
      ? {}
      : { agentAuthority: options.runtime.agentAuthority }),
    // Prompt 5: MCP goes through the SAME policy port as chat, agents and
    // workflows — one implementation, never a second copy for MCP.
    ...(options.runtime.policy === undefined ? {} : { policy: options.runtime.policy }),
    // Prompt 6: MCP executions are recorded in the same lineage as every other path.
    ...(options.runtime.lineage === undefined ? {} : { lineage: options.runtime.lineage }),
    ...(options.runtime.runTelemetry === undefined
      ? {}
      : { telemetry: options.runtime.runTelemetry }),
  });
  const hub = options.runtime.runTelemetry;
  const tools = buildNexoraMCPTools({
    tools: options.runtime.tools,
    executor,
    approvals: options.runtime.approvals,
  }).map((tool) =>
    hub === undefined
      ? tool
      : {
          ...tool,
          // Each MCP tool call is its own observed run (Prompt 7). Descriptive
          // only: the wrapper returns the handler's result untouched.
          handle: async (args: Record<string, unknown>, callContext: NexoraMCPContext) => {
            const runKey = prefixedId('run');
            const collector = hub.begin({
              runId: runKey,
              correlationId: callContext.correlationId,
              tenantId: callContext.tenantId,
              ...(callContext.workspaceId === undefined
                ? {}
                : { workspaceId: callContext.workspaceId }),
              actorId: callContext.userId,
              ...(callContext.agent === undefined ? {} : { agentId: callContext.agent.agentId }),
              origin: 'mcp',
            });
            let result: Awaited<ReturnType<typeof tool.handle>>;
            try {
              result = await withMcpRunKey(runKey, () => tool.handle(args, callContext));
            } catch (error) {
              await hub.end(runKey, 'failed', {
                stage: 'EXECUTION',
                code: 'INTERNAL_ERROR',
                class: 'INTERNAL',
                sourceCode: error instanceof Error ? error.name : 'Error',
              });
              throw error;
            }
            if (result.ok) {
              await hub.end(runKey, 'completed');
            } else if (result.error?.code === 'APPROVAL_REQUIRED') {
              await hub.end(runKey, 'blocked');
            } else {
              const first = collector.firstError;
              await hub.end(
                runKey,
                'failed',
                classifyFailure({
                  code: first?.code ?? result.error?.code ?? 'EXECUTION_FAILED',
                  ...(first === undefined
                    ? {}
                    : { toolId: first.toolId, invocationId: first.invocationId }),
                }),
              );
            }
            return result;
          },
        },
  );

  // Trusted business context: derived from trusted membership + the catalog,
  // never from tool arguments or any client claim.
  let context: NexoraMCPContext | undefined;
  if (options.identity !== undefined) {
    const business = await options.resolveBusinessContext({
      userId: options.identity.userId,
      tenantId: options.identity.tenantId,
      workspaceId: options.identity.workspaceId,
    });
    context = {
      userId: options.identity.userId,
      tenantId: options.identity.tenantId,
      workspaceId: options.identity.workspaceId,
      businessDomain: business?.domainId,
      businessRole: business?.roleId,
      capabilityIds:
        options.identity.agent === undefined
          ? (business?.capabilityIds ?? [])
          : (business?.capabilityIds ?? []).filter((id) =>
              options.identity?.agent?.effectiveCapabilityIds.includes(id),
            ),
      correlationId: options.identity.correlationId ?? prefixedId('mcp'),
      ...(options.identity.agent === undefined ? {} : { agent: options.identity.agent.agent }),
    };
  }

  return new NexoraMCPServer({
    name: NEXORA_MCP_SERVER_NAME,
    version: NEXORA_MCP_SERVER_VERSION,
    tools,
    // Forged identity/scope/authority in client-supplied tool arguments is a
    // security block (audited), not a mere schema error — checked before the
    // server's schema validation would reject it anonymously.
    argumentPolicy: async ({ toolName, args, context: callContext }) => {
      // The shared trust screen (reserved scope/authority/agent keys AND nesting
      // deeper than the inspected depth — fail closed, never silently ignored).
      const check = checkArgumentTrust(args);
      if (check.ok) {
        return { ok: true };
      }
      await emitSecurityDecision(securitySink, {
        actorId: callContext.userId,
        origin: 'mcp',
        invocationId: callContext.correlationId,
        organizationId: callContext.tenantId,
        ...(callContext.workspaceId === undefined ? {} : { workspaceId: callContext.workspaceId }),
        toolId: toolName,
        action: 'tool.execute',
        policyDecision: 'deny',
        ...(callContext.agent === undefined ? {} : { agentId: callContext.agent.agentId }),
        // `INVALID_ARGUMENTS` never comes from the trust screen; it is a schema code.
        reasonCode: check.code === 'INVALID_ARGUMENTS' ? 'RESERVED_ARGUMENT' : check.code,
        reason: check.reason,
        outcome: 'blocked',
        occurredAt: new Date().toISOString(),
      });
      return {
        ok: false,
        code: check.code,
        message:
          check.code === 'ARGUMENT_TOO_DEEP'
            ? 'Tool arguments are nested too deeply'
            : 'Tool arguments may not set identity, organization, workspace, role, capability, or approval values',
      };
    },
    ...(context === undefined ? {} : { context }),
  });
}
