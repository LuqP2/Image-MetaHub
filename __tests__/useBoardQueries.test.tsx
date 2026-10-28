import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBoardQueries } from '../hooks/useBoardQueries';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardQueryStore } from '../store/useBoardQueryStore';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame, updateSmartFrameQuery, updateSmartFrameLayout } from '../services/boards/smartFrameOperations';
import { updateObjects } from '../services/boards/operations';
import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';
import { evaluateBoardQueries } from '../services/boards/queryEvaluator';
import type { BoardQueryDataset, BoardQueryRequest } from '../services/boards/queryProtocol';
import { boardImage, boardDirectory } from './helpers/boardIntegrationFixtures';

vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
class WorkerMock {
  static messages: BoardQueryRequest[] = [];
  dataset: BoardQueryDataset | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  disposed = false;
  postMessage(message: BoardQueryRequest) {
    WorkerMock.messages.push(message);
    if (message.type === 'syncDataset') this.dataset = message.dataset;
    if (message.type === 'evaluateBoard' && this.dataset) {
      const results = evaluateBoardQueries(this.dataset, message.frames, message.datasetRevision, message.queryRevision);
      queueMicrotask(() => { if (!this.disposed) this.onmessage?.({ data: { type: 'boardResults', boardId: message.boardId, datasetRevision: message.datasetRevision, queryRevision: message.queryRevision, results } } as MessageEvent); });
    }
  }
  terminate() { this.disposed = true; }
}
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); vi.unstubAllGlobals(); });

describe('Canvas query lifecycle', () => {
  it('keeps results transient, reuses the dataset for criteria edits, and ignores geometry', async () => {
    vi.stubGlobal('Worker', WorkerMock); WorkerMock.messages = [];
    const first = { ...boardImage('a.png'), models: ['Flux'] };
    const second = { ...boardImage('b.png'), models: ['SDXL'] };
    useImageStore.setState({ images: [first, second], directories: [boardDirectory], collections: [] });
    useSettingsStore.setState({ enableSafeMode: false });
    const document = createSmartFrame(createBoardDocument(), { id: 'frame' });
    useBoardStore.getState().adoptBoard(document);
    const hook = renderHook(({ loading }) => useBoardQueries(document.id, loading), { initialProps: { loading: false } });
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.frame.totalCount).toBe(2));
    expect(useBoardStore.getState().sessions[document.id].changeSequence).toBe(0);
    act(() => useBoardStore.getState().executeOperation(document.id, doc => updateSmartFrameQuery(doc, 'frame', normalizeLibraryQueryCriteria({ selectedModels: ['Flux'] }))));
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.frame.imageIds).toEqual([first.id]));
    expect(WorkerMock.messages.filter(message => message.type === 'syncDataset')).toHaveLength(1);
    act(() => useBoardStore.getState().executeOperation(document.id, doc => updateSmartFrameLayout(doc, 'frame', { kind: 'matrix', rows: 'lora', columns: 'model' })));
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.frame.grouped?.kind).toBe('matrix'));
    expect(WorkerMock.messages.filter(message => message.type === 'syncDataset')).toHaveLength(1);
    const count = WorkerMock.messages.length;
    act(() => useBoardStore.getState().executeOperation(document.id, doc => updateObjects(doc, [{ id: 'frame', x: 500, title: 'Moved' }])));
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(WorkerMock.messages).toHaveLength(count);
    hook.rerender({ loading: true });
    expect(useBoardQueryStore.getState().results[document.id]).toBeUndefined();
    hook.rerender({ loading: false });
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.frame.status).toBe('ready'));
    const sequence = useBoardStore.getState().sessions[document.id].changeSequence;
    act(() => useImageStore.setState({ images: [{ ...first, models: ['SDXL'] }, second] }));
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.frame.totalCount).toBe(0));
    expect(useBoardStore.getState().sessions[document.id].changeSequence).toBe(sequence);
    hook.unmount();
    expect(useBoardQueryStore.getState().results[document.id]).toBeUndefined();
  });
});
