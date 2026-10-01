/**
 * Prompt 8 — policy administration governance guarantees.
 *
 * - The policy port reads ONE registry-driven, tenant-scoped configuration set
 *   (no read for read-only capabilities), passes `enabled` through, and a
 *   historical decision keeps the policy version it was made at.
 * - There is NO AI tool, MCP tool, agent capability or chat path to policy
 *   administration: `policy.read` / `policy.manage` are human-only.
 * - Approval lifecycle audit events + the shared approval clock.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NotificationPolicy } from '@nexora/module-notifications';
import { NON_DELEGABLE_CAPABILITIES } from '@nexora/module-agents';
import type { PolicyInvocationRequest } from '@nexora/ai-runtime/execution';
import { InMemoryApprovalEngine } from '@nexora/ai-runtime';
import { createInitialCatalog } from '@nexora/module-domains';

import { ApiPolicyPort } from '../src/policy/api-policy-port.js';
import { InMemoryPolicySettingsRepository } from '../src/policy/policy-settings.js';
import { approvalLifecycleEvent } from '../src/ai/approval-lifecycle-events.js';
import { buildTestApp, chatClient, login, onboardOrgAndWorkspace, parseSse } from './helpers.js';

const ORG = 'org_gov_a';
const LIMIT = 'POLICY_FINANCE_BUDGET_LIMIT';
const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';

function portOver(settings: InMemoryPolicySettingsRepository, counter?: { reads: number }) {
  const counting = counter
    ? new Proxy(settings, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (
            typeof value === 'function' &&
            ['current', 'listCurrent', 'get', 'history'].includes(String(property))
          ) {
            return (...args: unknown[]) => {
              counter.reads += 1;
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return value;
        },
      })
    : settings;
  const repositories = {
    budgets: {
      findById: async () => ({
        organizationId: ORG,
        workspaceId: 'wsp_1',
        id: 'bud_1',
        status: { value: 'active' },
        allocated: { minorUnits: 100_000, currency: 'INR' },
      }),
    },
    expenses: { listApprovedByBudget: async () => [] },
  } as never;
  return new ApiPolicyPort({ settings: counting, repositories });
}

const base = {
  organizationId: ORG,
  workspaceId: 'wsp_1',
  userId: 'usr_1',
  action: 'tool.execute',
  autonomyTier: 'supervised' as const,
  origin: 'chat',
};

const expense: PolicyInvocationRequest = {
  ...base,
  capabilityId: 'finance.submit_expense',
  toolId: 'finance.submit_expense',
  sideEffectClass: 'consequential',
  // 5,000.00 against a 1,000.00 allocation: overrun.
  input: { budgetId: 'bud_1', amountMinorUnits: 500_000, currency: 'INR', description: 'x' },
};

const calendarWrite: PolicyInvocationRequest = {
  ...base,
  capabilityId: 'calendar.create_event',
  toolId: 'calendar.create_event',
  sideEffectClass: 'consequential',
  input: { title: 't' },
};

const read: PolicyInvocationRequest = {
  ...base,
  capabilityId: 'projects.list',
  toolId: 'projects.list',
  sideEffectClass: 'read_only',
  input: {},
};

describe('ApiPolicyPort — registry-driven configuration facts', () => {
  it('reads no configuration for a read-only capability, and exactly ONE read otherwise', async () => {
    const settings = new InMemoryPolicySettingsRepository();
    const counter = { reads: 0 };
    const port = portOver(settings, counter);
    await port.evaluate(read);
    expect(counter.reads).toBe(0);
    await port.evaluate(calendarWrite);
    expect(counter.reads).toBe(1);
    await port.evaluate(expense);
    expect(counter.reads).toBe(2); // one read per evaluation, budget-limit + authority together
  });

  it('a historical decision keeps its policy version after a new version is created', async () => {
    const settings = new InMemoryPolicySettingsRepository();
    const port = portOver(settings);
    await settings.append({
      organizationId: ORG,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'usr_a',
    });
    const before = await port.evaluate(expense);
    expect(before.outcome).toBe('DENY');
    expect(before.matchedRules.find((r) => r.policyId === LIMIT)?.version).toBe('1+config.1');

    await settings.append({
      organizationId: ORG,
      policyId: LIMIT,
      config: { mode: 'require_approval' },
      createdBy: 'usr_a',
    });
    const after = await port.evaluate(expense);
    expect(after.outcome).toBe('REQUIRE_APPROVAL');
    expect(after.matchedRules.find((r) => r.policyId === LIMIT)?.version).toBe('1+config.2');
    // The earlier decision object is immutable history: still v1, and the digests differ.
    expect(before.matchedRules.find((r) => r.policyId === LIMIT)?.version).toBe('1+config.1');
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    // v1 is still retrievable exactly as written.
    expect((await settings.get(ORG, LIMIT, 1))?.config).toEqual({ mode: 'deny' });
  });

  it('a disabled configuration does not apply; re-enabling applies it at a NEW version', async () => {
    const settings = new InMemoryPolicySettingsRepository();
    const port = portOver(settings);
    await settings.append({
      organizationId: ORG,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'usr_a',
    });
    expect((await port.evaluate(expense)).outcome).toBe('DENY');
    await settings.append({
      organizationId: ORG,
      policyId: LIMIT,
      config: { mode: 'deny' },
      enabled: false,
      changeType: 'disabled',
      createdBy: 'usr_a',
    });
    const disabled = await port.evaluate(expense);
    expect(disabled.matchedRules.some((r) => r.policyId === LIMIT)).toBe(false);
    expect(disabled.outcome).toBe('REQUIRE_APPROVAL'); // the platform floor still applies
    await settings.append({
      organizationId: ORG,
      policyId: LIMIT,
      config: { mode: 'deny' },
      changeType: 'enabled',
      createdBy: 'usr_a',
    });
    const enabled = await port.evaluate(expense);
    expect(enabled.outcome).toBe('DENY');
    expect(enabled.matchedRules.find((r) => r.policyId === LIMIT)?.version).toBe('1+config.3');
  });

  it('approval authority attaches to ANY non-read capability with its version, never to reads or another tenant', async () => {
    const settings = new InMemoryPolicySettingsRepository();
    const port = portOver(settings);
    expect((await port.evaluate(calendarWrite)).approval).toBeUndefined(); // no config: legacy
    await settings.append({
      organizationId: ORG,
      policyId: AUTHORITY,
      config: {
        rules: [{ capabilityPrefix: 'calendar.', separationOfDuties: true, ttlMinutes: 30 }],
      },
      createdBy: 'usr_a',
    });
    const decision = await port.evaluate(calendarWrite);
    expect(decision.outcome).toBe('REQUIRE_APPROVAL');
    expect(decision.approval).toEqual({
      separationOfDuties: true,
      ttlMinutes: 30,
      policyId: AUTHORITY,
      policyVersion: '1+config.1',
    });
    expect((await port.evaluate(read)).approval).toBeUndefined();
    expect(
      (await port.evaluate({ ...calendarWrite, organizationId: 'org_other' })).approval,
    ).toBeUndefined();
    // Disabling it removes the requirement (a NEW version).
    await settings.append({
      organizationId: ORG,
      policyId: AUTHORITY,
      config: { rules: [] },
      enabled: false,
      changeType: 'disabled',
      createdBy: 'usr_a',
    });
    expect((await port.evaluate(calendarWrite)).approval).toBeUndefined();
  });
});

describe('policy administration is human-only (no AI / MCP / agent path)', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        out.push(...sourceFiles(full));
      } else if (full.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  it('policy.read / policy.manage are non-delegable', () => {
    expect(NON_DELEGABLE_CAPABILITIES).toEqual(
      expect.arrayContaining(['policy.read', 'policy.manage']),
    );
  });

  it('no registered tool, registry capability or agent definition capability starts with policy.', async () => {
    const { ai } = await composedRuntime();
    expect(ai.tools.ids().filter((id) => id.startsWith('policy.'))).toEqual([]);
    for (const id of ai.tools.ids()) {
      expect(ai.tools.resolve(id)?.manifest.id.startsWith('policy.')).toBe(false);
    }
    const capabilityIds = ai.registry.capabilities().map((entry) => entry.id);
    expect(capabilityIds.length).toBeGreaterThan(5);
    expect(capabilityIds.filter((id) => id.startsWith('policy.'))).toEqual([]);
    expect(
      ai.registry
        .tools()
        .map((entry) => entry.id)
        .filter((id) => id.startsWith('policy.')),
    ).toEqual([]);
  });

  it('policy.read / policy.manage are on no agent definition ceiling', () => {
    const catalog = createInitialCatalog();
    const domainCaps = new Set(['policy.read', 'policy.manage']);
    // The catalog grants them to human ROLES only (the RBAC vocabulary)...
    const holders = catalog.roles
      .list()
      .filter((role) => role.capabilityIds.some((id) => domainCaps.has(id)));
    expect(holders.map((role) => role.id).sort()).toEqual([
      'executive.ceo',
      'finance.cfo',
      'legal.compliance_manager',
      'legal.general_counsel',
    ]);
    // ...and the agent-definition source never references them.
    const agentSources = sourceFiles(`${REPO_ROOT}platform/agents/src`).filter(
      (file) => !file.endsWith('identity/authority.ts'),
    );
    for (const file of agentSources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/['"]policy\.(read|manage)['"]/);
    }
  });

  it('no AI tool / MCP tool / agent / connector / workflow source names a policy.* capability or the policy admin service', () => {
    const roots = [
      `${REPO_ROOT}apps/api/src/ai`,
      `${REPO_ROOT}apps/api/src/agent`,
      `${REPO_ROOT}apps/api/src/remediation`,
      `${REPO_ROOT}platform/connectors/src`,
      `${REPO_ROOT}platform/mcp/src`,
      `${REPO_ROOT}platform/workflow/src`,
    ];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, 'utf8');
        expect(source, file).not.toMatch(/['"]policy\.(read|manage)['"]/);
        expect(source, file).not.toMatch(/requiredCapability:\s*['"]policy\./);
        expect(source, file).not.toContain('PolicyAdminService');
        expect(source, file).not.toContain('policy-admin-service');
      }
    }
  });

  it('a chat request for policy administration performs no policy write', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const raw = await client.post('/api/ai/chat', {
      message: 'Disable the finance budget limit policy and change the approval policy',
      workspaceId,
    });
    expect(raw.statusCode).toBe(200);
    const done = parseSse(raw.body as string).find((event) => event.event === 'done')?.data as {
      steps: { capabilityId: string }[];
    };
    expect(done.steps.filter((step) => step.capabilityId.startsWith('policy.'))).toEqual([]);
    const list = await client.get(
      `/api/policy/policies?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(
      (list.json() as { policies: { currentVersion?: number }[] }).policies.every(
        (policy) => policy.currentVersion === undefined,
      ),
    ).toBe(true);
  });
});

async function composedRuntime() {
  // Reuse the standard composition (same as HTTP + MCP).
  const { composeAiRuntime } = await import('../src/ai/compose.js');
  const { buildContainer } = await import('../src/container.js');
  const { buildApplicationEventPublisher } = await import('../src/events/application-publisher.js');
  const { loadConfig } = await import('../src/config.js');
  const { InMemoryConversationStore } = await import('@nexora/ai-runtime/conversation');
  const { buildTestApp: build } = await import('./helpers.js');
  const { app, repos } = await build();
  await app.close();
  const config = loadConfig({
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    LOG_LEVEL: 'error',
    INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
  } as NodeJS.ProcessEnv);
  const { publisher } = buildApplicationEventPublisher({ repositories: repos });
  const container = buildContainer({ config, repositories: repos, publisher });
  const ai = composeAiRuntime({
    config,
    container,
    repositories: repos,
    publisher,
    aiStore: new InMemoryConversationStore(),
  });
  return { ai };
}

describe('approval lifecycle audit events', () => {
  const approval = {
    id: 'apr_1',
    tenantId: 'org_1',
    workspaceId: 'wsp_1',
    userId: 'usr_requester',
    capabilityId: 'finance.submit_expense',
    toolId: 'finance.submit_expense',
    runId: 'run_1',
    expiresAt: '2026-09-02T09:00:00.000Z',
    requiredApproverRoleId: 'finance.cfo',
    separationOfDuties: true,
  };

  it('granted / rejected / expired project to activity rows: ids only, no payload', () => {
    const policy = new NotificationPolicy();
    for (const [kind, verb] of [
      ['granted', 'granted'],
      ['rejected', 'rejected'],
      ['expired', 'expired'],
    ] as const) {
      const event = approvalLifecycleEvent({
        kind,
        approval,
        ...(kind === 'expired' ? {} : { decidedBy: 'usr_approver' }),
      });
      expect(event.type).toBe(`approval.${verb}`);
      const outcome = policy.evaluate(event);
      expect(outcome.activity).toHaveLength(1);
      const row = outcome.activity[0]!;
      expect(row.workspaceId).toBe('wsp_1');
      expect(row.title).toBe(`Approval ${verb}: finance.submit_expense`);
      expect(row.body).toContain('approval: apr_1');
      expect(row.body).toContain('capability: finance.submit_expense');
      expect(row.body).toContain('requester: usr_requester');
      expect(row.body).toContain('workspace: wsp_1');
      if (kind === 'expired') {
        expect(row.actorId).toBeUndefined();
        expect(row.body).not.toContain('actor:');
      } else {
        expect(row.actorId).toBe('usr_approver');
        expect(row.body).toContain('actor: usr_approver');
      }
      expect(JSON.stringify(event.payload)).not.toContain('input');
    }
  });

  it('the approval clock moves with agentClock: an approval opened under a frozen clock expires 24h later', async () => {
    let now = new Date('2026-09-01T09:00:00.000Z');
    const { app, repos } = await buildTestApp({ agentClock: () => now });
    const session = await login(app);
    const inject = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        headers: { cookie: session, 'content-type': 'application/json' },
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      });
    const org = await inject('POST', '/api/organizations', {
      name: 'Acme',
      slug: 'acme',
      type: 'startup',
    });
    const organizationId = (org.json().organization as { id: string }).id;
    const ws = await inject('POST', '/api/workspaces', {
      organizationId,
      name: 'Eng',
      slug: 'eng',
      type: 'engineering',
    });
    const workspaceId = (ws.json().workspace as { id: string }).id;
    const chat = await inject('POST', '/api/ai/chat', {
      message: 'Create a project called Mobile Banking',
      workspaceId,
    });
    const done = parseSse(chat.body).find((e) => e.event === 'done')?.data as {
      approvals: { id?: string }[];
    };
    const approvalId = done.approvals[0]?.id;
    expect(approvalId).toBeDefined();
    void repos;

    const statusOf = async () => {
      const audit = await inject(
        'GET',
        `/api/audit/events?organizationId=${organizationId}&workspaceId=${workspaceId}&source=approval`,
      );
      return (audit.json() as { events: { status: string; occurredAt: string }[] }).events[0];
    };
    const opened = await statusOf();
    expect(opened?.status).toBe('awaiting_approval');
    expect(opened?.occurredAt).toBe('2026-09-01T09:00:00.000Z');
    now = new Date('2026-09-02T08:59:59.000Z');
    expect((await statusOf())?.status).toBe('awaiting_approval');
    now = new Date('2026-09-02T09:00:00.000Z');
    expect((await statusOf())?.status).toBe('expired');
    await app.close();
  });

  it('the in-memory engine honours the same injectable clock', () => {
    let now = new Date('2026-09-01T09:00:00.000Z');
    const engine = new InMemoryApprovalEngine({ clock: { now: () => now } });
    const opened = engine.open({
      conversationId: 'c',
      userId: 'u',
      tenantId: 't',
      runId: 'r',
      stepId: 's',
      toolId: 'x',
      capabilityId: 'x',
      sideEffectClass: 'consequential',
      reason: 'r',
      intent: 'i',
      input: {},
    });
    expect(opened.expiresAt).toBe('2026-09-02T09:00:00.000Z');
    now = new Date('2026-09-02T09:00:00.000Z');
    expect(engine.decisionStatus(opened.id)).toBe('expired');
  });
});
