/**
 * @nexora/ai-runtime — memory tests.
 */

import { describe, expect, it } from 'vitest';

import { FakeMemoryProvider } from '../src/testing/fakes.js';

describe('memory contracts', () => {
  it('re-exports the agent SDK memory interfaces (type surface)', async () => {
    // Runtime consumers use MemoryProvider/MemoryStore from this module.
    const memory = new FakeMemoryProvider();
    await memory.store({
      id: 'm1',
      content: 'prefers email',
      createdAt: '2026-08-08T00:00:00.000Z',
    });
    const result = await memory.retrieve({ text: 'email' });
    expect(result.items).toHaveLength(1);
    const snapshot = await memory.snapshot();
    expect(snapshot.items).toHaveLength(1);
  });

  it('FakeMemoryProvider filters by query text', async () => {
    const memory = new FakeMemoryProvider();
    await memory.store({ id: 'a', content: 'likes coffee', createdAt: 'x' });
    await memory.store({ id: 'b', content: 'likes tea', createdAt: 'x' });
    const result = await memory.retrieve({ text: 'coffee' });
    expect(result.items.map((item) => item.id)).toEqual(['a']);
  });
});
