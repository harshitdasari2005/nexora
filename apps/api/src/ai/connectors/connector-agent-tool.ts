/**
 * @nexora/app-api — connector Agent SDK tool adapter (S25 Phase 7).
 *
 * Bridges the generic connector engine (`@nexora/connectors`) into the AI
 * Runtime's executable tool surface. Each `ConnectorAgentTool` wraps ONE
 * `ConnectorTool` (from a registered `ExternalConnector`) as an Agent SDK
 * `Tool`, so the AI Runtime and the Nexora MCP server can discover and
 * execute external capabilities through the SAME governed path as every
 * other tool (ToolExecutor → side-effect guard → approval → verification →
 * audit). There is no second execution path and no direct provider access.
 *
 * Trusted-context resolution: the connector is resolved at invocation time
 * through the `ConnectorConnectionStore` under the TRUSTED tenant/workspace
 * from the execution context — never from tool arguments. A caller whose
 * tenant (or workspace-scoped binding) has no connection resolves NOTHING
 * and the tool fails closed with `CONNECTOR_UNAVAILABLE`. Identity, tenant,
 * workspace, role, and capability are never part of the input schema; the
 * connector tool's own strict schema rejects any credential/identity/scope
 * field.
 *
 * Governance is NOT the adapter's job: the side-effect class is derived
 * deterministically from the connector tool's operation type (read → read
 * only, write → consequential), so the planner gates write capabilities and
 * the ApprovalEngine governs them exactly like native write tools. The
 * adapter only maps the connector result to the tool result contract and,
 * for successful writes, emits the `connector.external_write` audit event
 * (provider/connector/tool/scope — never secrets or credentials).
 */

import {
  DEFAULT_TOOL_VERIFICATION,
  type Tool,
  type ToolExecutionContext,
  type ToolManifest,
  type ToolResult,
  type ToolVerificationMetadata,
} from '@nexora/agent-sdk/tools';
import {
  CONNECTOR_ERROR_CODES,
  type ConnectorTool,
  type ExternalConnector,
  type ConnectorToolResult,
} from '@nexora/connectors';
import { createEventEnvelope, type EventPublisher } from '@nexora/shared/events';

import type { ConnectorConnectionStore } from './connection-store.js';

/** The stable event type of a governed external write (audit trail). */
export const CONNECTOR_EXTERNAL_WRITE_EVENT = 'connector.external_write';

/** Options of {@link ConnectorAgentTool}. */
export interface ConnectorAgentToolOptions {
  /** The connector tool definition being adapted. */
  tool: ConnectorTool;
  /** The owning connector (for resolveTool + audit attribution). */
  connector: ExternalConnector;
  /** The tenant-scoped connection store (resolves under trusted scope). */
  store: ConnectorConnectionStore;
  /** Publishes the `connector.external_write` audit event after writes. */
  publisher?: EventPublisher;
}

/**
 * Adapts a connector tool into the Agent SDK Tool contract. The manifest is
 * derived deterministically from the connector tool's definition — the tool
 * id is the connector tool id (e.g. `github.issues.create`), the
 * side-effect class follows the operation type (write → consequential →
 * gated), and the input schema is the connector's strict schema (which
 * rejects identity/tenant/workspace/credentials by construction).
 */
export class ConnectorAgentTool implements Tool<Record<string, unknown>, Record<string, unknown>> {
  readonly manifest: ToolManifest;
  readonly #tool: ConnectorTool;
  readonly #connector: ExternalConnector;
  readonly #store: ConnectorConnectionStore;
  readonly #publisher?: EventPublisher;

