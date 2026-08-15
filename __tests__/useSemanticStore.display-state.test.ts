import { beforeEach, describe, expect, it } from 'vitest';
import type { Directory, IndexedImage, SemanticSearchResult } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSemanticStore } from '../store/useSemanticStore';

const directory: Directory = {
  id: 'dir-1',
  name: 'Library',
  path: 'D:/library',
  handle: {} as FileSystemDirectoryHandle,
  visible: true,
};

const image = (name: string, workflowNodes: string[], models: string[] = []): IndexedImage => ({
  id: `dir-1::${name}`,
  name,
  handle: {} as FileSystemFileHandle,
  metadata: {} as IndexedImage['metadata'],
  metadataString: '',
  lastModified: 1,
  models,
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
  workflowNodes,
});

describe('semantic display state', () => {
  const source = image('source.png', ['KSampler']);
  const neighbor = image('neighbor.png', ['KSampler']);
  const hiddenByNode = image('hidden.png', ['VAEDecode']);

  beforeEach(() => {
    useSemanticStore.getState().clearQuery();
    useImageStore.getState().resetState();
    useImageStore.setState({
      directories: [directory],
      images: [source, neighbor, hiddenByNode],
      filteredImages: [source, neighbor, hiddenByNode],
      selectedNodes: [],
    });
    useSemanticStore.setState({
      queryActive: true,
      queryRunning: false,
      queryNotice: 'ok',
      queryResultCount: 0,
      queryTopScore: null,
      similarSourceName: source.name,
    });
  });

  it('tracks the actual node-filtered grid and excludes a pinned similar source', () => {
    const result: SemanticSearchResult = {
      generation: 1,
      query: 'similar',
      scoreById: new Map([
        [source.id, Number.POSITIVE_INFINITY],
        [neighbor.id, 0.93],
        [hiddenByNode.id, 0.91],
      ]),
    };

    useImageStore.getState().applySemanticResult(result);
    expect(useSemanticStore.getState().queryResultCount).toBe(2);
    expect(useSemanticStore.getState().queryTopScore).toBe(0.93);

    useImageStore.getState().setSelectedNodes(['KSampler']);
    expect(useSemanticStore.getState().queryResultCount).toBe(1);
    expect(useSemanticStore.getState().queryTopScore).toBe(0.93);
  });

  it('lets grid filters subtract accepted text hits without promoting rejected images', () => {
    const dogA = image('dog-a.png', ['KSampler'], ['dog-checkpoint']);
    const dogB = image('dog-b.png', ['KSampler'], ['dog-checkpoint']);
    const rejectedTv = image('tv.png', ['KSampler'], ['other-checkpoint']);
    useImageStore.setState({
      images: [dogA, dogB, rejectedTv],
      filteredImages: [dogA, dogB, rejectedTv],
      excludedModels: [],
    });

    useImageStore.getState().applySemanticResult({
      generation: 2,
      query: 'black dog',
      // The TV was rejected by the global query, so filtering dogs must never
      // make it eligible merely because it is now the best remaining image.
      scoreById: new Map([
        [dogA.id, 0.063],
        [dogB.id, 0.055],
      ]),
    });
    expect(useImageStore.getState().filteredImages.map((candidate) => candidate.id)).toEqual([
      dogA.id,
      dogB.id,
    ]);

    useImageStore.getState().setSelectedFilters({ excludedModels: ['dog-checkpoint'] });
    expect(useImageStore.getState().filteredImages).toEqual([]);
    expect(useSemanticStore.getState().queryResultCount).toBe(0);
    expect(useSemanticStore.getState().queryNotice).toBe('no-results');

    useImageStore.getState().setSelectedFilters({ excludedModels: [] });
    expect(useImageStore.getState().filteredImages.map((candidate) => candidate.id)).toEqual([
      dogA.id,
      dogB.id,
    ]);
    expect(useSemanticStore.getState().queryResultCount).toBe(2);
    expect(useSemanticStore.getState().queryTopScore).toBe(0.063);
  });
});
