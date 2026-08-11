/**
 * @nexora/ai-runtime — providers tests.
 */

import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../src/providers/provider-registry.js';
import type { ModelProvider } from '../src/providers/model-provider.js';
import { ProviderError } from '../src/errors/index.js';

function provider(
  id: string,
  capabilities: readonly ('chat' | 'embedding' | 'streaming')[],
): ModelProvider {
  return {
    id,
    name: id,
    capabilities,
    models: ['model-1'],
  };
}

describe('ProviderRegistry', () => {
  it('registers and resolves providers', () => {
    const registry = new ProviderRegistry();
    registry.register(provider('openai', ['chat', 'embedding']));
    expect(registry.resolve('openai')?.id).toBe('openai');
    expect(registry.size).toBe(1);
  });

  it('throws on duplicate provider ids', () => {
    const registry = new ProviderRegistry();
    registry.register(provider('a', ['chat']));
    expect(() => registry.register(provider('a', ['chat']))).toThrow(ProviderError);
  });

  it('resolves providers by capability', () => {
    const registry = new ProviderRegistry();
    registry.register(provider('chat-only', ['chat']));
    registry.register(provider('embed-only', ['embedding']));
    expect(registry.resolveByCapability('embedding')?.id).toBe('embed-only');
    expect(registry.resolveByCapability('streaming')).toBeUndefined();
  });

  it('require throws when no provider offers the capability', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.require('chat')).toThrow(ProviderError);
  });

  it('require returns a provider when available', () => {
    const registry = new ProviderRegistry();
    registry.register(provider('a', ['chat']));
    expect(registry.require('chat').id).toBe('a');
  });

  it('lists all providers', () => {
    const registry = new ProviderRegistry();
    registry.register(provider('a', ['chat']));
    registry.register(provider('b', ['embedding']));
    expect(registry.all()).toHaveLength(2);
  });
});