  constructor(options: ConnectorAgentToolOptions) {
    this.#tool = options.tool;
    this.#connector = options.connector;
    this.#store = options.store;
    this.#publisher = options.publisher;
    this.manifest = {
      id: options.tool.id,
      name: options.tool.name,
      description: options.tool.description,
      sideEffectClass: options.tool.operationType === 'write' ? 'consequential' : 'read_only',
      idempotent: options.tool.operationType === 'read',
      timeoutMs: options.tool.timeoutMs,
      inputSchema: options.tool.inputSchema,
      ...(options.tool.operationType === 'write'
        ? { verification: connectorWriteVerification(options.tool.id) }
        : {}),
    };
  }

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult<Record<string, unknown>>> {
    // Trusted-scope resolution: the connection belongs to the tenant (and
    // workspace, when workspace-scoped) from the execution context. A
    // foreign tenant/workspace has no connection → fail closed. Identity
    // and scope are NEVER read from the input.
    const connector = this.#store.resolve(
      this.#connector.id,
      context.tenantId,
      context.workspaceId,
    );
    if (connector === undefined) {
      return this.#failure(
        'No external connection is configured for this organization — the action is unavailable',
      );
    }
    const tool = connector.resolveTool(this.#tool.id);
    if (tool === undefined) {
      return this.#failure('The requested external action is not available');
    }

    const result = await tool.execute(input, {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      correlationId: context.executionId,
    });

    if (!result.ok) {
      const failure = this.#failure(this.#messageFor(result));
      // The provider acknowledged the write but the read-back failed: the
      // declared verification ran and FAILED (recorded as unverified with the
      // tool's declared source, never as an unverified-by-default failure).
      return result.error?.code === CONNECTOR_ERROR_CODES.VERIFICATION_FAILED
        ? { ...failure, readBackFailed: true }
        : failure;
    }

    // Audit: a successful governed WRITE emits the external-write event so
    // the activity feed shows the provider action. Reads are audited through
    // the tool's own invocation (decision record); only writes project a
    // workspace activity entry. Secrets are never part of the event payload.
    if (this.#tool.operationType === 'write') {
      await this.#publishAudit(context, result);
    }

    return {
      ok: true,
      output: result.output ?? {},
      completedAt: new Date().toISOString(),
    };
  }

  /** Maps a connector failure to a stable, safe tool error message. */
  #messageFor(result: ConnectorToolResult): string {
    if (result.error === undefined) {
      return 'The external action could not be completed';
    }
    return `${result.error.code}: ${result.error.message}`;
  }

  /** Publishes the connector.external_write audit event (never throws). */
  async #publishAudit(context: ToolExecutionContext, result: ConnectorToolResult): Promise<void> {
    if (this.#publisher === undefined) {
      return;
    }
    try {
      await this.#publisher.publish([
        createEventEnvelope({
          type: CONNECTOR_EXTERNAL_WRITE_EVENT,
          version: 1,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          correlationId: context.executionId,
          actor: { kind: 'user', id: context.userId },
          payload: {
            connector: this.#connector.id,
            provider: this.#connector.provider,
            toolId: this.#tool.id,
            operationType: 'write',
            // The verified output summary only — never credentials or raw
            // provider internals.
            result: result.output ?? {},
          },
          metadata: {
            version: 1,
            category: 'platform',
            priority: 'normal',
            deliverySemantics: 'at_least_once',
          },
        }),
      ]);
    } catch {
      // A projection failure must never break the business mutation that
      // succeeded — the audit pipeline is best-effort by contract.
    }
  }

  #failure(error: string): ToolResult<Record<string, unknown>> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/**
 * The DECLARED verification of a connector write (Prompt 9). Only what the
 * connector genuinely does is claimed: GitHub re-GETs the created issue from
 * the provider (`provider_readback`); Slack only checks the response carries
 * the message `ts` (`response_shape`); any other write reports the handler
 * result. Never claims a read-back that did not happen.
 */
export function connectorWriteVerification(toolId: string): ToolVerificationMetadata {
  switch (toolId) {
    case 'github.issues.create':
      return { source: 'provider_readback' };
    case 'slack.messages.send':
      return {
        source: 'response_shape',
        limitation:
          'the provider response carried a message identifier; the message was not re-read from Slack',
      };
    default:
      return { ...DEFAULT_TOOL_VERIFICATION };
  }
}
