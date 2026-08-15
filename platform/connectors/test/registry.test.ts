/**
 * @nexora/connectors — registry tests (S25 Phase 7).
 *
 * Verifies the generic connector registry: registration, lookup, capability
 * mapping, tool resolution, and duplicate rejection. The registry is
 * credential- and provider-agnostic — a minimal fake connector proves the
 * contract without any provider specifics.
 */

import { describe, expect, it } from 'vitest';

import {
  ConnectorRegistry,
  connectorFailure,
  providerStatusToErrorCode,
  type ConnectorTool,
  type ConnectorToolResult,
  type ExternalConnector,
} from '../src/index.js';

/** Builds a minimal fake connector for registry-contract tests. */
function fakeConnector(id: string, tools: readonly ConnectorTool[]): ExternalConnector {
  return {
    id,
    name: id.toUpperCase(),
    provider: id,
    capabilities: tools.map((tool) => tool.requiredCapability),
    tools,
    resolveTool: (toolId) => tools.find((tool) => tool.id === toolId),
  };
}

function readTool(id: string, capability: string): ConnectorTool {
  return {
    id,
    name: id,
    description: `Reads ${id}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    requiredCapability: capability,
    operationType: 'read',
    requiresApproval: false,
    timeoutMs: 10_000,
    execute: async () => ({ ok: true, output: { id } }),
  };
}

function writeTool(id: string, capability: string): ConnectorTool {
  return {
    id,
    name: id,
    description: `Writes ${id}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    requiredCapability: capability,
    operationType: 'write',
    requiresApproval: true,
    timeoutMs: 15_000,
    execute: async () => ({ ok: true, output: { id } }),
  };
}

describe('ConnectorRegistry', () => {
  it('registers and resolves connectors by id', () => {
    const registry = new ConnectorRegistry();
    const github = fakeConnector('github', [readTool('github.issues.list', 'github.issues.list')]);
    registry.register(github);

    expect(registry.get('github')).toBe(github);
    expect(registry.has('github')).toBe(true);
    expect(registry.list()).toEqual([github]);
    expect(registry.size).toBe(1);
    expect(registry.get('slack')).toBeUndefined();
    expect(registry.has('unknown')).toBe(false);
  });

  it('rejects duplicate connector ids (startup validation)', () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeConnector('github', []));
    expect(() => registry.register(fakeConnector('github', []))).toThrow(
      'Connector already registered: github',
    );
  });

  it('resolves a tool by stable id across connectors', () => {
    const registry = new ConnectorRegistry();
    registry.register(
      fakeConnector('github', [readTool('github.issues.list', 'github.issues.list')]),
    );
    registry.register(
      fakeConnector('slack', [readTool('slack.channels.list', 'slack.channels.list')]),
    );

    const github = registry.resolveTool('github.issues.list');
    expect(github?.connector.id).toBe('github');
    expect(github?.tool.id).toBe('github.issues.list');

    const slack = registry.resolveTool('slack.channels.list');
    expect(slack?.connector.id).toBe('slack');

    // Unknown tool → indistinguishable from nonexistent (no leak).
    expect(registry.resolveTool('github.admin')).toBeUndefined();
  });

  it('resolves a capability to its owning connector + tool', () => {
    const registry = new ConnectorRegistry();
    registry.register(
      fakeConnector('github', [
        readTool('github.issues.list', 'github.issues.list'),
        writeTool('github.issues.create', 'github.issues.create'),
      ]),
    );

    const resolved = registry.resolveCapability('github.issues.create');
    expect(resolved?.connector.id).toBe('github');
    expect(resolved?.tool.operationType).toBe('write');
    expect(resolved?.tool.requiresApproval).toBe(true);
    expect(registry.resolveCapability('github.unknown')).toBeUndefined();
  });

  it('enumerates tools and capability ids across connectors', () => {
    const registry = new ConnectorRegistry();
    registry.register(
      fakeConnector('github', [
        readTool('github.issues.list', 'github.issues.list'),
        writeTool('github.issues.create', 'github.issues.create'),
      ]),
    );
    registry.register(
      fakeConnector('slack', [readTool('slack.channels.list', 'slack.channels.list')]),
    );

    expect(
      registry
        .tools()
        .map((tool) => tool.id)
        .sort(),
    ).toEqual(['github.issues.create', 'github.issues.list', 'slack.channels.list']);
    expect(registry.capabilityIds().sort()).toEqual([
      'github.issues.create',
      'github.issues.list',
      'slack.channels.list',
    ]);
  });

  it('a registered connector resolves its own tools', () => {
    const tool = readTool('github.issues.list', 'github.issues.list');
    const github = fakeConnector('github', [tool]);
    expect(github.resolveTool('github.issues.list')).toBe(tool);
    expect(github.resolveTool('github.other')).toBeUndefined();
  });
});

describe('connector error model', () => {
  it('builds a structured failure result', () => {
    const failure = connectorFailure('PROVIDER_RATE_LIMITED', 'Rate limited by the provider');
    expect(failure.ok).toBe(false);
    expect(failure.error?.code).toBe('PROVIDER_RATE_LIMITED');
    expect(failure.error?.message).toBe('Rate limited by the provider');
  });

  it('maps provider HTTP status codes to stable Nexora codes', () => {
    expect(providerStatusToErrorCode(401)).toBe('PROVIDER_AUTH_FAILED');
    expect(providerStatusToErrorCode(403)).toBe('PROVIDER_PERMISSION_DENIED');
    expect(providerStatusToErrorCode(404)).toBe('PROVIDER_NOT_FOUND');
    expect(providerStatusToErrorCode(429)).toBe('PROVIDER_RATE_LIMITED');
    expect(providerStatusToErrorCode(500)).toBe('PROVIDER_UNAVAILABLE');
    expect(providerStatusToErrorCode(503)).toBe('PROVIDER_UNAVAILABLE');
    expect(providerStatusToErrorCode(200)).toBe('PROVIDER_UNAVAILABLE');
  });
});

/** A connector result type-check: write results carry typed output. */
const _result: ConnectorToolResult = { ok: true, output: { id: 'x' } };
void _result;
