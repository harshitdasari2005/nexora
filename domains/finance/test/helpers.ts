/**
 * Shared test helpers for the Finance domain tests.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { FinanceEventContext } from '../src/events/index.js';

/** The default test tenant. */
export const TENANT = 'org_acme' as TenantId;

/** The default test workspace. */
export const WORKSPACE = 'ws_finance' as WorkspaceId;

/** The default test user. */
export const USER = 'usr_priya' as UserId;

/** A valid test budget period (Q3 FY26). */
export function q3Period(): { periodStart: string; periodEnd: string } {
  return { periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-09-30T00:00:00.000Z' };
}

/** Builds a Finance event context for a test. */
export function financeContext(
  actorId: string = USER,
  organizationId: TenantId = TENANT,
  workspaceId: WorkspaceId = WORKSPACE,
  correlationId = 'corr_test',
): FinanceEventContext {
  return {
    actor: { kind: 'user', id: actorId },
    correlationId,
    organizationId,
    workspaceId,
  };
}
