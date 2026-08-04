import { describe, it, expect } from 'vitest';
import { selectPendingImages } from '../services/embeddings/embeddingIndexer';
import { contentKeyForImage } from '../services/embeddings/embeddingStore';
import type { IndexedImage } from '../types';

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
