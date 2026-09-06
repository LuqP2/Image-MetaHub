import { describe, expect, it } from 'vitest';
import { processFiles } from '../services/fileIndexer';
import type { IndexedImage } from '../types';

describe('fileIndexer provenance identity attachment', () => {
  it('applies queued identities to preloaded cache entries without changing their UI id', async () => {
    const originalId = 'directory-id::Cafe\u0301/image.png';
    const preloaded = {
      id: originalId,
      name: 'Cafe\u0301/image.png',
      handle: { name: 'image.png', kind: 'file' } as FileSystemFileHandle,
      metadata: {},
      metadataString: '{}',
      lastModified: 1,
      models: [],
      loras: [],
      scheduler: '',
    } as IndexedImage;
    const batches: IndexedImage[][] = [];

    const { phaseB } = await processFiles(
      [],
      () => {},
      (batch) => batches.push(batch),
      'directory-id',
      'Synthetic Library',
      true,
      () => {},
      undefined,
      undefined,
      {
        preloadedImages: [preloaded],
        provenanceIdentityForPath: (relativePath) => relativePath === 'Cafe\u0301/image.png'
          ? {
              assetId: 'asset-id',
              revisionId: 'revision-id',
              provenanceLocationId: 'location-id',
              provenanceRootId: 'root-id',
            }
          : undefined,
      },
    );
    await phaseB;

    expect(batches.flat()).toEqual([
      expect.objectContaining({
        id: originalId,
        assetId: 'asset-id',
        revisionId: 'revision-id',
        provenanceLocationId: 'location-id',
        provenanceRootId: 'root-id',
      }),
    ]);
  });
});
