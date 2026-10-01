/**
 * @nexora/app-api — MarkAllNotificationsReadTool.
 *
 * The Notification write capability exposed to the Enterprise AI Runtime:
 * marks the caller's unread notifications read through the SAME
 * `MarkAllNotificationsReadHandler` the REST surface uses (`POST
 * /api/notifications/read-all`). This is the remediation step behind the
 * `project_attention` known solution — clearing the attention backlog is
 * the real, persisted fix the plan verifies by re-evaluating the problem.
 *
 * Security contract (same model as every tool):
 * - Input is EMPTY (`additionalProperties: false`): the model can invoke
 *   the action but can never name a recipient, a tenant, or a workspace.
 * - Identity + scope come exclusively from the trusted execution context.
 * - Delegation: the tool calls the Notification application-layer handler
 *   (the same one the REST surface uses) — never repositories.
 * - Consequential: marking notifications read always requires approval
 *   (BR-13) — the governed remediation plan opens the SAME approval gate
 *   as every other write.
 */

import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type {
  MarkAllNotificationsReadHandler,
  UnreadNotificationsCountHandler,
} from '@nexora/module-notifications';

/** Output contract of {@link MarkAllNotificationsReadTool}. */
export interface MarkAllNotificationsReadOutput {
  /** The number of notifications marked read (authoritative application result). */
  marked: number;
}

/** The tool manifest: consequential (persistent state change, always gated). */
export const MARK_ALL_NOTIFICATIONS_READ_MANIFEST: ToolManifest = {
  id: 'notifications.mark_all_read',
  name: 'Clear attention notifications',
  description: "Marks the current user's unread notifications as read in the current workspace",
  sideEffectClass: 'consequential',
  idempotent: true,
  timeoutMs: 10_000,
  // Read-back: the unread count is re-read after the write and must be zero.
  verification: { source: 'state_readback' },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/**
 * The write tool that clears the caller's unread notifications through the
 * Notification application layer under the trusted execution context.
 */
export class MarkAllNotificationsReadTool implements Tool<
  Record<string, never>,
  MarkAllNotificationsReadOutput
> {
  readonly manifest = MARK_ALL_NOTIFICATIONS_READ_MANIFEST;

  readonly #markAllRead: MarkAllNotificationsReadHandler;
  readonly #unreadCount: UnreadNotificationsCountHandler;

  constructor(dependencies: {
    /** The unread-count query (read-back verification against persisted state). */
    unreadCount: UnreadNotificationsCountHandler;
    /** The application-layer mark-all-read command handler. */
    markAllRead: MarkAllNotificationsReadHandler;
  }) {
    this.#markAllRead = dependencies.markAllRead;
    this.#unreadCount = dependencies.unreadCount;
  }

  async execute(
    _input: Record<string, never>,
    context: ToolExecutionContext,
  ): Promise<ToolResult<MarkAllNotificationsReadOutput>> {
    const tenantId = context.tenantId as TenantId;
    const userId = context.userId as UserId;
    const workspaceId = context.workspaceId as WorkspaceId | undefined;

    const result = await this.#markAllRead.handle({ userId, tenantId, workspaceId });
    if (!result.ok) {
      return {
        ok: false,
        error: 'Could not clear the notification backlog',
        completedAt: new Date().toISOString(),
      };
    }
    // Read-back: re-count the caller's unread notifications in the same scope.
    const remaining = await this.#unreadCount.handle({ userId, tenantId, workspaceId });
    if (!remaining.ok || remaining.value.count !== 0) {
      return {
        ok: false,
        error: 'Notification clearing verification failed: unread notifications remain',
        readBackFailed: true,
        completedAt: new Date().toISOString(),
      };
    }
    return {
      ok: true,
      output: { marked: result.value.marked },
      completedAt: new Date().toISOString(),
    };
  }
}
