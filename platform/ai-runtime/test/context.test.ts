/**
 * @nexora/ai-runtime — context tests.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import { buildAIContext, validateAIContext } from '../src/context/index.js';

/** Brands a plain string as a tenant id (test helper). */
function tenant(value: string): TenantId {
  return value as TenantId;
}

/** Brands a plain string as a workspace id (test helper). */
function workspace(value: string): WorkspaceId {
  return value as WorkspaceId;
}

describe('buildAIContext', () => {
  const base = {
    execution: {
      runId: 'run_1',
      tenantId: tenant('tenant_1'),
      userId: 'user_1',
      startedAt: '2026-08-08T00:00:00.000Z',
    },
    user: { userId: 'user_1' },
    organization: { tenantId: tenant('tenant_1') },
    permissions: { userId: 'user_1', autonomyTier: 'supervised' as const },
  };

  it('builds a valid context from inputs', () => {
    const context = buildAIContext(base);
    expect(context.execution.runId).toBe('run_1');
    expect(context.organization.tenantId).toBe('tenant_1');
    expect(context.permissions.autonomyTier).toBe('supervised');
  });

  it('stamps the start time when absent', () => {
    const rest = {
      user: base.user,
      organization: base.organization,
      permissions: base.permissions,
    };
    const context = buildAIContext({
      execution: { runId: 'run_1', tenantId: tenant('t'), userId: 'u' },
      ...rest,
    });
    expect(Date.parse(context.execution.startedAt)).not.toBeNaN();
  });

  it('preserves workspace and conversation when provided', () => {
    const context = buildAIContext({
      ...base,
      workspace: { workspaceId: workspace('ws_1'), name: 'Eng' },
      conversation: { conversationId: 'conv_1', userId: 'user_1', history: [] },
    });
    expect(context.workspace?.workspaceId).toBe('ws_1');
    expect(context.conversation?.conversationId).toBe('conv_1');
  });

  it('flows the trusted business context through untouched (S24 Phase 3)', () => {
    const business = {
      domainId: 'technology',
      domainName: 'Technology',
      roleId: 'technology.developer',
      roleName: 'Developer',
      capabilityIds: ['projects.find_project', 'knowledge.search'],
    };
    const context = buildAIContext({ ...base, business });
    expect(context.business).toEqual(business);
  });
});

describe('validateAIContext', () => {
  const valid = buildAIContext({
    execution: {
      runId: 'run_1',
      tenantId: tenant('tenant_1'),
      userId: 'user_1',
      startedAt: '2026-08-08T00:00:00.000Z',
    },
    user: { userId: 'user_1' },
    organization: { tenantId: tenant('tenant_1') },
    permissions: { userId: 'user_1', autonomyTier: 'supervised' },
  });

  it('returns no issues for a valid context', () => {
    expect(validateAIContext(valid)).toEqual([]);
  });

  it('flags a missing run id', () => {
    const context = { ...valid, execution: { ...valid.execution, runId: '' } };
    expect(validateAIContext(context).map((i) => i.path)).toContain('execution.runId');
  });

  it('flags a missing tenant id', () => {
    const context = { ...valid, execution: { ...valid.execution, tenantId: tenant('') } };
    expect(validateAIContext(context).map((i) => i.path)).toContain('execution.tenantId');
  });

  it('flags a missing user id', () => {
    const context = { ...valid, user: { userId: '' } };
    expect(validateAIContext(context).map((i) => i.path)).toContain('user.userId');
  });

  it('flags an unparseable start time', () => {
    const context = { ...valid, execution: { ...valid.execution, startedAt: 'not-a-date' } };
    expect(validateAIContext(context).map((i) => i.path)).toContain('execution.startedAt');
  });

  it('flags mismatched organization tenant', () => {
    const context = { ...valid, organization: { tenantId: tenant('tenant_2') } };
    const issues = validateAIContext(context);
    expect(issues.length).toBeGreaterThan(0);
  });
});
