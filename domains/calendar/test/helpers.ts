/**
 * Shared test helpers for the Calendar domain tests.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { CalendarEventContext } from '../src/events/index.js';

/** The default test tenant. */
export const TENANT = 'org_acme' as TenantId;

/** The default test workspace. */
export const WORKSPACE = 'ws_engineering' as WorkspaceId;

/** The default test user. */
export const USER = 'usr_alex' as UserId;

/** A valid future test window (start + 1h). */
export function futureWindow(
  startsAt = '2026-09-01T15:00:00.000Z',
): { startsAt: string; endsAt: string } {
  return { startsAt, endsAt: '2026-09-01T16:00:00.000Z' };
}

/** Builds a user event context for a test. */
export function userContext(
  actorId: string = USER,
  organizationId: TenantId = TENANT,
  workspaceId: WorkspaceId = WORKSPACE,
  correlationId = 'corr_test',
): CalendarEventContext {
  return {
    actor: { kind: 'user', id: actorId },
    correlationId,
    organizationId,
    workspaceId,
  };
}
