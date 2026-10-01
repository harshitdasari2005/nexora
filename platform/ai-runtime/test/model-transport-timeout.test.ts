/**
 * @nexora/ai-runtime — OpenAI-compatible transport timeout classification
 * (Prompt 7). A known timeout is a ProviderError carrying `details.timeout`,
 * so runtime telemetry can report MODEL_TIMEOUT rather than a generic error.
 * Runs against a real local HTTP server (no fetch stub).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { completeOpenAICompatible } from '../src/adapters/openai-compatible-transport.js';
import { ProviderError } from '../src/errors/index.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function serve(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/v1`;
}

const request = { messages: [{ role: 'user' as const, content: 'hi' }] };

function options(baseUrl: string, timeoutMs?: number) {
  return {
    providerId: 'local',
    model: 'test-model',
    baseUrl,
    requireApiKey: false,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

describe('completeOpenAICompatible — timeout classification', () => {
  it('a slow server past timeoutMs => ProviderError with details.timeout and a "timed out" message', async () => {
    const baseUrl = await serve(() => {
      // Never respond.
    });
    const error = await completeOpenAICompatible(options(baseUrl, 60), request).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderError);
    const providerError = error as ProviderError;
    expect(providerError.message).toContain('timed out');
    expect((providerError.details as { timeout?: boolean }).timeout).toBe(true);
  });

  it('HTTP 500 is a failure but NOT a timeout', async () => {
    const baseUrl = await serve((_req, res) => {
      res.statusCode = 500;
      res.end('internal boom');
    });
    const error = await completeOpenAICompatible(options(baseUrl, 2000), request).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderError);
    const providerError = error as ProviderError;
    expect(providerError.message).toContain('HTTP 500');
    expect(providerError.message).not.toContain('timed out');
    expect((providerError.details as { timeout?: boolean }).timeout).toBeUndefined();
  });

  it('an unreachable server is a send failure, not a timeout', async () => {
    const baseUrl = await serve(() => undefined);
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    const error = await completeOpenAICompatible(options(baseUrl, 2000), request).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toContain('could not be sent');
    expect(((error as ProviderError).details as { timeout?: boolean }).timeout).toBeUndefined();
  });

  it('success maps content, model and usage', async () => {
    const baseUrl = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          model: 'served-model',
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
        }),
      );
    });
    const result = await completeOpenAICompatible(options(baseUrl, 2000), request);
    expect(result).toEqual({
      content: 'hello',
      finishReason: 'stop',
      model: 'served-model',
      usage: { promptTokens: 11, completionTokens: 4, totalTokens: 15 },
    });
  });

  it('a response without usage maps usage to undefined (never estimated)', async () => {
    const baseUrl = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }));
    });
    const result = await completeOpenAICompatible(options(baseUrl, 2000), request);
    expect(result.usage).toBeUndefined();
    expect(result.model).toBe('test-model');
  });
});
