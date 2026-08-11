/**
 * @nexora/ai-runtime — adapters tests.
 */

import { describe, expect, it } from 'vitest';

import { OpenAIAdapter } from '../src/adapters/openai-adapter.js';
import { GroqAdapter } from '../src/adapters/groq-adapter.js';
import { AnthropicAdapter } from '../src/adapters/anthropic-adapter.js';
import { OllamaAdapter } from '../src/adapters/ollama-adapter.js';
import { ProviderError } from '../src/errors/index.js';

describe('provider adapter placeholders', () => {
  it('openai declares its contract shape', () => {
    const adapter = new OpenAIAdapter({ model: 'gpt-4o' });
    expect(adapter.id).toBe('openai');
    expect(adapter.models).toEqual(['gpt-4o']);
    expect(adapter.capabilities).toEqual(['chat', 'embedding', 'streaming']);
    expect(adapter.chat).toBeDefined();
    expect(adapter.embedding).toBeDefined();
    expect(adapter.streaming).toBeDefined();
  });

  it('openai chat fails loudly with ProviderError until wired', async () => {
    const adapter = new OpenAIAdapter({ model: 'gpt-4o' });
    await expect(adapter.chat!.complete({ messages: [] })).rejects.toThrow(ProviderError);
  });

  it('openai embedding fails loudly until wired', async () => {
    const adapter = new OpenAIAdapter({ model: 'gpt-4o' });
    await expect(adapter.embedding!.embed(['hi'])).rejects.toThrow(ProviderError);
  });

  it('openai streaming fails loudly until wired', async () => {
    const adapter = new OpenAIAdapter({ model: 'gpt-4o' });
    const stream = adapter.streaming!.stream([]);
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(ProviderError);
  });

  it('groq declares its contract shape', () => {
    const adapter = new GroqAdapter({ model: 'llama-3.3-70b-versatile' });
    expect(adapter.id).toBe('groq');
    expect(adapter.capabilities).toEqual(['chat']);
  });

  it('groq chat fails loudly until an API key is configured', async () => {
    const adapter = new GroqAdapter({ model: 'llama-3.3-70b-versatile' });
    await expect(adapter.chat!.complete({ messages: [] })).rejects.toThrow(ProviderError);
  });

  it('anthropic declares its contract shape', () => {
    const adapter = new AnthropicAdapter({ model: 'claude-3-5-sonnet' });
    expect(adapter.id).toBe('anthropic');
    expect(adapter.capabilities).toEqual(['chat', 'streaming']);
  });

  it('anthropic chat fails loudly until wired', async () => {
    const adapter = new AnthropicAdapter({ model: 'claude-3-5-sonnet' });
    await expect(adapter.chat!.complete({ messages: [] })).rejects.toThrow(ProviderError);
  });

  it('ollama declares its contract shape', () => {
    const adapter = new OllamaAdapter({ model: 'llama3', baseUrl: 'http://localhost:11434' });
    expect(adapter.id).toBe('ollama');
    expect(adapter.capabilities).toEqual(['chat', 'streaming']);
  });

  it('ollama chat fails loudly until wired', async () => {
    const adapter = new OllamaAdapter({ model: 'llama3' });
    await expect(adapter.chat!.complete({ messages: [] })).rejects.toThrow(ProviderError);
  });

  it('providers are interchangeable through the ModelProvider contract', () => {
    const adapters = [
      new OpenAIAdapter({ model: 'gpt-4o' }),
      new GroqAdapter({ model: 'llama' }),
      new AnthropicAdapter({ model: 'claude' }),
      new OllamaAdapter({ model: 'llama3' }),
    ] as const;
    for (const adapter of adapters) {
      expect(adapter.id.length).toBeGreaterThan(0);
      expect(adapter.models.length).toBeGreaterThan(0);
    }
  });
});
