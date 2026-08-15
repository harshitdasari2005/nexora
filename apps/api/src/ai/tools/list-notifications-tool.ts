/**
 * @nexora/app-api — ListNotificationsTool.
 *
 * The recipient-scoped notification inbox capability exposed to the Nexora
 * MCP server (MCP adapter). It lists ONLY the notifications of the
 * authenticated user, inside the trusted tenant and (when scoped) the
 * verified workspace.
 *
 * Security contract (same model as every tool):
 * - Identity (`userId`) and tenant scope (`tenantId`) come exclusively from
 *   the trusted execution context — never from the prompt, tool arguments,
 *   or model-generated JSON.
 * - Authorization is delegated to the notifications **application layer**
 *   (`ListNotificationsHandler` — recipient = authenticated user is the
 *   single access rule).
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { ListNotificationsHandler, NotificationDto } from '@nexora/module-notifications';

/** Input contract: intentionally empty — the model cannot scope or impersonate. */
export type ListNotificationsInput = Record<string, never>;

/** Output contract of {@link ListNotificationsTool}. */
export interface ListNotificationsOutput {
  /** The authenticated user's notifications (newest first). */
  notifications: readonly NotificationDto[];
}

/** The tool manifest (read-only, idempotent). */
export const LIST_NOTIFICATIONS_MANIFEST: ToolManifest = {
  id: 'notifications.list',
  name: 'List Notifications',
  description: 'Lists the current user notifications in the current workspace',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

/**
 * The read tool that lists the authenticated user's notifications through
 * the notifications application layer under the trusted execution context.
 */
export class ListNotificationsTool implements Tool<
  ListNotificationsInput,
  ListNotificationsOutput
> {
  readonly manifest = LIST_NOTIFICATIONS_MANIFEST;

  readonly #listNotifications: ListNotificationsHandler;

  constructor(listNotifications: ListNotificationsHandler) {
    this.#listNotifications = listNotifications;
  }

  async execute(
    _input: ListNotificationsInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<ListNotificationsOutput>> {
    // Identity + tenant (+ workspace) come from the trusted context only.
    const result = await this.#listNotifications.handle({
      userId: context.userId as UserId,
      tenantId: context.tenantId as TenantId,
      workspaceId: context.workspaceId as WorkspaceId | undefined,
      limit: 50,
    });
    if (!result.ok) {
      return this.#failure('Could not list notifications');
    }
    return {
      ok: true,
      output: { notifications: result.value.notifications },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<ListNotificationsOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}
