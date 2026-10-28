import { parseA1111Metadata } from '../services/parsers/automatic1111Parser';
import { compactRawMetadataForRuntime } from '../services/fileIndexer';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBoardQueries } from '../hooks/useBoardQueries';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardQueryStore } from '../store/useBoardQueryStore';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame, updateSmartFrameQuery, updateSmartFrameLayout, branchSmartFrameGroup } from '../services/boards/smartFrameOperations';
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
  it.each([false, true])('distinguishes normalized seed zero from missing seeds (compacted: %s)', async compacted => {
    vi.stubGlobal('Worker', WorkerMock); WorkerMock.messages = [];
    const normalizedMetadata = { seed: 0 };
    const runtime = compactRawMetadataForRuntime({ workflow: compacted ? 'x'.repeat(700000) : {} }, normalizedMetadata);
    if (compacted) {
      expect(runtime.metadata).toHaveProperty('_rawMetadataCompacted', true);
      expect(runtime.metadata.normalizedMetadata).toHaveProperty('seedExact', '0');
    }
    // Mirror fileIndexer's numeric projection: zero becomes null, but normalized metadata keeps it.
    const zero = boardImage('zero.png', { seed: normalizedMetadata.seed || null, ...runtime });
    const missing = boardImage('missing.png', { seed: null });
    useImageStore.setState({ images: [zero, missing], directories: [boardDirectory], collections: [] });
    useSettingsStore.setState({ enableSafeMode: false });
    const document = updateSmartFrameLayout(createSmartFrame(createBoardDocument(), { id: 'seeds' }), 'seeds', { kind: 'groups', groupBy: 'seed', subgroupBy: null });
    useBoardStore.getState().adoptBoard(document);
    renderHook(() => useBoardQueries(document.id, false));
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.seeds.grouped?.kind).toBe('groups'));
    const grouped = useBoardQueryStore.getState().results[document.id].seeds.grouped;
    if (grouped?.kind !== 'groups') throw new Error('Expected seed groups');
    expect(grouped.groups).toHaveLength(2);
    const group = grouped.groups.find(bucket => bucket.label === '0')!;
    expect(group.imageIds).toEqual([zero.id]);
    expect(grouped.groups.find(bucket => bucket.constraint.kind === 'missing')?.imageIds).toEqual([missing.id]);
    act(() => useBoardStore.getState().executeOperation(document.id, doc => branchSmartFrameGroup(doc, 'seeds', [group.constraint])));
    const child = useBoardStore.getState().sessions[document.id].document.objects.find(object => object.id !== 'seeds')!;
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.[child.id]?.imageIds).toEqual([zero.id]));
  });

  it('preserves distinct uint64 seeds from parsing through compacted metadata, worker groups and branches', async () => {
    vi.stubGlobal('Worker', WorkerMock); WorkerMock.messages = [];
    const seeds = ['18446744073709551614', '18446744073709551615'];
    const images = seeds.map((seed, index) => {
      const parameters = `${'prompt '.repeat(100000)}\nSteps: 20, Seed: ${seed}, Size: 512x512`;
      const normalizedMetadata = parseA1111Metadata(parameters);
      const runtime = compactRawMetadataForRuntime({ parameters }, normalizedMetadata);
      expect(runtime.metadata).toHaveProperty('_rawMetadataCompacted', true);
      return boardImage(`${index}.png`, { seed: normalizedMetadata.seed, ...runtime });
    });
    expect(images[0].seed).toBe(images[1].seed); // The legacy numeric API has already rounded both.
    useImageStore.setState({ images, directories: [boardDirectory], collections: [] });
    useSettingsStore.setState({ enableSafeMode: false });
    const document = updateSmartFrameLayout(createSmartFrame(createBoardDocument(), { id: 'seeds' }), 'seeds', { kind: 'groups', groupBy: 'seed', subgroupBy: null });
    useBoardStore.getState().adoptBoard(document);
    renderHook(() => useBoardQueries(document.id, false));
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.seeds.grouped?.kind).toBe('groups'));
    const grouped = useBoardQueryStore.getState().results[document.id].seeds.grouped;
    if (grouped?.kind !== 'groups') throw new Error('Expected seed groups');
    expect(grouped.groups.map(group => group.label).sort()).toEqual(seeds);
    for (const group of grouped.groups) expect(group.imageIds).toEqual([images[seeds.indexOf(group.label)].id]);
    act(() => useBoardStore.getState().executeOperation(document.id, doc => branchSmartFrameGroup(doc, 'seeds', [grouped.groups[0].constraint])));
    const child = useBoardStore.getState().sessions[document.id].document.objects.find(object => object.id !== 'seeds')!;
    await waitFor(() => expect(useBoardQueryStore.getState().results[document.id]?.[child.id]?.imageIds).toEqual(grouped.groups[0].imageIds));
  });

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
