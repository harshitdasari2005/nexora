/**
 * @nexora/ai-runtime — argument depth fail-closed tests (Prompt 9, G8a).
 *
 * The guard inspects at most MAX_ARGUMENT_DEPTH levels for reserved keys.
 * Anything nested DEEPER is rejected (`ARGUMENT_TOO_DEEP`), audited, and never
 * executed — a reserved key can no longer hide below the inspected depth.
 * Strict schemas still reject unknown keys.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from '@nexora/agent-sdk/tools';
import { nowIso } from '@nexora/shared/time';

import {
  ArgumentGuard,
  MAX_ARGUMENT_DEPTH,
  checkArgumentTrust,
  findReservedArgumentPaths,
  findTooDeepArgumentPath,
} from '../src/execution/argument-guard.js';
import type { SecurityDecision } from '../src/execution/security-decision.js';
import { ToolExecutor } from '../src/execution/tool-executor.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';

/** Builds `{ a: { a: ... { leaf } } }` with `levels` object levels below the root object. */
function nest(levels: number, leaf: unknown = 'x'): Record<string, unknown> {
  let value: unknown = leaf;
  for (let i = 0; i < levels; i += 1) {
    value = { a: value };
  }
  return { root: value };
}

const LOOSE = { type: 'object', additionalProperties: true };
const STRICT = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
};

