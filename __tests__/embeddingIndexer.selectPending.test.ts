import { afterEach, describe, it, expect, vi } from 'vitest';
import { selectPendingImages } from '../services/embeddings/embeddingIndexer';
import { contentKeyForImage } from '../services/embeddings/embeddingStore';
import { CLIP_MODEL } from '../services/embeddings/embeddingModel';
import {
  applyRelevanceCutoff,
  closeLibrary,
  getIndex,
  openLibrary,
  parseSemanticQuery,
  reconcileWithImages,
} from '../services/embeddings/semanticSearchEngine';
import type { IndexedImage } from '../types';

declare global {
  interface Window {
    electronAPI?: any;
  }
}

const image = (id: string, modified: number, fileSize = 10): IndexedImage => ({
  id,
  name: id,
  handle: {} as FileSystemFileHandle,
  metadata: {} as IndexedImage['metadata'],
  metadataString: '',
  lastModified: modified,
  contentModifiedMs: modified,
  fileSize,
  models: [],
  loras: [],
  scheduler: '',
});

describe('selectPendingImages', () => {
  it('returns images with no stored vector', () => {
    const images = [image('a', 3), image('b', 1), image('c', 2)];
    const pending = selectPendingImages(images, new Map(), null);
    expect(pending.map((i) => i.id)).toEqual(['a', 'c', 'b']); // newest first
  });

  it('skips images whose content key still matches', () => {
    const a = image('a', 3);
    const embedded = new Map([[a.id, contentKeyForImage(a)]]);
    const pending = selectPendingImages([a, image('b', 1)], embedded, null);
    expect(pending.map((i) => i.id)).toEqual(['b']);
  });

  it('re-queues an image whose content changed on disk', () => {
    const a = image('a', 3);
    // Stored under an older modified time → content key differs → stale.
    const embedded = new Map([[a.id, contentKeyForImage({ ...a, contentModifiedMs: 1 })]]);
    const pending = selectPendingImages([a], embedded, null);
    expect(pending.map((i) => i.id)).toEqual(['a']);
  });

  it('caps the pending list to the remaining free-tier capacity, newest first', () => {
    const images = [image('a', 5), image('b', 4), image('c', 3), image('d', 2)];
    const pending = selectPendingImages(images, new Map(), 2);
    expect(pending.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('returns nothing when capacity is already exhausted', () => {
    const images = [image('a', 5), image('b', 4)];
    expect(selectPendingImages(images, new Map(), 0)).toEqual([]);
    expect(selectPendingImages(images, new Map(), -3)).toEqual([]);
  });
});

describe('applyRelevanceCutoff', () => {
  const hit = (id: string, score: number) => ({ imageId: id, score });

  it('keeps only outliers well above the mean (real matches present)', () => {
    // Mimics "dog": a few high scores over a background clustered near the mean.
    const hits = [hit('a', 0.253), hit('b', 0.251), hit('c', 0.249), hit('d', 0.230), hit('e', 0.228)];
    const kept = applyRelevanceCutoff(hits, { mean: 0.225, std: 0.010 }, 2.0, 300);
    // threshold = 0.225 + 2*0.010 = 0.245 → keeps the three standouts.
    expect(kept.map((h) => h.imageId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps nothing when the best barely clears the mean (no real match)', () => {
    // Mimics "cat": top is only ~1.2σ above the mean.
    const hits = [hit('a', 0.235), hit('b', 0.231), hit('c', 0.229)];
    expect(applyRelevanceCutoff(hits, { mean: 0.223, std: 0.010 }, 2.0, 300)).toEqual([]);
  });

  it('returns nothing for a flat distribution (degenerate scores)', () => {
    const hits = [hit('a', 0.22), hit('b', 0.22), hit('c', 0.22)];
    expect(applyRelevanceCutoff(hits, { mean: 0.22, std: 0 }, 2.0, 300)).toEqual([]);
  });

  it('enforces the hard cap', () => {
    const hits = Array.from({ length: 500 }, (_, i) => hit(`i${i}`, 0.5 - i * 0.00001));
    // Every score is far above the mean, so the cap is what bounds the result.
    expect(applyRelevanceCutoff(hits, { mean: 0.2, std: 0.01 }, 2.0, 300)).toHaveLength(300);
  });

  it('handles an empty candidate list', () => {
    expect(applyRelevanceCutoff([], { mean: 0.2, std: 0.01 }, 2.0, 300)).toEqual([]);
  });

  it('does not admit a long tail just because the library is large', () => {
    // At 17.5k rows, 2σ is roughly the 98th percentile, so a z-only cutoff let
    // ~350 rows through on every query and the hard cap did the real cutting.
    // Here one row is a genuine standout and the rest sit just past 2σ.
    const hits = [
      hit('match', 0.90),
      ...Array.from({ length: 350 }, (_, i) => hit(`tail${i}`, 0.42 - i * 0.0001)),
    ];
    const kept = applyRelevanceCutoff(hits, { mean: 0.2, std: 0.1 }, 2.0, 300);
    // relative floor = 0.2 + 0.55*(0.90-0.2) = 0.585, well above the tail.
    expect(kept.map((h) => h.imageId)).toEqual(['match']);
  });

  it('keeps a whole cluster when many rows are genuinely comparable', () => {
    // The mirror case: a query with lots of real matches must not be trimmed to
    // the single best one.
    const hits = Array.from({ length: 40 }, (_, i) => hit(`m${i}`, 0.90 - i * 0.002));
    const kept = applyRelevanceCutoff(hits, { mean: 0.2, std: 0.1 }, 2.0, 300);
    expect(kept).toHaveLength(40);
  });
});

describe('parseSemanticQuery', () => {
  it('returns the whole query as positive when there are no negatives', () => {
    expect(parseSemanticQuery('a red car')).toEqual({ positive: 'a red car', negatives: [] });
  });

  it('splits a single negative', () => {
    expect(parseSemanticQuery('beach -people')).toEqual({ positive: 'beach', negatives: ['people'] });
  });

  it('splits multiple multi-word negatives', () => {
    expect(parseSemanticQuery('a city at night -cars -crowds of people')).toEqual({
      positive: 'a city at night',
      negatives: ['cars', 'crowds of people'],
    });
  });

  it('leaves hyphenated words intact', () => {
    expect(parseSemanticQuery('state-of-the-art robot')).toEqual({
      positive: 'state-of-the-art robot',
      negatives: [],
    });
  });

  it('yields an empty positive when the query is only a negative', () => {
    expect(parseSemanticQuery('-people')).toEqual({ positive: '-people', negatives: [] });
    expect(parseSemanticQuery(' -people')).toEqual({ positive: '', negatives: ['people'] });
  });
});

describe('reconcileWithImages', () => {
  afterEach(() => {
    closeLibrary();
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  const openEmptyLibrary = async () => {
    window.electronAPI = {
      readEmbeddingFile: vi.fn().mockResolvedValue({ success: true, data: null }),
      writeEmbeddingFile: vi.fn().mockResolvedValue({ success: true }),
      appendEmbeddingSegment: vi.fn().mockResolvedValue({ success: true }),
    };
    await openLibrary('test-reconcile-lib');
    const index = getIndex()!;
    index.append('present-image', 'key-0', {
      scale: 1,
      codes: new Int8Array(CLIP_MODEL.dim).fill(1),
    });
    await index.flush();
    return index;
  };

  it('does nothing for an empty present-ids set (not-yet-hydrated library, not an empty one)', async () => {
    const index = await openEmptyLibrary();
    expect(index.stats.liveRows).toBe(1);

    // An empty set must never be read as "the library has no images" — a
    // caller that hasn't finished loading yet also produces an empty set, and
    // treating it as authoritative would wipe every live vector.
    await reconcileWithImages(new Set());

    expect(index.stats.liveRows).toBe(1);
    expect(index.hasVector('present-image')).toBe(true);
  });

  it('tombstones vectors for images that are genuinely no longer present', async () => {
    const index = await openEmptyLibrary();
    expect(index.stats.liveRows).toBe(1);

    await reconcileWithImages(new Set(['some-other-image']));

    expect(index.stats.liveRows).toBe(0);
    expect(index.hasVector('present-image')).toBe(false);
  });
});
