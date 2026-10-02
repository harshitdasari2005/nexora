/**
 * Tool verification table — drift guard.
 *
 * `TOOL_VERIFICATION_TABLE` (documented in GOVERNED_EXECUTION.md §6) must match
 * the verification each REGISTERED tool actually declares in its manifest, for
 * every tool (native + connectors), with an honest strength: a `handler_result`
 * tool is never labelled independent.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_VERIFICATION } from '@nexora/agent-sdk/tools';
import { loadConfig } from '../src/config.js';
import { buildContainer, type RepositorySet } from '../src/container.js';
import { buildApplicationEventPublisher } from '../src/events/application-publisher.js';
import { composeAiRuntime } from '../src/ai/compose.js';
import { ConnectorConnectionStore } from '../src/ai/connectors/connection-store.js';
import { GitHubConnector } from '../src/ai/connectors/github-connector.js';
import { SlackConnector } from '../src/ai/connectors/slack-connector.js';
import { TOOL_VERIFICATION_TABLE, strengthOfSource } from '../src/ai/tool-verification-table.js';
import {
  FakeActivityRepository,
  FakeBudgetRepository,
  FakeCalendarEntryRepository,
  FakeExpenseRepository,
  FakeDocumentRepository,
  FakeDocumentTemplateRepository,
  FakeDocumentVersionRepository,
  FakeEmailOutboxRepository,
  FakeInboundMessageRepository,
  FakeEmployeeRepository,
  FakeCandidateRepository,
  FakeHiringRequisitionRepository,
  FakeJobOpeningRepository,
  FakeOfficeRequestRepository,
  FakeOnboardingRepository,
  FakeProjectTaskRepository,
  FakeKnowledgeArticleRepository,
  FakeKnowledgeCategoryRepository,
  FakeKnowledgeSourceRepository,
  FakeMeasurementRepository,
  FakeMembershipRepository,
  FakeNotificationPreferencesRepository,
  FakeNotificationRepository,
  FakeOrganizationRepository,
  FakeProjectRepository,
  FakeResourceAssignmentRepository,
  FakeRoleRepository,
  FakeSessionRepository,
  FakeUserRepository,
  FakeWebhookDeliveryRepository,
  FakeWebhookEndpointRepository,
  FakeWorkflowInstanceRepository,
  FakeWorkflowStepExecutionRepository,
  FakeWorkspaceInstallationRepository,
  FakeWorkspaceMembershipRepository,
  FakeWorkspaceRepository,
} from './fakes.js';
import { InMemorySearchIndex } from '@nexora/module-search';
import {
  DefaultDocumentTextExtractor,
  InMemoryDocumentStorage,
} from '@nexora/application-documents';

const noopTransport = {
  async request() {
    return { status: 200, headers: {}, body: '{}' };
  },
};

function build() {
  const config = loadConfig({
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    LOG_LEVEL: 'error',
    INTEGRATIONS_INBOUND_SECRET: 'test',
  } as NodeJS.ProcessEnv);
  const repositories: RepositorySet = {
    users: new FakeUserRepository(),
    sessions: new FakeSessionRepository(),
    roles: new FakeRoleRepository(),
    organizations: new FakeOrganizationRepository(),
    memberships: new FakeMembershipRepository(),
    workspaces: new FakeWorkspaceRepository(),
    workspaceMemberships: new FakeWorkspaceMembershipRepository(),
    workspaceInstallations: new FakeWorkspaceInstallationRepository(),
    projects: new FakeProjectRepository(),
    resourceAssignments: new FakeResourceAssignmentRepository(),
    employees: new FakeEmployeeRepository(),
    hiringRequisitions: new FakeHiringRequisitionRepository(),
    jobOpenings: new FakeJobOpeningRepository(),
    candidates: new FakeCandidateRepository(),
    onboardings: new FakeOnboardingRepository(),
    officeRequests: new FakeOfficeRequestRepository(),
    projectTasks: new FakeProjectTaskRepository(),
    documents: new FakeDocumentRepository(),
    documentVersions: new FakeDocumentVersionRepository(),
    documentTemplates: new FakeDocumentTemplateRepository(),
    knowledgeSources: new FakeKnowledgeSourceRepository(),
    knowledgeArticles: new FakeKnowledgeArticleRepository(),
    knowledgeCategories: new FakeKnowledgeCategoryRepository(),
    calendarEvents: new FakeCalendarEntryRepository(),
    budgets: new FakeBudgetRepository(),
    expenses: new FakeExpenseRepository(),
    webhookEndpoints: new FakeWebhookEndpointRepository(),
    webhookDeliveries: new FakeWebhookDeliveryRepository(),
    emailOutbox: new FakeEmailOutboxRepository(),
    inboundMessages: new FakeInboundMessageRepository(),
    measurements: new FakeMeasurementRepository(),
    searchIndex: new InMemorySearchIndex(),
    documentStorage: new InMemoryDocumentStorage(),
    documentExtractor: new DefaultDocumentTextExtractor(),
    workflowInstances: new FakeWorkflowInstanceRepository(),
    workflowStepExecutions: new FakeWorkflowStepExecutionRepository(),
    notifications: new FakeNotificationRepository(),
    notificationPreferences: new FakeNotificationPreferencesRepository(),
    activity: new FakeActivityRepository(),
  };

  const connectors = new ConnectorConnectionStore();
  connectors.register({
    connector: new GitHubConnector({
      token: 'test-github-token',
      transport: noopTransport as never,
    }),
    tenantId: 'org_x',
  });
  connectors.register({
    connector: new SlackConnector({ token: 'test-slack-token', transport: noopTransport as never }),
    tenantId: 'org_x',
  });
  const { publisher } = buildApplicationEventPublisher({ repositories });
  const container = buildContainer({ config, repositories, publisher });
  return composeAiRuntime({ config, container, repositories, publisher, connectors });
}

describe('TOOL_VERIFICATION_TABLE', () => {
  const ai = build();
  const declared = ai.tools.ids().map((id) => {
    const manifest = ai.tools.resolve(id)!.manifest;
    const verification = manifest.verification ?? DEFAULT_TOOL_VERIFICATION;
    return { tool: manifest.id, source: verification.source };
  });

  it('lists exactly the registered tools (no missing, no stale rows)', () => {
    expect(TOOL_VERIFICATION_TABLE.map((row) => row.tool).sort()).toEqual(
      declared.map((row) => row.tool).sort(),
    );
  });

  it('every row matches its tool manifest: source, strength and limitation', () => {
    for (const row of TOOL_VERIFICATION_TABLE) {
      const manifest = ai.tools.resolve(row.tool)!.manifest;
      const verification = manifest.verification ?? DEFAULT_TOOL_VERIFICATION;
      expect(row.source, row.tool).toBe(verification.source);
      expect(row.strength, row.tool).toBe(strengthOfSource(verification.source));
      if (row.strength !== 'independent') {
        // Weaker sources always state what they do NOT prove.
        expect(row.limitation, row.tool).toBeTruthy();
        expect(verification.limitation, row.tool).toBeTruthy();
      }
      if (row.strength === 'handler-only') {
        expect(row.source).toBe('handler_result');
      }
    }
  });

  it('every write tool the table lists as independent declares a read-back source', () => {
    for (const row of TOOL_VERIFICATION_TABLE.filter((r) => r.strength === 'independent')) {
      expect(['state_readback', 'provider_readback', 'redetection']).toContain(row.source);
    }
  });

  it('the documented table in GOVERNED_EXECUTION.md lists every tool with its source and strength', () => {
    const doc = readFileSync(
      new URL('../../../platform/ai-runtime/docs/GOVERNED_EXECUTION.md', import.meta.url),
      'utf8',
    );
    for (const row of TOOL_VERIFICATION_TABLE) {
      const line = doc
        .split('\n')
        .find((l) => l.includes(`\`${row.tool}\``) && l.includes(row.strength));
      expect(line, `doc row for ${row.tool}`).toBeDefined();
      expect(line, row.tool).toContain(`\`${row.source}\``);
    }
  });
});
