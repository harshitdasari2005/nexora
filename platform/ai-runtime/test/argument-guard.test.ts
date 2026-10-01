/**
 * @nexora/ai-runtime — tool argument guard tests.
 *
 * Tool arguments are untrusted. The executor rejects forged scope/authority
 * at any depth and under any common spelling, enforces the tool's declared
 * schema BEFORE the approval gate, and records forged-scope and capability
 * blocks as structured security decisions (never argument values).
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';
import { nowIso } from '@nexora/shared/time';

import { ArgumentGuard, findReservedArgumentPaths } from '../src/execution/argument-guard.js';
import type { SecurityDecision } from '../src/execution/security-decision.js';
import { ToolExecutor } from '../src/execution/tool-executor.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';

const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1, maxLength: 20 } },
  required: ['name'],
  additionalProperties: false,
};

describe('findReservedArgumentPaths', () => {
  it.each([
    [{ organizationId: 'x' }, ['organizationId']],
    [{ organization_id: 'x' }, ['organization_id']],
    [{ TenantID: 'x' }, ['TenantID']],
    [{ 'workspace-id': 'x' }, ['workspace-id']],
    [{ userId: 'x', role: 'admin' }, ['userId', 'role']],
    [{ capabilities: ['a'] }, ['capabilities']],
    [{ approvalState: 'approved' }, ['approvalState']],
    [{ approved: true }, ['approved']],
    [{ meta: { nested: { permissions: ['*'] } } }, ['meta.nested.permissions']],
    [{ items: [{ isAdmin: true }] }, ['items[0].isAdmin']],
  ])('finds forged scope/authority in %j', (value, paths) => {
    expect(findReservedArgumentPaths(value)).toEqual(paths);
  });

  it('allows ordinary business fields, including resource ids the service re-checks', () => {
    expect(
      findReservedArgumentPaths({ name: 'Atlas', budgetId: 'bud_1', title: 'Role review' }),
    ).toEqual([]);
  });
});

describe('ArgumentGuard', () => {
  const guard = new ArgumentGuard();

  it('accepts schema-conforming arguments', () => {
    expect(guard.check('t', SCHEMA, { name: 'Atlas' })).toEqual({ ok: true });
  });

  it('rejects forged scope before schema validation, naming the field (not the value)', () => {
    const result = guard.check('t', SCHEMA, { name: 'Atlas', workspaceId: 'wsp_attacker' });
    expect(result).toMatchObject({ ok: false, code: 'RESERVED_ARGUMENT' });
    if (!result.ok) {
      expect(result.reason).toContain('workspaceId');
      expect(result.reason).not.toContain('wsp_attacker');
    }
  });

  it('rejects missing required fields, wrong types, unknown fields, and bounds', () => {
    expect(guard.check('t', SCHEMA, {})).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
    expect(guard.check('t', SCHEMA, { name: 7 })).toMatchObject({ ok: false });
    expect(guard.check('t', SCHEMA, { name: 'a', extra: 1 })).toMatchObject({ ok: false });
    expect(guard.check('t', SCHEMA, { name: 'x'.repeat(21) })).toMatchObject({ ok: false });
    expect(guard.check('t', SCHEMA, null)).toMatchObject({ ok: false });
    expect(guard.check('t', SCHEMA, ['name'])).toMatchObject({ ok: false });
  });

  it('fails closed on a schema that cannot compile', () => {
    expect(guard.check('broken', { type: 'not-a-type' }, { name: 'a' })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });
});

function recordingExecutor(sideEffectClass: 'read_only' | 'consequential' = 'read_only') {
  let executed = 0;
  const tool: Tool = {
    manifest: {
      id: 'demo.write',
      name: 'Demo',
      description: 'demo',
      sideEffectClass,
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: SCHEMA,
    },
    execute: async () => {
      executed += 1;
      return { ok: true, output: {}, completedAt: nowIso() };
    },
  };
  const tools = new ExecutableToolRegistry();
  tools.register(tool);
  const decisions: SecurityDecision[] = [];
  const executor = new ToolExecutor({
    tools,
    securitySink: (decision) => {
      decisions.push(decision);
    },
  });
  return { executor, decisions, executed: () => executed };
}

const invocation = {
  toolId: 'demo.write',
  userId: 'usr_1',
  tenantId: 'org_1',
  workspaceId: 'wsp_1',
  runId: 'run_1',
};

describe('ToolExecutor security decisions', () => {
  it('blocks forged scope even when approval is granted, and records a structured decision', async () => {
    const { executor, decisions, executed } = recordingExecutor('consequential');
    const result = await executor.execute(
      { ...invocation, input: { name: 'Atlas', organizationId: 'org_attacker' }, origin: 'mcp' },
      true,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'RESERVED_ARGUMENT' } });
    expect(executed()).toBe(0);
    expect(decisions).toEqual([
      {
        actorId: 'usr_1',
        origin: 'mcp',
        invocationId: 'run_1',
        organizationId: 'org_1',
        workspaceId: 'wsp_1',
        toolId: 'demo.write',
        capabilityId: 'demo.write',
        action: 'tool.execute',
        // Every block names the stable policy it enforces (Prompt 5).
        policyId: 'POLICY_ARGUMENT_TRUST',
        policyDecision: 'deny',
        reasonCode: 'RESERVED_ARGUMENT',
        reason: expect.stringContaining('organizationId'),
        outcome: 'blocked',
        occurredAt: expect.any(String),
      },
    ]);
    expect(JSON.stringify(decisions)).not.toContain('org_attacker');
  });

  it('records a capability outside the trusted ceiling as a security decision', async () => {
    const { executor, decisions, executed } = recordingExecutor();
    const result = await executor.execute({
      ...invocation,
      input: { name: 'Atlas' },
      allowedCapabilityIds: ['something.else'],
    });
    expect(result.error?.code).toBe('FORBIDDEN');
    expect(executed()).toBe(0);
    expect(decisions[0]).toMatchObject({ reasonCode: 'CAPABILITY_NOT_PERMITTED' });
  });

  it('rejects schema-invalid arguments before the approval gate without a security record', async () => {
    const { executor, decisions, executed } = recordingExecutor('consequential');
    const result = await executor.execute({ ...invocation, input: {} }, false);
    // Not "approval required": invalid input never reaches the gate.
    expect(result).toMatchObject({
      ok: false,
      blocked: false,
      error: { code: 'INVALID_ARGUMENTS' },
    });
    expect(executed()).toBe(0);
    expect(decisions).toEqual([]); // an incomplete request is not an attack
  });

  it('a failing sink never un-blocks the action', async () => {
    const tool = recordingExecutor();
    const executor = new ToolExecutor({
      tools: (() => {
        const tools = new ExecutableToolRegistry();
        tools.register({
          manifest: {
            id: 'demo.write',
            name: 'Demo',
            description: 'demo',
            sideEffectClass: 'read_only',
            idempotent: false,
            timeoutMs: 1000,
            inputSchema: SCHEMA,
          },
          execute: async () => ({ ok: true, output: {}, completedAt: nowIso() }),
        });
        return tools;
      })(),
      securitySink: () => {
        throw new Error('audit store down');
      },
    });
    void tool;
    const result = await executor.execute({ ...invocation, input: { name: 'A', userId: 'u' } });
    expect(result.error?.code).toBe('RESERVED_ARGUMENT');
  });
});
