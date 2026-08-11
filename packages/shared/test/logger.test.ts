import { describe, expect, it } from 'vitest';

import { createLogger, isLogLevel, type LogRecord } from '../src/logger/index.js';

/** Captures every line a logger writes. */
function captureWriter(): { lines: string[]; writer: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    writer: (line: string): void => {
      lines.push(line);
    },
  };
}

/** Parses a captured log line back into a structured record. */
function parseLine(line: string): LogRecord {
  return JSON.parse(line) as LogRecord;
}

describe('logger', () => {
  it('emits a JSON record with level, timestamp, message, and context', () => {
    const { lines, writer } = captureWriter();
    const log = createLogger({ service: 'projects', tenantId: 'tenant_1' }, writer);

    log.info('project.created', { projectId: 'prj_1' });

    expect(lines).toHaveLength(1);
    const record = parseLine(lines[0]!);
    expect(record.level).toBe('info');
    expect(record.message).toBe('project.created');
    expect(record.context.service).toBe('projects');
    expect(record.context.tenantId).toBe('tenant_1');
    expect(record.context.projectId).toBe('prj_1');
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.error).toBeUndefined();
  });

  it('attaches serialized error details on error-level records', () => {
    const { lines, writer } = captureWriter();
    const log = createLogger({ service: 'workflow' }, writer);
    const cause = new Error('boom');

    log.error('step.failed', cause);

    const record = parseLine(lines[0]!);
    expect(record.level).toBe('error');
    expect(record.error?.name).toBe('Error');
    expect(record.error?.message).toBe('boom');
  });

  it('derives scoped child loggers via with()', () => {
    const { lines, writer } = captureWriter();
    const parent = createLogger({ service: 'hr', tenantId: 'tenant_1' }, writer);
    const child = parent.with({ workspaceId: 'ws_9' });

    child.warn('capacity.low');

    const record = parseLine(lines[0]!);
    expect(record.context.tenantId).toBe('tenant_1');
    expect(record.context.workspaceId).toBe('ws_9');
  });

  it('filters records below the minimum level', () => {
    const { lines, writer } = captureWriter();
    const log = createLogger({ service: 'search' }, writer, 'warn');

    log.debug('hidden');
    log.info('hidden');
    log.warn('visible');

    expect(lines).toHaveLength(1);
    expect(parseLine(lines[0]!).level).toBe('warn');
  });

  it('recognizes valid log levels', () => {
    expect(isLogLevel('info')).toBe(true);
    expect(isLogLevel('trace')).toBe(false);
    expect(isLogLevel(42)).toBe(false);
  });
});
