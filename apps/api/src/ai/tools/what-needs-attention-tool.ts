/**
 * @nexora/app-api — WhatNeedsAttentionTool.
 *
 * The AI consumer surface for the Notification platform (Part 16): the read
 * capability behind "What needs my attention?". It returns the
 * authenticated user's unread notifications (including approval-required
 * and workflow-failure notifications) and the recent activity of their
 * workspace — ALL permission-filtered by the trusted execution context.
 *
 * Security contract (same model as every other tool):
 * - The AI is a CONSUMER of notification/activity information — it is never
 *   the notification authority. Recipients and scope come exclusively from
 *   the trusted execution context (userId/tenantId/workspaceId); the model
 *   cannot name a recipient, a tenant, or a workspace.
 * - Input is EMPTY (`additionalProperties: false`): the model can ask the
 *   question but can never supply identity, scope, or a permission override.
 * - Delegation: the tool calls the Notification application-layer handlers
 *   (the same ones the REST surface uses) — never repositories, never
 *   databases.
 * - The tool is read-only and idempotent: it changes no business state.
 */

import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type {
  ListActivityHandler,
  ListNotificationsHandler,
  UnreadNotificationsCountHandler,
} from '@nexora/module-notifications';
import type { ActivityItemDto, NotificationDto } from '@nexora/module-notifications';

/** Output contract of {@link WhatNeedsAttentionTool}. */
export interface WhatNeedsAttentionOutput {
  /** The number of unread notifications. */
  unreadCount: number;
  /** The unread notifications (newest first, bounded). */
  notifications: readonly NotificationDto[];
  /** The recent activity of the current workspace (newest first). */
  activity: readonly ActivityItemDto[];
  /** True when anything needs the user's attention. */
  needsAttention: boolean;
}

/** The tool manifest (read-only, idempotent). */
export const WHAT_NEEDS_ATTENTION_MANIFEST: ToolManifest = {
  id: 'notifications.what_needs_attention',
  name: 'Check what needs attention',
  description:
    'Lists the notifications and recent activity that need the current user attention in the current workspace',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
  // Empty input schema with additionalProperties rejected: the model can ask
  // the question but can never define identity, tenant, or scope.
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/** The maximum number of notifications returned. */
const MAX_NOTIFICATIONS = 20;

/** The maximum number of activity items returned. */
const MAX_ACTIVITY = 20;

/**
 * The read tool that surfaces the authenticated user's notification context
 * through the Notification application layer under the trusted execution
 * context.
 */
export class WhatNeedsAttentionTool implements Tool<
  Record<string, never>,
  WhatNeedsAttentionOutput
> {
  readonly manifest = WHAT_NEEDS_ATTENTION_MANIFEST;

  readonly #listNotifications: ListNotificationsHandler;
  readonly #unreadCount: UnreadNotificationsCountHandler;
  readonly #listActivity: ListActivityHandler;

  constructor(dependencies: {
    /** The recipient-scoped inbox listing handler. */
    listNotifications: ListNotificationsHandler;
    /** The unread-count handler. */
    unreadCount: UnreadNotificationsCountHandler;
    /** The workspace-scoped activity handler. */
    listActivity: ListActivityHandler;
  }) {
    this.#listNotifications = dependencies.listNotifications;
    this.#unreadCount = dependencies.unreadCount;
    this.#listActivity = dependencies.listActivity;
  }

  async execute(
    _input: Record<string, never>,
    context: ToolExecutionContext,
  ): Promise<ToolResult<WhatNeedsAttentionOutput>> {
    // Identity + tenant come from the trusted execution context only — never
    // from the prompt or tool arguments.
    const tenantId = context.tenantId as TenantId;
    const userId = context.userId as UserId;
    const workspaceId = context.workspaceId as WorkspaceId | undefined;

    // The inbox is the user's PERSONAL notification context: it is
    // recipient + tenant scoped and deliberately NOT workspace-filtered,
    // because org-scoped events (project.created, workflow.completed…) carry
    // no workspace scope and must still reach their recipient. The activity
    // feed below IS workspace-scoped (it reflects the current workspace).
    const unread = await this.#unreadCount.handle({ userId, tenantId });
    const inbox = await this.#listNotifications.handle({
      userId,
      tenantId,
      limit: MAX_NOTIFICATIONS,
    });
    const activity = await this.#listActivity.handle({
      tenantId,
      workspaceId,
      limit: MAX_ACTIVITY,
    });

    if (!unread.ok || !inbox.ok || !activity.ok) {
      return this.#failure('Could not load your notification context');
    }

    const notifications = inbox.value.notifications.filter((n) => n.status === 'unread');
    return {
      ok: true,
      output: {
        unreadCount: unread.value.count,
        notifications,
        activity: activity.value.activity,
        needsAttention: unread.value.count > 0 || notifications.length > 0,
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<WhatNeedsAttentionOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}
