import { describe, expect, it } from 'vitest';
import { type BaseMetadata, type Directory, type IndexedImage } from '../types';
import {
  buildLineageLibrarySignature,
  buildLineageRegistrySnapshot,
  createLineageDirectoryPathMap,
  toLightweightLineageImage,
} from '../services/lineageRegistry';

const directories: Directory[] = [
  {
    id: 'dir-a',
    name: 'Library A',
    path: 'D:\\images\\library-a',
    handle: {} as FileSystemDirectoryHandle,
  },
  {
    id: 'dir-b',
    name: 'Library B',
    path: 'D:\\images\\library-b',
    handle: {} as FileSystemDirectoryHandle,
  },
];

const createImage = (
  id: string,
  name: string,
  directoryId: string,
  metadata?: Partial<BaseMetadata>
): IndexedImage => ({
  id,
  name,
  handle: {
    _filePath: `${directories.find((directory) => directory.id === directoryId)!.path}\\${name}`,
  } as FileSystemFileHandle,
  thumbnailStatus: 'pending',
  metadata: metadata ? { normalizedMetadata: metadata as BaseMetadata } as any : {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  directoryId,
  dimensions: metadata?.width && metadata?.height ? `${metadata.width}x${metadata.height}` : undefined,
});

describe('lineage registry', () => {
  it('builds resolved lineage and derived image mappings without scanning in the consumer', () => {
    const source = createImage(
      'dir-a::base.png',
      'base.png',
      'dir-a',
      { width: 1024, height: 1024, prompt: 'base', model: 'm', steps: 20, scheduler: 'normal' }
    );
    const derived = createImage(
      'dir-b::derived.png',
      'derived.png',
      'dir-b',
      {
        width: 1024,
        height: 1024,
        prompt: 'derived',
        model: 'm',
        steps: 20,
        scheduler: 'normal',
        generationType: 'img2img',
        lineage: {
          denoiseStrength: 0.4,
          sourceImage: {
            fileName: 'base.png',
            width: 1024,
            height: 1024,
          },
        },
      }
    );

    const pathMap = createLineageDirectoryPathMap(directories);
    const snapshot = buildLineageRegistrySnapshot(
      [source, derived].map((image) => toLightweightLineageImage(image, pathMap)),
      'signature-1'
    );

    expect(snapshot.resolvedByImageId[derived.id]).toMatchObject({
      generationType: 'img2img',
      sourceStatus: 'linked',
      sourceImageId: source.id,
    });
    expect(snapshot.derivedIdsBySourceId[source.id]).toEqual([derived.id]);
  });

  it('keeps ambiguous matches ambiguous until dimensions disambiguate them', () => {
    const sourceA = createImage(
      'dir-a::base.png',
      'base.png',
      'dir-a',
      { width: 1024, height: 1024, prompt: 'base', model: 'm', steps: 20, scheduler: 'normal' }
    );
    const sourceB = createImage(
      'dir-b::base.png',
      'base.png',
      'dir-b',
      { width: 768, height: 768, prompt: 'base', model: 'm', steps: 20, scheduler: 'normal' }
    );
    const derived = createImage(
      'dir-b::derived.png',
      'derived.png',
      'dir-b',
      {
        width: 768,
        height: 768,
        prompt: 'derived',
        model: 'm',
        steps: 20,
        scheduler: 'normal',
        generationType: 'img2img',
        lineage: {
          sourceImage: {
            fileName: 'base.png',
            width: 768,
            height: 768,
          },
        },
      }
    );

    const pathMap = createLineageDirectoryPathMap(directories);
    const snapshot = buildLineageRegistrySnapshot(
      [sourceA, sourceB, derived].map((image) => toLightweightLineageImage(image, pathMap)),
      'signature-2'
    );

    expect(snapshot.resolvedByImageId[derived.id]?.sourceStatus).toBe('linked');
    expect(snapshot.resolvedByImageId[derived.id]?.sourceImageId).toBe(sourceB.id);
  });

  it('builds a deterministic library signature from cache summaries', () => {
    const signatureA = buildLineageLibrarySignature([
      {
        directoryId: 'dir-b',
        path: 'D:\\images\\library-b',
        lastScan: 20,
        imageCount: 5,
        parserVersion: 5,
      },
      {
        directoryId: 'dir-a',
        path: 'D:\\images\\library-a',
        lastScan: 10,
        imageCount: 10,
        parserVersion: 5,
      },
    ], true);

    const signatureB = buildLineageLibrarySignature([
      {
        directoryId: 'dir-a',
        path: 'D:\\images\\library-a',
        lastScan: 10,
        imageCount: 10,
        parserVersion: 5,
      },
      {
        directoryId: 'dir-b',
        path: 'D:\\images\\library-b',
        lastScan: 20,
        imageCount: 5,
        parserVersion: 5,
      },
    ], true);

    expect(signatureA).toBe(signatureB);
  });
});
