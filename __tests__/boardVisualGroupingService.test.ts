import { beforeEach, expect, it, vi } from 'vitest';
import { encodeRow } from '../services/embeddings/embeddingFormat';
import { prepareVisualGrouping, runVisualGroupingWorker } from '../services/boards/visualGroupingService';
import type { IndexedImage } from '../types';

const state = vi.hoisted(() => ({ enabled: true, reusable: true, limit: 0, open: vi.fn(), ensure: vi.fn(), segment: vi.fn(), index: null as any }));
vi.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({ semanticSearchEnabled: state.enabled }) } }));
vi.mock('../services/embeddings/semanticSearchEngine', () => ({
  openLibrary: () => { state.open(); return state.index; }, getIndex: () => state.index,
  canReuseImageEmbedding: () => state.reusable,
  ensureImageEmbedded: (...args) => state.ensure(...args),
}));
const image = { id: 'a', name: 'a.png', fileSize: 1, lastModified: 1 } as IndexedImage;
beforeEach(() => {
  vi.clearAllMocks(); state.enabled = true; state.reusable = true;
  const bytes = encodeRow(2, { scale: 0.01, codes: new Int8Array([100, 0]) });
  state.segment.mockResolvedValue(bytes.buffer);
  state.ensure.mockResolvedValue(true);
  state.index = { dim: 2, stats: { liveRows: 1 }, hasVector: () => false, rowSnapshot: () => [['a', '1:1', 0]], segmentDescriptors: () => [{ index: 0, rowCount: 1 }], readSegment: state.segment };
});
it('does not check or open the index while the feature is disabled', async () => {
  state.enabled = false;
  await expect(prepareVisualGrouping([image], { signal: new AbortController().signal, limit: 2000, progress() {} })).rejects.toThrow('Enable');
  expect(state.open).not.toHaveBeenCalled();
});
it('reuses vectors, deduplicates image IDs and reads only committed rows', async () => {
  const row = encodeRow(2, { scale: 0.01, codes: new Int8Array([100, 0]) });
  const bytes = new Uint8Array(row.length * 2); bytes.set(row); bytes.set(row, row.length);
  state.segment.mockResolvedValue(bytes.buffer);
  const result = await prepareVisualGrouping([image, image], { signal: new AbortController().signal, limit: 2000, progress() {} });
  expect(result.vectors).toHaveLength(1);
  expect(result.vectors[0].vector[0]).toBeCloseTo(1);
  expect(state.ensure).not.toHaveBeenCalled();
});
it('reports per-image preparation failures and honors the index cap', async () => {
  state.reusable = false;
  const result = await prepareVisualGrouping([image], { signal: new AbortController().signal, limit: 1, progress() {} });
  expect(result.failures[0].error).toContain('limit');
  expect(state.ensure).not.toHaveBeenCalled();
});
it('prepares without touching the active search worker scope and supports cancellation', async () => {
  state.reusable = false;
  const controller = new AbortController();
  await prepareVisualGrouping([image], { signal: controller.signal, limit: 2000, progress() {} });
  expect(state.ensure).toHaveBeenCalledWith(image, false, controller.signal);
  controller.abort();
  state.open.mockClear();
  await expect(prepareVisualGrouping([image], { signal: controller.signal, limit: 2000, progress() {} })).rejects.toThrow();
  expect(state.open).not.toHaveBeenCalled();
});
it('terminates the grouping worker on cancellation', async () => {
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class { terminate = terminate; postMessage() {} });
  try {
    const controller = new AbortController();
    const result = runVisualGroupingWorker([], 0.75, controller.signal, () => {});
    controller.abort();
    await expect(result).rejects.toThrow('Cancelled');
    expect(terminate).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
