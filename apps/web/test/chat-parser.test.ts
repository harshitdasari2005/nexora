/**
 * Unit tests for the SSE parser behind the AI chat client (pure function —
 * no DOM or network required).
 */

import { describe, expect, it } from 'vitest';

import { parseSseEvents, splitSseBuffer } from '../src/lib/chat.js';

describe('parseSseEvents', () => {
  it('parses a single event with a JSON payload', () => {
    const events = parseSseEvents('event: meta\ndata: {"runId":"run_1"}\n\n');
    expect(events).toEqual([{ event: 'meta', data: '{"runId":"run_1"}' }]);
  });

  it('parses multiple events in order', () => {
    const body = [
      'event: meta',
      'data: {"runId":"run_1"}',
      '',
      'event: delta',
      'data: {"text":"hel"}',
      '',
      'event: done',
      'data: {"status":"completed"}',
      '',
    ].join('\n');
    expect(parseSseEvents(body).map((event) => event.event)).toEqual(['meta', 'delta', 'done']);
  });

  it('defaults to the message event when event: is omitted', () => {
    const events = parseSseEvents('data: hello\n\n');
    expect(events).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('joins multi-line data payloads', () => {
    const events = parseSseEvents('event: done\ndata: {"a":1}\ndata: {"b":2}\n\n');
    expect(events[0]?.data).toBe('{"a":1}\n{"b":2}');
  });

  it('skips comment blocks and empty input', () => {
    expect(parseSseEvents(': keepalive\n\n')).toEqual([]);
    expect(parseSseEvents('')).toEqual([]);
    expect(parseSseEvents('   \n\n')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const events = parseSseEvents('event: delta\r\ndata: {"text":"hi"}\r\n\r\n');
    expect(events).toEqual([{ event: 'delta', data: '{"text":"hi"}' }]);
  });

  it('parses the final flush of an unterminated tail (stream end)', () => {
    const events = parseSseEvents('event: delta\ndata: {"text":"hi"}');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: 'delta', data: '{"text":"hi"}' });
  });
});

describe('splitSseBuffer', () => {
  it('keeps a partial event fully buffered until its terminator arrives', () => {
    // A chunk split mid-`data:` must not be sliced: the leading characters
    // would otherwise be lost and the event mangled.
    const split = splitSseBuffer('event: delta\ndata: {"text":"he');
    expect(split).toEqual({ complete: '', rest: 'event: delta\ndata: {"text":"he' });
  });

  it('extracts complete blocks and keeps the trailing partial', () => {
    const split = splitSseBuffer('event: meta\ndata: {}\n\nevent: delta\ndata: {"text":"he');
    expect(split.complete).toBe('event: meta\ndata: {}\n\n');
    expect(split.rest).toBe('event: delta\ndata: {"text":"he');
  });

  it('handles multiple complete blocks in one buffer', () => {
    const split = splitSseBuffer('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n');
    expect(split.complete).toBe('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n');
    expect(split.rest).toBe('');
  });

  it('returns the whole buffer as rest when nothing is terminated', () => {
    const split = splitSseBuffer('no terminator here');
    expect(split).toEqual({ complete: '', rest: 'no terminator here' });
  });

  it('reassembles an event split across chunks losslessly', () => {
    // Simulates the stream loop: partial chunk, then completion, then flush.
    const first = 'event: delta\ndata: {"text":"he';
    const second = 'll"}\n\n';
    const buffered = splitSseBuffer(first).rest + second;
    const finished = splitSseBuffer(buffered);
    expect(finished.rest).toBe('');
    const events = parseSseEvents(finished.complete);
    expect(events).toEqual([{ event: 'delta', data: '{"text":"hell"}' }]);
  });
});
