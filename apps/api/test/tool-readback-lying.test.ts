/**
 * Read-back tools — a lying handler is UNVERIFIED.
 *
 * mark_all_read and flag_over_budget_items report success from the write
 * handler; the independent read (unread count / budget list) disagrees, so the
 * result carries `readBackFailed` (verified=false with the declared source).
 */

import { describe, expect, it } from 'vitest';

import { MarkAllNotificationsReadTool } from '../src/ai/tools/mark-all-notifications-read-tool.js';
import { FlagOverBudgetItemsTool } from '../src/ai/tools/flag-over-budget-items-tool.js';

const context = { userId: 'usr_a', tenantId: 'org_a', workspaceId: 'wsp_a', executionId: 'run_1' };

describe('mark_all_read read-back', () => {
  const build = (remaining: number) =>
    new MarkAllNotificationsReadTool({
      markAllRead: { handle: async () => ({ ok: true, value: { marked: 3 } }) } as never,
      unreadCount: { handle: async () => ({ ok: true, value: { count: remaining } }) } as never,
    });

  it('positive control: zero unread verifies', async () => {
    expect((await build(0).execute({}, context)).ok).toBe(true);
  });

  it('handler reports 3 marked but unread notifications remain => unverified', async () => {
    const result = await build(2).execute({}, context);
    expect(result.ok).toBe(false);
    expect(result.readBackFailed).toBe(true);
  });
});

describe('flag_over_budget_items read-back', () => {
  const flagged = {
    id: 'bud_1',
    organizationId: 'org_a',
    workspaceId: 'wsp_a',
    name: { value: 'Ops' },
    status: { value: 'flagged' },
  };
  const build = (persistedStatus: string | undefined) =>
    new FlagOverBudgetItemsTool({
      flagOverBudgetItems: {
        handle: async () => ({ ok: true, value: { flagged: [flagged] } }),
      } as never,
      listOrganizations: { handle: async () => ({ ok: true, value: [{ id: 'org_a' }] }) } as never,
      listMyWorkspaces: { handle: async () => ({ ok: true, value: [{ id: 'wsp_a' }] }) } as never,
      listBudgets: {
        handle: async () => ({
          ok: true,
          value: persistedStatus === undefined ? [] : [{ id: 'bud_1', status: persistedStatus }],
        }),
      } as never,
    });

  it('positive control: the persisted status matches', async () => {
    expect((await build('flagged').execute({}, context)).ok).toBe(true);
  });

  it.each([
    ['still on track', 'on_track'],
    ['missing', undefined],
  ])('handler flagged the budget but it is %s on read-back => unverified', async (_l, status) => {
    const result = await build(status).execute({}, context);
    expect(result.ok).toBe(false);
    expect(result.readBackFailed).toBe(true);
  });
});
