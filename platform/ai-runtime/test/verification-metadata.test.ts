/**
 * @nexora/ai-runtime — verification metadata tests (Prompt 9, G4).
 *
 * A tool DECLARES how its success is confirmed; the executor carries the
 * declared source (default `handler_result` + limitation) and the verifier's
 * per-rule checks on the result and the lineage EXECUTION event. A source is
 * never upgraded to a read-back the tool did not declare.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_VERIFICATION,
  type Tool,
  type ToolVerificationMetadata,
} from '@nexora/agent-sdk/tools';
import { nowIso } from '@nexora/shared/time';

import * as runtime from '../src/index.js';
import { DefaultExecutionVerifier } from '../src/verification/execution-verifier.js';
import { ToolExecutor, type ToolInvocation } from '../src/execution/tool-executor.js';
import { ExecutableToolRegistry } from '../src/registry/executable-tools.js';
import type { ExecutionEvent, LineagePort } from '../src/execution/lineage-port.js';

const TOOL_ID = 'crm.update';
const invocation: ToolInvocation = {
  toolId: TOOL_ID,
  capabilityId: TOOL_ID,
  input: { name: 'x' },
  userId: 'usr_alice',
  tenantId: 'org_acme',
  runId: 'run_1',
  origin: 'orchestrator',
};

function build(options: {
  verification?: ToolVerificationMetadata;
  ok?: boolean;
  readBackFailed?: boolean;
  verifier?: DefaultExecutionVerifier;
}) {
  const executed: ExecutionEvent[] = [];
  const lineage: LineagePort = {
    planned: async () => undefined,
    executed: async (event) => void executed.push(event),
  };
  const tool: Tool = {
    manifest: {
      id: TOOL_ID,
      name: 'Update',
      description: 'updates',
      sideEffectClass: 'read_only',
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      },
      ...(options.verification === undefined ? {} : { verification: options.verification }),
    },
    execute: async () =>
      options.ok === false
        ? {
            ok: false,
            error: 'no',
            ...(options.readBackFailed === true ? { readBackFailed: true } : {}),
            completedAt: nowIso(),
          }
        : { ok: true, output: { id: 1 }, completedAt: nowIso() },
  };
  const tools = new ExecutableToolRegistry();
  tools.register(tool);
  const executor = new ToolExecutor({
    tools,
    lineage,
    ...(options.verifier === undefined ? {} : { verifier: options.verifier }),
  });
  return { executor, executed };
}

describe('ToolExecutor verification metadata', () => {
  it('defaults to handler_result with the documented limitation when the tool declares nothing', async () => {
    const { executor, executed } = build({});
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(true);
    expect(result.verification).toEqual({
      verified: true,
      source: 'handler_result',
      limitation: 'the tool reported success; no independent state read-back',
      checks: [{ ruleId: 'result.successful', passed: true }],
    });
    expect(result.verification?.source).toBe(DEFAULT_TOOL_VERIFICATION.source);
    expect(executed[0]?.verification).toEqual(result.verification);
  });

  it('carries a DECLARED state_readback source (no limitation invented)', async () => {
    const { executor, executed } = build({ verification: { source: 'state_readback' } });
    const result = await executor.execute(invocation);
    expect(result.verification).toEqual({
      verified: true,
      source: 'state_readback',
      checks: [{ ruleId: 'result.successful', passed: true }],
    });
    expect(result.verification).not.toHaveProperty('limitation');
    expect(executed[0]?.verification?.source).toBe('state_readback');
  });

  it.each(['provider_readback', 'response_shape', 'handler_result', 'redetection'] as const)(
    'carries the declared source %s and its limitation',
    async (source) => {
      const { executor } = build({ verification: { source, limitation: 'only proves X' } });
      const result = await executor.execute(invocation);
      expect(result.verification).toMatchObject({ source, limitation: 'only proves X' });
    },
  );

  it('never claims a read-back the tool did not declare (undeclared or handler_result stays handler_result)', async () => {
    for (const verification of [undefined, { source: 'handler_result' as const }]) {
      const { executor, executed } = build(verification === undefined ? {} : { verification });
      const result = await executor.execute(invocation);
      expect(['state_readback', 'provider_readback', 'redetection']).not.toContain(
        result.verification?.source,
      );
      expect(executed[0]?.verification?.source).toBe('handler_result');
    }
  });

  it('forwards the verifier per-rule checks, including custom rules', async () => {
    const verifier = new DefaultExecutionVerifier([
      {
        id: 'output.has_id',
        description: 'has id',
        check: (r) => (r.output as { id?: number }).id === 1,
      },
    ]);
    const { executor } = build({ verification: { source: 'state_readback' }, verifier });
    const result = await executor.execute(invocation);
    expect(result.verification?.checks).toEqual([
      { ruleId: 'result.successful', passed: true },
      { ruleId: 'output.has_id', passed: true },
    ]);
  });

  it('a failing rule yields UNVERIFIED: verified=false, the failed check is reported, source unchanged', async () => {
    const verifier = new DefaultExecutionVerifier([
      { id: 'readback.matches', description: 'read-back', check: () => false },
    ]);
    const { executor, executed } = build({ verification: { source: 'state_readback' }, verifier });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNVERIFIED');
    expect(result.verified).toBe(false);
    expect(result.verification).toMatchObject({
      verified: false,
      source: 'state_readback',
      checks: [
        { ruleId: 'result.successful', passed: true },
        { ruleId: 'readback.matches', passed: false },
      ],
    });
    expect(executed[0]).toMatchObject({ status: 'unverified', verified: false });
    expect(executed[0]?.verification?.checks).toContainEqual({
      ruleId: 'readback.matches',
      passed: false,
    });
    // No output is leaked on an unverified result.
    expect(result.output).toBeUndefined();
  });

  it('a tool that reported failure carries no verification claim', async () => {
    const { executor, executed } = build({ ok: false, verification: { source: 'state_readback' } });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.verification).toBeUndefined();
    expect(executed[0]?.verification).toBeUndefined();
  });

  it('a tool whose OWN read-back disagreed is failed AND carries its declared source (verified=false)', async () => {
    const { executor, executed } = build({
      ok: false,
      readBackFailed: true,
      verification: { source: 'state_readback' },
    });
    const result = await executor.execute(invocation);
    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.verification).toMatchObject({ verified: false, source: 'state_readback' });
    expect(executed[0]?.verification).toMatchObject({ verified: false, source: 'state_readback' });
    // The flag never upgrades an undeclared tool: the default source is recorded.
    const undeclared = build({ ok: false, readBackFailed: true });
    const other = await undeclared.executor.execute(invocation);
    expect(other.verification?.source).toBe('handler_result');
  });

  it('a refusal before execution carries no verification and emits no execution event', async () => {
    const { executor, executed } = build({});
    const result = await executor.execute({ ...invocation, input: { role: 'admin' } });
    expect(result.ok).toBe(false);
    expect(result.verification).toBeUndefined();
    expect(executed).toHaveLength(0);
  });

  it('approvedBy on the invocation is carried to the EXECUTION event (descriptive only)', async () => {
    const { executor, executed } = build({});
    await executor.execute({
      ...invocation,
      approvalId: 'apr_1',
      approvedBy: { userId: 'usr_approver', decidedAt: '2026-09-30T00:00:00.000Z' },
    });
    expect(executed[0]?.approvedBy).toEqual({
      userId: 'usr_approver',
      decidedAt: '2026-09-30T00:00:00.000Z',
    });
    expect(executed[0]?.userId).toBe('usr_alice');
  });

  it('absent approvedBy is not invented', async () => {
    const { executor, executed } = build({});
    await executor.execute(invocation);
    expect(executed[0]).not.toHaveProperty('approvedBy');
  });
});

describe('verification defaults', () => {
  it('DEFAULT_TOOL_VERIFICATION is frozen, handler_result, and re-exported by the runtime', () => {
    expect(Object.isFrozen(DEFAULT_TOOL_VERIFICATION)).toBe(true);
    expect(DEFAULT_TOOL_VERIFICATION).toEqual({
      source: 'handler_result',
      limitation: 'the tool reported success; no independent state read-back',
    });
    expect(runtime.DEFAULT_TOOL_VERIFICATION).toBe(DEFAULT_TOOL_VERIFICATION);
  });

  it('the state machine and lifecycle helpers are exported from the package index', () => {
    expect(typeof runtime.canTransition).toBe('function');
    expect(typeof runtime.assertTransition).toBe('function');
    expect(typeof runtime.sourcesOf).toBe('function');
    expect(runtime.APPROVAL_TRANSITIONS.executing).toEqual(['completed', 'failed']);
    expect(runtime.EXECUTION_LIFECYCLE.VERIFIED.approval).toBe('completed');
    expect(typeof runtime.checkArgumentTrust).toBe('function');
    expect(runtime.MAX_ARGUMENT_DEPTH).toBe(6);
  });
});
