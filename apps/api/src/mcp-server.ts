/**
 * @nexora/app-api — Nexora MCP server entry (S24 Phase 5).
 *
 * The Nexora-owned MCP server process. Transport: stdio (local,
 * parent-spawned — a remote/network MCP surface is a later phase after
 * authentication, authorization, and deployment boundaries are designed).
 *
 * Trusted context: the spawning parent supplies the authenticated identity
 * out-of-band via environment variables (NEVER tool arguments):
 *
 *   NEXORA_MCP_USER_ID        (required) — the authenticated user
 *   NEXORA_MCP_TENANT_ID      (required) — the trusted organization
 *   NEXORA_MCP_WORKSPACE_ID   (optional) — the verified workspace
 *   NEXORA_MCP_CORRELATION_ID (optional) — correlation/run id
 *
 * The server DERIVES the business domain/role/capability affinity from
 * trusted membership + the Phase 1 catalog (the same seam as the Command
 * Center and AI Runtime). A client can never claim a role, a capability, a
 * tenant, or a workspace.
 *
 * CRITICAL: stdout is the MCP protocol channel — every log line goes to
 * stderr so the JSON-RPC stream is never corrupted.
 */

import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { createDatabase, runMigrations } from '@nexora/persistence';
import { createInitialCatalog } from '@nexora/module-domains';

import { buildPgRepositories } from './app.js';
import {
  buildApplicationEventPublisher,
  type PipelineLogger,
} from './events/application-publisher.js';
import { buildContainer } from './container.js';
import { composeAiRuntime } from './ai/compose.js';
import { buildNexoraMCPServer, type NexoraMCPTrustedIdentity } from './ai/mcp/build-server.js';
import { loadConfig } from './config.js';
import {
  buildAIBusinessContext,
  MembershipBusinessRoleResolver,
} from './business-context/index.js';

/** Reads the trusted identity from the environment (fail fast when missing). */
function trustedIdentityFromEnv(env: NodeJS.ProcessEnv): NexoraMCPTrustedIdentity {
  const userId = env['NEXORA_MCP_USER_ID']?.trim();
  const tenantId = env['NEXORA_MCP_TENANT_ID']?.trim();
  if (userId === undefined || userId.length === 0) {
    throw new Error('Missing required environment variable: NEXORA_MCP_USER_ID');
  }
  if (tenantId === undefined || tenantId.length === 0) {
    throw new Error('Missing required environment variable: NEXORA_MCP_TENANT_ID');
  }
  const workspaceId = env['NEXORA_MCP_WORKSPACE_ID']?.trim();
  const correlationId = env['NEXORA_MCP_CORRELATION_ID']?.trim();
  return {
    userId,
    tenantId,
    ...(workspaceId === undefined || workspaceId.length === 0 ? {} : { workspaceId }),
    ...(correlationId === undefined || correlationId.length === 0 ? {} : { correlationId }),
  };
}

/** A stderr-only structured logger (stdout is reserved for the MCP protocol). */
function stderrLogger(): PipelineLogger {
  const write = (level: string) => (obj: Record<string, unknown>, message?: string) => {
    void process.stderr.write(`[nexora-mcp:${level}] ${message ?? ''} ${JSON.stringify(obj)}\n`);
  };
  return { info: write('info'), error: write('error') };
}

/** Boots the Nexora MCP server over stdio. */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = stderrLogger();

  if (config.autoMigrate) {
    await runMigrations(config.databaseUrl);
  }
  const database = createDatabase(config.databaseUrl);
  const repositories = buildPgRepositories(database, config);
  const { publisher } = buildApplicationEventPublisher({ repositories, logger });
  const container = buildContainer({ config, repositories, publisher });
  const ai = composeAiRuntime({ config, container, repositories, publisher, database });

  // Trusted business context: the SAME resolver + catalog the AI route uses.
  const roleResolver = new MembershipBusinessRoleResolver({
    memberships: repositories.memberships,
    workspaceMemberships: repositories.workspaceMemberships,
  });
  const catalog = createInitialCatalog();

  const identity = trustedIdentityFromEnv(process.env);
  const business = await buildAIBusinessContext(
    { roleResolver, catalog },
    {
      userId: identity.userId,
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
    },
  );
  logger.info(
    {
      userId: identity.userId,
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      domain: business?.domainId,
      role: business?.roleId,
      capabilities: business?.capabilityIds.length ?? 0,
    },
    'nexora mcp server starting (stdio)',
  );

  const server = await buildNexoraMCPServer({
    runtime: { tools: ai.tools, approvals: ai.approvals },
    resolveBusinessContext: (context) => buildAIBusinessContext({ roleResolver, catalog }, context),
    identity,
  });

  // Blocks until the parent closes the stdio channel.
  await server.runStdio();
}

void main().catch((error: unknown) => {
  // stderr only — stdout carries the MCP protocol.
  void process.stderr.write(`Failed to start Nexora MCP server: ${String(error)}\n`);
  process.exitCode = 1;
});

// Re-exported so tests can build the server without booting the process.
export { buildNexoraMCPServer };