describe('findTooDeepArgumentPath', () => {
  it('MAX_ARGUMENT_DEPTH is 6', () => {
    expect(MAX_ARGUMENT_DEPTH).toBe(6);
  });

  it('accepts nesting up to the inspected depth and rejects one level beyond', () => {
    // root object = depth 0; `root` value = depth 1 ... depth 6 is the last inspected object.
    expect(findTooDeepArgumentPath(nest(5, { b: 1 }))).toBeUndefined();
    expect(findTooDeepArgumentPath({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toBeUndefined();
    expect(
      findTooDeepArgumentPath({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }),
    ).toBeUndefined();
    expect(findTooDeepArgumentPath({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } })).toBe(
      'a.b.c.d.e.f.g',
    );
  });

  it('counts arrays as nesting and reports an indexed path', () => {
    const arr = [[[[[[[['x']]]]]]]];
    expect(findTooDeepArgumentPath({ list: arr })).toMatch(/^list\[0\]/);
    expect(findTooDeepArgumentPath({ list: [[1]] })).toBeUndefined();
  });

  it('terminates on cyclic structures (fails closed instead of looping)', () => {
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    expect(findTooDeepArgumentPath(cyc)).toBeDefined();
  });

  it('scalars and null never count', () => {
    expect(findTooDeepArgumentPath('s')).toBeUndefined();
    expect(findTooDeepArgumentPath(null)).toBeUndefined();
    expect(findTooDeepArgumentPath({ a: null, b: [1, 2, 3] })).toBeUndefined();
  });
});

describe('checkArgumentTrust', () => {
  it('a reserved key hidden BELOW the inspected depth used to be ignored: now ARGUMENT_TOO_DEEP', () => {
    const hidden = nest(9, { organizationId: 'org_other' });
    // The old walker cannot see it (documenting why fail-closed is needed).
    expect(findReservedArgumentPaths(hidden)).toEqual([]);
    const result = checkArgumentTrust(hidden);
    expect(result).toMatchObject({ ok: false, code: 'ARGUMENT_TOO_DEEP' });
  });

  it('a reserved key inside the inspected depth is still RESERVED_ARGUMENT (more specific wins)', () => {
    expect(checkArgumentTrust({ a: { tenantId: 't' } })).toMatchObject({
      ok: false,
      code: 'RESERVED_ARGUMENT',
    });
    expect(checkArgumentTrust({ a: { agentId: 'agt' } })).toMatchObject({
      ok: false,
      code: 'FORGED_AGENT_CONTEXT',
    });
  });

  it('a reserved key AND deep nesting: reported as reserved (visible forgery first)', () => {
    expect(checkArgumentTrust({ tenantId: 't', ...nest(9) })).toMatchObject({
      code: 'RESERVED_ARGUMENT',
    });
  });

  it('shallow clean arguments pass', () => {
    expect(checkArgumentTrust({ name: 'x', tags: ['a', 'b'], meta: { k: { v: 1 } } })).toEqual({
      ok: true,
    });
  });

  it('the reason names the path only, never values', () => {
    const result = checkArgumentTrust(nest(9, 'SECRET-VALUE'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('deeper than 6');
      expect(result.reason).not.toContain('SECRET-VALUE');
    }
  });
});

describe('ArgumentGuard depth + strict schemas', () => {
  const guard = new ArgumentGuard();

  it('rejects deep nesting even when the schema would allow additional properties', () => {
    expect(guard.check('t', LOOSE, nest(9))).toMatchObject({
      ok: false,
      code: 'ARGUMENT_TOO_DEEP',
    });
  });

  it('accepts a shallow nested argument the schema allows', () => {
    expect(guard.check('t', LOOSE, nest(3))).toEqual({ ok: true });
  });

  it('strict schemas still reject unknown keys (INVALID_ARGUMENTS)', () => {
    const result = guard.check('strict', STRICT, { name: 'x', extra: 1 });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
    if (!result.ok) {
      expect(result.reason).toContain('additionalProperties');
      expect(result.reason).toContain('extra');
    }
    expect(guard.check('strict', STRICT, { name: 'x' })).toEqual({ ok: true });
  });

  it('unknown keys nested in a strict schema are rejected at their level', () => {
    const schema = {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: { status: { type: 'string' } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    };
    expect(guard.check('nested', schema, { filter: { status: 'a', sneaky: 1 } })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });
});

describe('ToolExecutor: ARGUMENT_TOO_DEEP is a security block (audited, never executed)', () => {
  function setup() {
    const decisions: SecurityDecision[] = [];
    let executions = 0;
    const tool: Tool = {
      manifest: {
        id: 'crm.update',
        name: 'Update',
        description: 'u',
        sideEffectClass: 'read_only',
        idempotent: false,
        timeoutMs: 1000,
        inputSchema: LOOSE,
      },
      execute: async () => {
        executions += 1;
        return { ok: true, output: {}, completedAt: nowIso() };
      },
    };
    const tools = new ExecutableToolRegistry();
    tools.register(tool);
    const executor = new ToolExecutor({ tools, securitySink: (d) => void decisions.push(d) });
    return { executor, decisions, executions: () => executions };
  }
  const base = {
    toolId: 'crm.update',
    userId: 'usr_alice',
    tenantId: 'org_acme',
    runId: 'run_1',
  };

  it('rejects deep nesting, audits ARGUMENT_TOO_DEEP under the argument-trust policy, never executes', async () => {
    const { executor, decisions, executions } = setup();
    const result = await executor.execute({
      ...base,
      input: nest(9, { organizationId: 'org_other' }),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ARGUMENT_TOO_DEEP');
    expect(result.attempts).toBe(0);
    expect(executions()).toBe(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      reasonCode: 'ARGUMENT_TOO_DEEP',
      policyId: 'POLICY_ARGUMENT_TRUST',
      outcome: 'blocked',
      actorId: 'usr_alice',
    });
    expect(JSON.stringify(decisions[0])).not.toContain('org_other');
  });

  it('shallow arguments still execute (positive control)', async () => {
    const { executor, decisions, executions } = setup();
    const result = await executor.execute({ ...base, input: nest(3) });
    expect(result.ok).toBe(true);
    expect(executions()).toBe(1);
    expect(decisions).toEqual([]);
  });

  it('checkArguments (pre-approval) reports ARGUMENT_TOO_DEEP so no approval ever opens for it', () => {
    const { executor } = setup();
    expect(executor.checkArguments('crm.update', nest(9))).toMatchObject({
      ok: false,
      code: 'ARGUMENT_TOO_DEEP',
    });
  });
});
