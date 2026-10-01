/**
 * Empty capability ceiling regression (call-site decisions are documented in
 * GOVERNED_EXECUTION.md §9a). An EMPTY ceiling is "no authority"; only an
 * ABSENT one (trusted internal caller) is unrestricted.
 */

import { describe, expect, it } from 'vitest';

import { authorizeWorkflowInitiator } from '../src/ai/workflow-initiator.js';

const RBAC = ['hr.create_employee', 'projects.find_project'];
const scope = { userId: 'usr_1', tenantId: 'tnt_1' };

describe('authorizeWorkflowInitiator ceiling modes', () => {
  it('an ABSENT run ceiling defers to the initiator RBAC', async () => {
    const decision = await authorizeWorkflowInitiator({
      resolver: async () => RBAC,
      scope,
      required: ['hr.create_employee'],
    });
    expect(decision.ok).toBe(true);
  });

  it('an EMPTY run ceiling is no authority — it never widens to the initiator role', async () => {
    const decision = await authorizeWorkflowInitiator({
      resolver: async () => RBAC,
      scope,
      runCeiling: [],
      required: ['hr.create_employee'],
    });
    expect(decision).toEqual({ ok: false, missing: ['hr.create_employee'] });
  });

  it('a non-empty run ceiling narrows the initiator RBAC', async () => {
    const decision = await authorizeWorkflowInitiator({
      resolver: async () => RBAC,
      scope,
      runCeiling: ['projects.find_project'],
      required: ['hr.create_employee'],
    });
    expect(decision.ok).toBe(false);
  });

  it('no resolver and no ceiling fails closed', async () => {
    const decision = await authorizeWorkflowInitiator({
      resolver: undefined,
      scope,
      required: ['hr.create_employee'],
    });
    expect(decision.ok).toBe(false);
  });
});
