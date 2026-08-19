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
import type { MarkAllNotificationsReadHandler } from '@nexora/module-notifications';

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

  constructor(dependencies: {
    /** The application-layer mark-all-read command handler. */
    markAllRead: MarkAllNotificationsReadHandler;
  }) {
    this.#markAllRead = dependencies.markAllRead;
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
    return {
      ok: true,
      output: { marked: result.value.marked },
      completedAt: new Date().toISOString(),
    };
  }
}
