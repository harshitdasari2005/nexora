import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRuntimeRunRepository } from '../src/index.js';
import { makeRun } from './helpers.js';

describe('InMemoryRuntimeRunRepository', () => {
  let repo: InMemoryRuntimeRunRepository;
  beforeEach(() => {
    repo = new InMemoryRuntimeRunRepository();
  });

  it('is append-only: a duplicate id in the same tenant is rejected', async () => {
    await repo.append(makeRun({ id: 'r1' }));
    await expect(repo.append(makeRun({ id: 'r1', status: 'failed' }))).rejects.toThrow(
      /already recorded/,
    );
    expect((await repo.get('t1', 'r1'))?.status).toBe('completed');
    await expect(repo.append(makeRun({ id: 'r1', tenantId: 't2' }))).resolves.toBeUndefined();
  });

  it('is tenant-scoped', async () => {
    await repo.append(makeRun({ id: 'r1', tenantId: 't1' }));
    await repo.append(makeRun({ id: 'r2', tenantId: 't2' }));
    expect((await repo.list('t1')).map((r) => r.id)).toEqual(['r1']);
    expect(await repo.list('t3')).toEqual([]);
    expect(await repo.get('t1', 'r2')).toBeUndefined();
    expect((await repo.get('t2', 'r2'))?.id).toBe('r2');
    expect(await repo.get('t1', 'missing')).toBeUndefined();
  });

  it('applies every filter', async () => {
    await repo.append(
      makeRun({
        id: 'a',
        workspaceId: 'w1',
        requestId: 'req1',
        agentId: 'ag1',
        actorId: 'u1',
        origin: 'agent',
        provider: 'groq',
        model: 'llama',
        status: 'failed',
        startedAt: '2026-01-02T00:00:00.000Z',
        failure: { stage: 'EXECUTION', code: 'TOOL_EXECUTION_FAILED', class: 'EXECUTION' },
      }),
    );
    await repo.append(
      makeRun({
        id: 'b',
        workspaceId: 'w2',
        requestId: 'req2',
        actorId: 'u2',
        origin: 'mcp',
        provider: 'ollama',
        model: 'qwen',
        startedAt: '2026-01-05T00:00:00.000Z',
      }),
    );
    const ids = async (q: Parameters<typeof repo.list>[1]): Promise<string[]> =>
      (await repo.list('t1', q)).map((r) => r.id);
    expect(await ids({ workspaceId: 'w1' })).toEqual(['a']);
    expect(await ids({ status: 'completed' })).toEqual(['b']);
    expect(await ids({ status: 'failed' })).toEqual(['a']);
    expect(await ids({ failureStage: 'EXECUTION' })).toEqual(['a']);
    expect(await ids({ failureStage: 'POLICY' })).toEqual([]);
    expect(await ids({ failureClass: 'EXECUTION' })).toEqual(['a']);
    expect(await ids({ failureClass: 'DENIED' })).toEqual([]);
    expect(await ids({ provider: 'ollama' })).toEqual(['b']);
    expect(await ids({ model: 'llama' })).toEqual(['a']);
    expect(await ids({ agentId: 'ag1' })).toEqual(['a']);
    expect(await ids({ actorId: 'u2' })).toEqual(['b']);
    expect(await ids({ origin: 'mcp' })).toEqual(['b']);
    expect(await ids({ requestId: 'req1' })).toEqual(['a']);
    expect(await ids({ from: '2026-01-03T00:00:00.000Z' })).toEqual(['b']);
    expect(await ids({ to: '2026-01-03T00:00:00.000Z' })).toEqual(['a']);
    expect(await ids({ from: '2026-01-02T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' })).toEqual(
      ['a'],
    );
    expect(await ids({ workspaceId: 'w1', status: 'completed' })).toEqual([]);
  });

  it('orders newest first (id breaks ties) and honours limit', async () => {
    await repo.append(makeRun({ id: 'old', startedAt: '2026-01-01T00:00:00.000Z' }));
    await repo.append(makeRun({ id: 'new', startedAt: '2026-01-03T00:00:00.000Z' }));
    await repo.append(makeRun({ id: 'mid_a', startedAt: '2026-01-02T00:00:00.000Z' }));
    await repo.append(makeRun({ id: 'mid_b', startedAt: '2026-01-02T00:00:00.000Z' }));
    expect((await repo.list('t1')).map((r) => r.id)).toEqual(['new', 'mid_b', 'mid_a', 'old']);
    expect((await repo.list('t1', { limit: 2 })).map((r) => r.id)).toEqual(['new', 'mid_b']);
  });

  it('defaults the limit to 100', async () => {
    for (let i = 0; i < 105; i += 1) {
      await repo.append(makeRun({ id: `r${String(i).padStart(3, '0')}` }));
    }
    expect(await repo.list('t1')).toHaveLength(100);
  });

  it('returns deep copies and stores deep copies', async () => {
    const input = makeRun({ id: 'r1', stages: [{ stage: 'POLICY', durationMs: 1, count: 1 }] });
    await repo.append(input);
    (input.stages as { durationMs: number }[])[0]!.durationMs = 999;

    const fromGet = await repo.get('t1', 'r1');
    (fromGet!.stages as { durationMs: number }[])[0]!.durationMs = 555;
    (fromGet as { status: string }).status = 'failed';

    const fromList = (await repo.list('t1'))[0]!;
    (fromList.stages as { durationMs: number }[])[0]!.durationMs = 777;

    const fresh = await repo.get('t1', 'r1');
    expect(fresh?.stages[0]?.durationMs).toBe(1);
    expect(fresh?.status).toBe('completed');
  });
});
