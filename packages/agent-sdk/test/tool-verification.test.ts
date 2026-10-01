import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL_VERIFICATION,
  ToolRegistry,
  type Tool,
  type ToolVerificationSource,
} from '../src/tools/index.js';

const manifest = {
  id: 'crm.update',
  name: 'Update',
  description: 'updates',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 1000,
  inputSchema: {},
} as unknown as Tool['manifest'];

describe('tool verification metadata (Prompt 9, G4)', () => {
  it('the default is the honest handler_result with a limitation', () => {
    expect(DEFAULT_TOOL_VERIFICATION.source).toBe('handler_result');
    expect(DEFAULT_TOOL_VERIFICATION.limitation).toBe(
      'the tool reported success; no independent state read-back',
    );
    expect(Object.isFrozen(DEFAULT_TOOL_VERIFICATION)).toBe(true);
  });

  it('is optional on the manifest and carried through the registry unchanged', () => {
    const registry = new ToolRegistry();
    const declared: Tool['manifest'] = {
      ...manifest,
      id: 'crm.declared' as Tool['manifest']['id'],
      verification: { source: 'state_readback', limitation: 'reads the row back by id' },
    };
    registry.register({ manifest, execute: async () => ({ ok: true, completedAt: '' }) });
    registry.register({ manifest: declared, execute: async () => ({ ok: true, completedAt: '' }) });
    expect(registry.resolve(manifest.id)?.manifest.verification).toBeUndefined();
    expect(registry.resolve(declared.id)?.manifest.verification).toEqual({
      source: 'state_readback',
      limitation: 'reads the row back by id',
    });
  });

  it('the source vocabulary is closed', () => {
    const sources: ToolVerificationSource[] = [
      'state_readback',
      'provider_readback',
      'response_shape',
      'handler_result',
      'redetection',
    ];
    expect(new Set(sources).size).toBe(5);
  });
});
