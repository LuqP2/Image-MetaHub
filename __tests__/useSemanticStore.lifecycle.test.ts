import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelModelDownload: vi.fn().mockResolvedValue(undefined),
  closeLibrary: vi.fn(),
  deleteEmbeddingIndex: vi.fn().mockResolvedValue(true),
  downloadModel: vi.fn(),
  runBackfill: vi.fn(),
  stopEmbeddingWorker: vi.fn(),
}));

vi.mock('../services/embeddings/embeddingService', () => ({
  cancelModelDownload: mocks.cancelModelDownload,
  deleteModel: vi.fn().mockResolvedValue(undefined),
  downloadModel: mocks.downloadModel,
  getModelStatus: vi.fn().mockResolvedValue({ installed: false, missing: [], totalBytes: 0 }),
  setOnDeviceChanged: vi.fn(),
  setPreferredDevice: vi.fn(),
  setPreferredModel: vi.fn(),
  stopEmbeddingWorker: mocks.stopEmbeddingWorker,
}));

vi.mock('../services/embeddings/embeddingIndexer', () => ({
  runBackfill: mocks.runBackfill,
}));

vi.mock('../services/embeddings/semanticSearchEngine', () => ({
  closeLibrary: mocks.closeLibrary,
  DEFAULT_RESULT_LIMIT: 300,
  getIndex: vi.fn().mockReturnValue(null),
  openLibrary: vi.fn().mockResolvedValue(null),
  searchByImageId: vi.fn(),
  searchByText: vi.fn(),
  searchSimilarToImage: vi.fn(),
  semanticCacheId: vi.fn((model: { cacheId: string }) => model.cacheId),
}));

vi.mock('../services/embeddings/embeddingStore', () => ({
  deleteEmbeddingIndex: mocks.deleteEmbeddingIndex,
}));

import { useImageStore } from '../store/useImageStore';
import { useSemanticStore } from '../store/useSemanticStore';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('semantic job lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useImageStore.getState().resetState();
    useSemanticStore.setState({
      device: 'wasm',
      modelDownloading: false,
      isBackfilling: false,
      isPaused: false,
      indexProgress: null,
      coverage: null,
      lastError: null,
    });
  });

  it('waits for the cancelled backfill flush before closing and deleting the index', async () => {
    const backfill = deferred<void>();
    let signal: AbortSignal | undefined;
    mocks.runBackfill.mockImplementation((options: { signal: AbortSignal }) => {
      signal = options.signal;
      return backfill.promise;
    });

    const running = useSemanticStore.getState().startBackfill(null);
    expect(useSemanticStore.getState().isBackfilling).toBe(true);

    const deleting = useSemanticStore.getState().deleteIndex();
    expect(signal?.aborted).toBe(true);
    expect(mocks.closeLibrary).not.toHaveBeenCalled();
    expect(mocks.deleteEmbeddingIndex).not.toHaveBeenCalled();

    backfill.resolve();
    await running;
    await deleting;

    expect(mocks.closeLibrary).toHaveBeenCalledTimes(1);
    expect(mocks.deleteEmbeddingIndex).toHaveBeenCalledTimes(1);
    expect(mocks.closeLibrary.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.deleteEmbeddingIndex.mock.invocationCallOrder[0]);
  });

  it('waits for download and backfill cancellation before tearing workers down', async () => {
    const download = deferred<{ success: boolean; cancelled: boolean }>();
    const backfill = deferred<void>();
    mocks.downloadModel.mockReturnValue(download.promise);
    mocks.runBackfill.mockReturnValue(backfill.promise);

    const downloading = useSemanticStore.getState().startModelDownload();
    const indexing = useSemanticStore.getState().startBackfill(null);
    const tearingDown = useSemanticStore.getState().teardown();

    expect(mocks.cancelModelDownload).toHaveBeenCalledTimes(1);
    expect(mocks.stopEmbeddingWorker).not.toHaveBeenCalled();

    download.resolve({ success: false, cancelled: true });
    backfill.resolve();
    await downloading;
    await indexing;
    await tearingDown;

    expect(mocks.stopEmbeddingWorker).toHaveBeenCalledTimes(1);
    expect(mocks.closeLibrary).toHaveBeenCalledTimes(1);
    expect(useSemanticStore.getState().modelDownloading).toBe(false);
    expect(useSemanticStore.getState().isBackfilling).toBe(false);
  });
});
