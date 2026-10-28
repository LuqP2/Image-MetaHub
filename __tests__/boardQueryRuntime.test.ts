import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoardQueryRuntime, type BoardQueryWorkerPort } from '../services/boards/queryRuntime';
import type { BoardQueryDataset, BoardQueryRequest } from '../services/boards/queryProtocol';
import { createSmartFrame } from '../services/boards/smartFrameOperations';
import { createBoardDocument } from '../services/boards/document.mjs';
import type { BoardSmartFrameObject } from '../services/boards/queryTypes';

const data: BoardQueryDataset = { images: [], references: {}, collections: {}, context: { visibleDirectories: [], safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] } } };
function fixture() {
  vi.useFakeTimers();
  const ports: BoardQueryWorkerPort[] = [];
  const messages: BoardQueryRequest[] = [];
  const publish = vi.fn();
  const runtime = createBoardQueryRuntime('board', () => {
    const port: BoardQueryWorkerPort = { postMessage: message => messages.push(message), onmessage: null, onerror: null, terminate: vi.fn() };
    ports.push(port); return port;
  }, publish);
  const frame = createSmartFrame(createBoardDocument()).objects[0] as BoardSmartFrameObject;
  return { runtime, ports, messages, publish, frame };
}
afterEach(() => vi.useRealTimers());
describe('board query runtime', () => {
  it('syncs once for ten frames and debounces query changes', async () => {
    const f = fixture();
    f.runtime.syncDataset(data);
    f.runtime.evaluate(Array.from({ length: 10 }, (_, index) => ({ ...f.frame, id: String(index) })));
    await vi.advanceTimersByTimeAsync(150);
    expect(f.messages.map(message => message.type)).toEqual(['syncDataset', 'evaluateBoard']);
    f.runtime.evaluate([f.frame]); f.runtime.evaluate([f.frame]);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.messages.filter(message => message.type === 'syncDataset')).toHaveLength(1);
    f.runtime.dispose(); expect(f.ports[0].terminate).toHaveBeenCalled();
  });
  it('rejects stale replies and releases worker and pending work', async () => {
    const f = fixture(); f.runtime.syncDataset(data); f.runtime.evaluate([f.frame]);
    await vi.advanceTimersByTimeAsync(150);
    const message = f.messages[1]; if (message.type !== 'evaluateBoard') throw new Error('fixture');
    f.runtime.syncDataset(data);
    const calls = f.publish.mock.calls.length;
    f.ports[0].onmessage!({ data: { type: 'boardResults', boardId: 'board', datasetRevision: message.datasetRevision, queryRevision: message.queryRevision, results: {} } } as MessageEvent);
    expect(f.publish).toHaveBeenCalledTimes(calls);
    f.runtime.dispose(); await vi.advanceTimersByTimeAsync(150);
    expect(f.messages).toHaveLength(3);
  });
  it('can recover from worker failure and ignores events from the replaced worker', async () => {
    const f = fixture(); f.runtime.syncDataset(data); f.runtime.evaluate([f.frame]);
    await vi.advanceTimersByTimeAsync(150);
    const failed = f.ports[0]; failed.onerror!({ message: 'crashed' } as ErrorEvent);
    expect(f.publish.mock.lastCall![0][f.frame.id].status).toBe('error');
    f.runtime.retry(); await vi.advanceTimersByTimeAsync(150);
    const count = f.publish.mock.calls.length;
    failed.onerror!({ message: 'old failure' } as ErrorEvent);
    expect(f.publish).toHaveBeenCalledTimes(count);
    expect(f.ports).toHaveLength(2);
    f.runtime.dispose();
  });
});
