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

import type { EventPublisher } from '@nexora/shared/events';
import type { ConversationStore } from '@nexora/ai-runtime/conversation';
import type { NexoraDatabase } from '@nexora/persistence';

import type { ApiConfig } from '../config.js';
import type { Container, RepositorySet } from '../container.js';
import { buildAiRuntime, type AiRuntime } from './runtime.js';
import type { ConnectorConnectionStore } from './connectors/connection-store.js';
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
    createCalendarEvent: container.createCalendarEvent,
    listCalendarEvents: container.listCalendarEvents,
    assignEmployeeToProject: container.assignEmployeeToProject,
    retrieveKnowledge: container.retrieveKnowledge,
    listOrganizations: container.listOrganizations,
    listNotifications: container.listNotifications,
    unreadNotifications: container.unreadNotifications,
    listActivity: container.listActivity,
    workflowInstances: repositories.workflowInstances,
    workflowStepExecutions: repositories.workflowStepExecutions,
    publisher,
    store:
      input.aiStore ??
      (input.database === undefined ? undefined : new PgConversationStore(input.database)),
    // S24 Phase 6: the durable approval engine. Without a database (tests),
    // the runtime falls back to the in-memory engine behind the SAME
    // interface — one lifecycle, two stores.
    approvals: input.database === undefined ? undefined : new PgApprovalEngine(input.database),
    // S25 Phase 7: external connectors (registered into the runtime surface
    // only when connections are configured).
    connectors: input.connectors,
  });
}
