/**
 * Shared test helpers for the HR domain tests.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { EmployeeEventContext } from '../src/events/index.js';

/** The default test tenant. */
export const TENANT = 'org_acme' as TenantId;

/** Builds a standard user event context for a test. */
export function userContext(
  actorId = 'usr_alex',
  organizationId: TenantId = TENANT,
  correlationId = 'corr_test',
): EmployeeEventContext {
  return {
    actor: { kind: 'user', id: actorId },
    correlationId,
    organizationId,
  };
}

/** Builds a system event context for a test. */
export function systemContext(
  organizationId: TenantId = TENANT,
  correlationId = 'corr_test',
): EmployeeEventContext {
  return {
    actor: { kind: 'system', id: 'system' },
    correlationId,
    organizationId,
  };
}
