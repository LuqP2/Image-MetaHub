import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMBEDDING_FORMAT_VERSION,
  SEGMENT_ROWS,
  manifestFileName,
  segmentFileName,
  type EmbeddingManifest,
} from '../services/embeddings/embeddingFormat';
import { EmbeddingIndex } from '../services/embeddings/embeddingStore';

declare global {
  interface Window {
    electronAPI?: any;
  }
}

/**
 * Regression test for the flush() row-numbering bug: a segment append that
 * fails partway through a flush must not leave manifest.totalRows behind what
 * is already durable on disk, or the next flush reissues row numbers a prior,
 * already-committed append already claimed — silently pointing search results
 * at the wrong images.
 */
describe('EmbeddingIndex.flush', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  const cacheId = 'test-lib';
  const modelId = 'test-model';
  const modelRevision = 'main';
  const dim = 4;

  // Seed a manifest two rows short of filling segment 0, so a 4-vector flush
  // straddles the segment boundary: 2 rows land in segment 0 (already has
  // room), 2 more spill into segment 1.
  // Pinned to the live constant: a format bump makes this manifest incompatible,
  // which sends open() down the rebuild path instead of the one under test.
  const seedManifest: EmbeddingManifest = {
    formatVersion: EMBEDDING_FORMAT_VERSION,
    modelId,
    modelRevision,
    dim,
    quant: 'i8-pervec',
    segments: [{ file: segmentFileName(cacheId, 0), rowCount: SEGMENT_ROWS - 2 }],
    rowChunkCount: 0,
    totalRows: SEGMENT_ROWS - 2,
    liveRows: SEGMENT_ROWS - 2,
    tombstoneCount: 0,
    updatedAt: Date.now(),
    centroidSum: new Array(dim).fill(0),
    centroidCount: 0,
  };

  const vector = (n: number) => ({ scale: 1, codes: Int8Array.from([n, n, n, n]) });

  it('keeps totalRows in sync with disk after a partial flush failure, so a retry never reuses a committed row number', async () => {
    const appendEmbeddingSegment = vi.fn();
    const writeEmbeddingFile = vi.fn().mockResolvedValue({ success: true });

    window.electronAPI = {
      getEmbeddingCacheIdentity: vi.fn().mockResolvedValue({ success: true, identity: 'cache-root' }),
      readEmbeddingFile: vi.fn(async ({ fileName }: { fileName: string }) => {
        if (fileName === manifestFileName(cacheId)) {
          return { success: true, data: seedManifest };
        }
        // No row chunks were seeded (rowChunkCount: 0); nothing else is read.
        return { success: true, data: null };
      }),
      writeEmbeddingFile,
      appendEmbeddingSegment,
    };

    const index = await EmbeddingIndex.open(cacheId, modelId, modelRevision, dim);
    expect(index.stats.totalRows).toBe(SEGMENT_ROWS - 2);

    index.append('new-0', 'key-0', vector(0));
    index.append('new-1', 'key-1', vector(1));
    index.append('new-2', 'key-2', vector(2));
    index.append('new-3', 'key-3', vector(3));

    // First append (2 rows, filling segment 0 to capacity) succeeds; the
    // second append (2 rows spilling into segment 1) fails.
    appendEmbeddingSegment
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'disk full' });

    await expect(index.flush()).rejects.toThrow('disk full');

    // The regression: without the fix this stays at SEGMENT_ROWS - 2 (8190)
    // even though segment 0 on disk was already filled to SEGMENT_ROWS (8192)
    // by the first, successful append call above.
    expect(index.stats.totalRows).toBe(SEGMENT_ROWS);
    expect(appendEmbeddingSegment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fileName: segmentFileName(cacheId, 0),
        expectedOffset: (SEGMENT_ROWS - 2) * (dim + 4),
        cacheRootIdentity: 'cache-root',
      })
    );
    expect(appendEmbeddingSegment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fileName: segmentFileName(cacheId, 1),
        expectedOffset: 0,
        cacheRootIdentity: 'cache-root',
      })
    );

    // Retry: the two vectors that never made it to disk are still buffered.
    appendEmbeddingSegment.mockResolvedValueOnce({ success: true });
    await index.flush();

    // Must land in segment 1 (physical rows SEGMENT_ROWS, SEGMENT_ROWS + 1),
    // not segment 0 again — which is what a stale totalRows would cause.
    expect(appendEmbeddingSegment).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        fileName: segmentFileName(cacheId, 1),
        expectedOffset: 0,
        cacheRootIdentity: 'cache-root',
      })
    );
    expect(index.stats.totalRows).toBe(SEGMENT_ROWS + 2);
  });
});
