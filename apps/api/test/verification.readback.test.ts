/**
 * Verification integrity (Prompt 9, G4): the tools that CLAIM a read-back
 * really perform one. A handler that lies — reports success while the
 * persisted state disagrees — yields a failed, unverified execution whose
 * lineage VERIFICATION carries the tool's DECLARED source (never a source
 * the tool did not use).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@nexora/agent-sdk/tools';
import { ToolExecutor } from '@nexora/ai-runtime/execution';
import { ExecutableToolRegistry } from '@nexora/ai-runtime/registry';
import { InMemoryLineageRepository } from '@nexora/module-lineage';

import { ApiLineagePort } from '../src/lineage/api-lineage-port.js';
import { AssignEmployeeToProjectTool } from '../src/ai/tools/assign-employee-tool.js';
import { FlagOverBudgetItemsTool } from '../src/ai/tools/flag-over-budget-items-tool.js';
import { MarkAllNotificationsReadTool } from '../src/ai/tools/mark-all-notifications-read-tool.js';
import { connectorWriteVerification } from '../src/ai/connectors/connector-agent-tool.js';

const TENANT = 'org_acme';
const WORKSPACE = 'ws_ops';
const context: ToolExecutionContext = {
  userId: 'usr_alice',
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  executionId: 'run_1',
};

const handler = <T>(fn: (...args: never[]) => unknown): T =>
  ({ handle: vi.fn(fn) }) as unknown as T;
const ok = <T>(value: T) => ({ ok: true, value });

describe('read-back: a lying handler is never reported as success', () => {
  it('projects.assign_employee fails when the assignment is not in the member list', async () => {
    const tool = new AssignEmployeeToProjectTool({
      assignEmployeeToProject: handler(async () =>
        ok({
          assignment: {
            id: 'asg_1',
            projectId: 'prj_1',
            employeeId: 'emp_1',
            organizationId: TENANT,
            assignedAt: '2026-08-01T00:00:00.000Z',
          },
          events: [],
        }),
      ),
      findEmployeeByName: handler(async () =>
        ok([{ id: 'emp_1', name: 'Sarah', status: 'active', organizationId: TENANT }]),
      ),
      findProjectByName: handler(async () => ok([{ id: 'prj_1', name: 'Apollo' }])),
      listOrganizations: handler(async () => ok([{ id: TENANT }])),
      // The lie: the handler says assigned, the persisted member list is empty.
      listProjectMembers: handler(async () => ok([])),
    });
    expect(tool.manifest.verification).toEqual({ source: 'state_readback' });
    const result = await tool.execute({ employeeName: 'Sarah', projectName: 'Apollo' }, context);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('verification failed');
  });

  it('projects.assign_employee succeeds when the read-back agrees', async () => {
    const tool = new AssignEmployeeToProjectTool({
      assignEmployeeToProject: handler(async () =>
        ok({
          assignment: {
            id: 'asg_1',
            projectId: 'prj_1',
            employeeId: 'emp_1',
            organizationId: TENANT,
            assignedAt: '2026-08-01T00:00:00.000Z',
          },
          events: [],
        }),
      ),
      findEmployeeByName: handler(async () =>
        ok([{ id: 'emp_1', name: 'Sarah', status: 'active', organizationId: TENANT }]),
      ),
      findProjectByName: handler(async () => ok([{ id: 'prj_1', name: 'Apollo' }])),
      listOrganizations: handler(async () => ok([{ id: TENANT }])),
      listProjectMembers: handler(async () =>
        ok([{ id: 'asg_1', projectId: 'prj_1', employeeId: 'emp_1', assignedAt: 'x' }]),
      ),
    });
    const result = await tool.execute({ employeeName: 'Sarah', projectName: 'Apollo' }, context);
    expect(result.ok).toBe(true);
  });

  it('finance.flag_over_budget_items fails when the re-read budget is not flagged', async () => {
    const flaggedBudget = {
      id: 'bud_1',
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      name: { value: 'Q3' },
      status: { value: 'under_review' },
    };
    const build = (persistedStatus: string) =>
      new FlagOverBudgetItemsTool({
        flagOverBudgetItems: handler(async () => ok({ flagged: [flaggedBudget], events: [] })),
        listOrganizations: handler(async () => ok([{ id: TENANT }])),
        listMyWorkspaces: handler(async () => ok([{ id: WORKSPACE }])),
        listBudgets: handler(async () => ok([{ id: 'bud_1', status: persistedStatus }])),
      });
    expect(build('active').manifest.verification).toEqual({ source: 'state_readback' });
    const lying = await build('active').execute({}, context);
    expect(lying.ok).toBe(false);
    expect(lying.error).toContain('verification failed');
    const honest = await build('under_review').execute({}, context);
    expect(honest.ok).toBe(true);
  });

  it('notifications.mark_all_read: a lying handler yields a failed execution + lineage verified=false with the declared source', async () => {
    const tool = new MarkAllNotificationsReadTool({
      // The lie: reports 3 marked; the re-count still finds unread.
      markAllRead: handler(async () => ok({ marked: 3 })),
      unreadCount: handler(async () => ok({ count: 2 })),
    });
    const tools = new ExecutableToolRegistry();
    tools.register(tool);
    const repo = new InMemoryLineageRepository();
    const executor = new ToolExecutor({ tools, lineage: new ApiLineagePort(repo) });
    const result = await executor.execute(
      {
        toolId: 'notifications.mark_all_read',
        input: {},
        userId: context.userId,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        runId: 'run_lie',
      },
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.verification).toMatchObject({ verified: false, source: 'state_readback' });
    const records = await repo.list(TENANT);
    const verification = records.find((r) => r.kind === 'VERIFICATION');
    expect(verification?.data).toMatchObject({
      verified: false,
      source: 'state_readback',
      method: 'state_readback',
    });
  });

  it('notifications.mark_all_read: an ordinary handler failure makes NO verification claim (no read-back ran)', async () => {
    const tool = new MarkAllNotificationsReadTool({
      markAllRead: handler(async () => ({ ok: false, error: 'boom' })),
      unreadCount: handler(async () => ok({ count: 0 })),
    });
    const tools = new ExecutableToolRegistry();
    tools.register(tool);
    const executor = new ToolExecutor({ tools });
    const result = await executor.execute(
      {
        toolId: 'notifications.mark_all_read',
        input: {},
        userId: context.userId,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        runId: 'run_plain_failure',
      },
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.verification).toBeUndefined();
  });

  it('notifications.mark_all_read: an honest handler is verified with state_readback', async () => {
    const tool = new MarkAllNotificationsReadTool({
      markAllRead: handler(async () => ok({ marked: 3 })),
      unreadCount: handler(async () => ok({ count: 0 })),
    });
    const tools = new ExecutableToolRegistry();
    tools.register(tool);
    const repo = new InMemoryLineageRepository();
    const executor = new ToolExecutor({ tools, lineage: new ApiLineagePort(repo) });
    const result = await executor.execute(
      {
        toolId: 'notifications.mark_all_read',
        input: {},
        userId: context.userId,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        runId: 'run_ok',
      },
      true,
    );
    expect(result.ok).toBe(true);
    expect(result.verification).toMatchObject({ verified: true, source: 'state_readback' });
  });
});

describe('declared verification of connector writes', () => {
  it('claims only what the connector does', () => {
    expect(connectorWriteVerification('github.issues.create')).toEqual({
      source: 'provider_readback',
    });
    expect(connectorWriteVerification('slack.messages.send')).toMatchObject({
      source: 'response_shape',
    });
    expect(connectorWriteVerification('slack.messages.send').limitation).toBeTruthy();
    expect(connectorWriteVerification('other.write').source).toBe('handler_result');
  });
});
