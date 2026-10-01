/**
 * @nexora/app-api — AI runtime composition (shared).
 *
 * Builds the Enterprise AI Runtime from the application container + the
 * repository set. Shared by the HTTP app (`app.ts`) and the Nexora MCP
 * server entry (`mcp-server.ts`) so there is exactly ONE runtime wiring —
 * the MCP server consumes the SAME executable tools, approval engine, and
 * capability surface as the chat endpoint (S24 Phase 5: MCP is a tool
 * protocol adapter, never a second business-logic layer).
 */

import type { ApprovalEngine } from '@nexora/ai-runtime';
import type { AgentAuthorityPort, LineagePort, PolicyPort } from '@nexora/ai-runtime/execution';
import type { RunTelemetryHub } from '@nexora/module-observability';
import type { EventPublisher } from '@nexora/shared/events';
import type { ConversationStore } from '@nexora/ai-runtime/conversation';
import type { NexoraDatabase } from '@nexora/persistence';

import type { ApiConfig } from '../config.js';
import type { Container, RepositorySet } from '../container.js';
import { buildAiRuntime, type AiRuntime } from './runtime.js';
import type { ConnectorConnectionStore } from './connectors/connection-store.js';
import type { PermissionResolverDependencies } from '../business-context/permissions.js';
import { createInitiatorCapabilityResolver } from './workflow-initiator.js';
import { PgApprovalEngine } from './pg-approval-engine.js';
import { PgConversationStore } from './pg-conversation-store.js';

/** Inputs required to compose the AI runtime. */
export interface ComposeAiRuntimeInput {
  /** API configuration. */
  config: ApiConfig;
  /** The application container (wired handlers). */
  container: Container;
  /** The repository implementations. */
  repositories: RepositorySet;
  /** The domain event publisher. */
  publisher: EventPublisher;
  /** The PostgreSQL client (used to build the durable conversation store). */
  database?: NexoraDatabase;
  /** Durable conversation store (defaults to in-memory without a database). */
  aiStore?: ConversationStore;
  /** External connector connections (S25 Phase 7; registered when present). */
  connectors?: ConnectorConnectionStore;
  /** Execution-time agent authority (Prompt 4). */
  agentAuthority?: AgentAuthorityPort;
  /** Central policy decisions (Prompt 5). */
  policy?: PolicyPort;
  /** Evidence + lineage recording (Prompt 6). */
  lineage?: LineagePort;
  /** Runtime observability collector (Prompt 7). */
  runTelemetry?: RunTelemetryHub;
  extractionClock?: () => Date;
  /** Approval expiry clock (Prompt 8); defaults to the real clock. */
  approvalClock?: () => Date;
  /** An injected approval engine (tests / evaluation read approval state back). */
  approvals?: ApprovalEngine;
  /** The trusted RBAC seam (role resolver + catalog) — bounds composite workflows. */
  rbac?: PermissionResolverDependencies;
}

/** Builds the AI runtime (the single composition used by HTTP + MCP). */
export function composeAiRuntime(input: ComposeAiRuntimeInput): AiRuntime {
  const { config, container, repositories, publisher } = input;
  return buildAiRuntime({
    config,
    listMyWorkspaces: container.listMyWorkspaces,
    createWorkspace: container.createWorkspace,
    createProject: container.createProject,
    findProjectByName: container.findProjectByName,
    listProjects: container.listProjects,
    findEmployeeByName: container.findEmployeeByName,
    createEmployee: container.createEmployee,
    revokeHire: container.revokeHire,
    createCalendarEvent: container.createCalendarEvent,
    listCalendarEvents: container.listCalendarEvents,
    submitExpense: container.submitExpense,
    listExpenses: container.listExpenses,
    flagOverBudgetItems: container.flagOverBudgetItems,
    listBudgets: container.listBudgets,
    listEmployeesByIds: container.listEmployeesByIds,
    listProjectMembers: container.listProjectMembers,
    assignEmployeeToProject: container.assignEmployeeToProject,
    retrieveKnowledge: container.retrieveKnowledge,
    listOrganizations: container.listOrganizations,
    listNotifications: container.listNotifications,
    unreadNotifications: container.unreadNotifications,
    markAllNotificationsRead: container.markAllNotificationsRead,
    listActivity: container.listActivity,
    ...(input.rbac === undefined
      ? {}
      : { resolveInitiatorCapabilities: createInitiatorCapabilityResolver(input.rbac) }),
    workflowInstances: repositories.workflowInstances,
    workflowStepExecutions: repositories.workflowStepExecutions,
    publisher,
    store:
      input.aiStore ??
      (input.database === undefined ? undefined : new PgConversationStore(input.database)),
    // S24 Phase 6: the durable approval engine. Without a database (tests),
    // the runtime falls back to the in-memory engine behind the SAME
    // interface — one lifecycle, two stores.
    approvals:
      input.approvals ??
      (input.database === undefined
        ? undefined
        : new PgApprovalEngine(input.database, {
            ...(input.approvalClock === undefined ? {} : { clock: { now: input.approvalClock } }),
          })),
    ...(input.approvalClock === undefined ? {} : { approvalClock: input.approvalClock }),
    // S25 Phase 7: external connectors (registered into the runtime surface
    // only when connections are configured).
    connectors: input.connectors,
    ...(input.agentAuthority === undefined ? {} : { agentAuthority: input.agentAuthority }),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    ...(input.lineage === undefined ? {} : { lineage: input.lineage }),
    ...(input.runTelemetry === undefined ? {} : { runTelemetry: input.runTelemetry }),
    ...(input.extractionClock === undefined ? {} : { extractionClock: input.extractionClock }),
  });
}
