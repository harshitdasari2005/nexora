/**
 * @nexora/mcp — server engine unit tests.
 *
 * Verifies the generic MCP engine in isolation (no business logic):
 * - `tools/list` is capability-aware (CEO/Manager/Developer sets differ).
 * - A caller with no capability affinity sees NO tools (fail closed).
 * - A guessed/unlisted tool is never callable (capability re-checked).
 * - Strict input validation at the MCP boundary.
 * - Tool failures map to structured results with stable Nexora codes.
 */

import { describe, expect, it } from 'vitest';

import { NexoraMCPServer, type NexoraMCPContext, type NexoraMCPTool } from '../src/index.js';

/** A configurable fake MCP tool for engine tests. */
function fakeTool(overrides: Partial<NexoraMCPTool['definition']> = {}): NexoraMCPTool {
  const definition = {
    name: 'nexora.test.read',
    description: 'A test read tool',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
      additionalProperties: false,
    },
    requiredCapability: 'test.read',
    operationType: 'read' as const,
    requiresApproval: false,
    ...overrides,
  };
  return {
    definition,
    handle: async (args) => ({ ok: true, output: { echoed: args } }),
  };
}

const WRITE_TOOL = fakeTool({
  name: 'nexora.test.write',
  description: 'A test write tool',
  requiredCapability: 'test.write',
  operationType: 'write',
  requiresApproval: true,
});

const READ_OTHER = fakeTool({
  name: 'nexora.other.read',
  description: 'A test tool in another capability',
  requiredCapability: 'test.other',
});

const ALL_TOOLS: readonly NexoraMCPTool[] = [fakeTool(), WRITE_TOOL, READ_OTHER];

function buildServer(
  capabilityIds: readonly string[],
  tools: readonly NexoraMCPTool[] = ALL_TOOLS,
): { server: NexoraMCPServer; context: NexoraMCPContext } {
  const context: NexoraMCPContext = {
    userId: 'usr_1',
    tenantId: 'org_1',
    capabilityIds,
    correlationId: 'run_1',
  };
  return {
    server: new NexoraMCPServer({ name: 'nexora-test', version: '1.0.0', tools, context }),
    context,
  };
}

describe('NexoraMCPServer — capability-aware discovery', () => {
  it('lists only tools whose required capability is in the caller affinity', () => {
    const { server } = buildServer(['test.read', 'test.write']);
    const names = server.visibleTools().map((tool) => tool.definition.name);
    expect(names).toEqual(['nexora.test.read', 'nexora.test.write']);
    expect(names).not.toContain('nexora.other.read');
  });

  it('exposes a different tool set per capability profile (role-aware)', () => {
    const { server: ceo } = buildServer(['test.read', 'test.write', 'test.other']);
    const { server: developer } = buildServer(['test.read']);

    expect(ceo.visibleTools()).toHaveLength(3);
    const developerNames = developer.visibleTools().map((tool) => tool.definition.name);
    expect(developerNames).toEqual(['nexora.test.read']);
  });

  it('fails closed with an empty or unknown capability affinity (no tools)', () => {
    const { server: none } = buildServer([]);
    const { server: unknown } = buildServer(['test.unknown_capability']);
    expect(none.visibleTools()).toHaveLength(0);
    expect(unknown.visibleTools()).toHaveLength(0);
  });
});

describe('NexoraMCPServer — invocation', () => {
  it('invokes a visible tool with validated arguments', async () => {
    const { server } = buildServer(['test.read']);
    const result = await server.call('nexora.test.read', { id: 'prj_1' });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ echoed: { id: 'prj_1' } });
  });

  it('rejects an unknown tool name', async () => {
    const { server } = buildServer(['test.read']);
    const result = await server.call('nexora.does_not_exist', {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TOOL_NOT_FOUND');
  });

  it('a guessed tool outside the capability affinity is not callable', async () => {
    // The tool EXISTS in the server but the caller lacks the capability —
    // it must be indistinguishable from a nonexistent tool.
    const { server } = buildServer(['test.read']);
    const result = await server.call('nexora.test.write', {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TOOL_NOT_FOUND');
  });

  it('rejects arguments that fail the strict input schema', async () => {
    const { server } = buildServer(['test.read']);
    const missing = await server.call('nexora.test.read', {});
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe('INVALID_INPUT');

    // additionalProperties: forged identity/scope fields are rejected.
    const forged = await server.call('nexora.test.read', {
      id: 'prj_1',
      tenantId: 'org_alien',
      workspaceId: 'wsp_alien',
      roleId: 'executive.ceo',
    });
    expect(forged.ok).toBe(false);
    expect(forged.error?.code).toBe('INVALID_INPUT');
  });

  it('forged identity/scope fields are rejected before the handler runs (strict schema)', async () => {
    let invoked = false;
    const spyingTool: NexoraMCPTool = {
      definition: {
        name: 'nexora.test.read',
        description: 'a',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        requiredCapability: 'test.read',
        operationType: 'read',
        requiresApproval: false,
      },
      handle: async (args) => {
        invoked = true;
        return { ok: true, output: { echoed: args } };
      },
    };
    const { server } = buildServer(['test.read'], [spyingTool]);
    const result = await server.call('nexora.test.read', { id: 'x', tenantId: 'org_alien' });
    // additionalProperties: false — the call is rejected, the handler never
    // runs with the forged scope.
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(invoked).toBe(false);
  });

  it('maps handler failures to structured error codes', async () => {
    const failing: NexoraMCPTool = {
      definition: {
        name: 'nexora.test.write',
        description: 'a',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        requiredCapability: 'test.write',
        operationType: 'write',
        requiresApproval: true,
      },
      handle: async () => ({
        ok: false,
        error: { code: 'EXECUTION_FAILED', message: 'boom' },
      }),
    };
    const { server } = buildServer(['test.write'], [failing]);
    const result = await server.call('nexora.test.write', {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_FAILED');
  });
});

describe('NexoraMCPServer — implementation metadata', () => {
  it('advertises the server name and version', () => {
    const { server } = buildServer(['test.read']);
    expect(server.implementation()).toEqual({ name: 'nexora-test', version: '1.0.0' });
  });
});
