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

import { ToolExecutor } from '@nexora/ai-runtime/execution';
import type { AIBusinessContext } from '@nexora/ai-runtime';
import { NexoraMCPServer, type NexoraMCPContext } from '@nexora/mcp';
import { prefixedId } from '@nexora/shared/ids';

import type { AiRuntime } from '../runtime.js';
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
}

/** Options of {@link buildNexoraMCPServer}. */
export interface BuildNexoraMCPServerOptions {
  /** The composed AI Runtime (tools + approvals). */
  runtime: Pick<AiRuntime, 'tools' | 'approvals'>;
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
  const executor = new ToolExecutor({ tools: options.runtime.tools });
  const tools = buildNexoraMCPTools({
    tools: options.runtime.tools,
    executor,
    approvals: options.runtime.approvals,
  });

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
      capabilityIds: business?.capabilityIds ?? [],
      correlationId: options.identity.correlationId ?? prefixedId('mcp'),
    };
  }

  return new NexoraMCPServer({
    name: NEXORA_MCP_SERVER_NAME,
    version: NEXORA_MCP_SERVER_VERSION,
    tools,
    ...(context === undefined ? {} : { context }),
  });
}
