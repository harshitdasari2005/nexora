/**
 * @nexora/ai-runtime — Groq provider transport tests.
 *
 * The wired Groq adapter (AIR.md §1.2 R1) is tested against a stubbed
 * global `fetch` — no network and no vendor SDK are required. The tests
 * cover the request contract (wire payload, auth), response mapping, and
 * every failure class (missing key, HTTP error, transport error, empty
 * completion).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroqAdapter } from '../src/adapters/groq-adapter.js';
import { ProviderError } from '../src/errors/index.js';

const MODEL = 'llama-3.3-70b-versatile';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs global fetch and returns the mock. */
function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Builds a fake fetch Response with a JSON body. */
function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe('GroqAdapter (wired transport)', () => {
  it('declares its contract shape', () => {
    const adapter = new GroqAdapter({ model: MODEL, apiKey: 'sk-test' });
    expect(adapter.id).toBe('groq');
    expect(adapter.capabilities).toEqual(['chat']);
    expect(adapter.models).toEqual([MODEL]);
    expect(adapter.chat).toBeDefined();
  });

  it('rejects without an API key', async () => {
    const adapter = new GroqAdapter({ model: MODEL });
    await expect(
      adapter.chat!.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderError);
  });

  it('posts the OpenAI-compatible payload and maps the completion', async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        model: MODEL,
        choices: [{ message: { content: 'Here are your workspaces.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }),
    );
    const adapter = new GroqAdapter({ model: MODEL, apiKey: 'sk-test' });

    const response = await adapter.chat!.complete({
      messages: [{ role: 'user', content: 'What workspaces do I have?' }],
      temperature: 0.4,
      maxTokens: 128,
    });

    expect(response).toEqual({
      content: 'Here are your workspaces.',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 7, totalTokens: 19 },
      model: MODEL,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: { role: string; content: string }[];
      temperature: number;
      max_tokens: number;
    };
    expect(body.model).toBe(MODEL);
    expect(body.messages).toEqual([{ role: 'user', content: 'What workspaces do I have?' }]);
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(128);
  });

  it('maps a length-truncated finish reason', async () => {
    stubFetch(
      jsonResponse(200, {
        choices: [{ message: { content: 'short' }, finish_reason: 'length' }],
      }),
    );
    const adapter = new GroqAdapter({ model: MODEL, apiKey: 'sk-test' });
    const response = await adapter.chat!.complete({ messages: [] });
    expect(response.finishReason).toBe('length');
  });

  it('throws ProviderError on a non-2xx HTTP response', async () => {
    stubFetch(jsonResponse(429, { error: { message: 'rate limited' } }));
    const adapter = new GroqAdapter({ model: MODEL, apiKey: 'sk-test' });
    await expect(adapter.chat!.complete({ messages: [] })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('throws ProviderError when the transport throws', async () => {
    stubFetch(new Error('ECONNREFUSED'));
    const adapter = new GroqAdapter({ model: MODEL, apiKey: 'sk-test' });
    await expect(adapter.chat!.complete({ messages: [] })).rejects.toThrow(ProviderError);
  });

  it('throws ProviderError on an empty completion payload', async () => {
    stubFetch(jsonResponse(200, { choices: [] }));
    const adapter = new GroqAdapter({ model: MODEL, apiKey: 'sk-test' });
    await expect(adapter.chat!.complete({ messages: [] })).rejects.toThrow(ProviderError);
  });

  it('honors a custom base URL', async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    );
    const adapter = new GroqAdapter({
      model: MODEL,
      apiKey: 'sk-test',
      baseUrl: 'http://localhost:8090/v1/',
    });
    await adapter.chat!.complete({ messages: [] });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:8090/v1/chat/completions');
  });
});
