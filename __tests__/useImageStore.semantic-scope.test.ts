import { beforeEach, describe, expect, it } from 'vitest';
import type { Directory, IndexedImage, SemanticSearchResult } from '../types';
import { useImageStore } from '../store/useImageStore';

const directory: Directory = {
  id: 'dir-1',
  name: 'Library',
  path: 'D:/library',
  handle: {} as FileSystemDirectoryHandle,
  visible: true,
};

const image = (
  name: string,
  models: string[],
  workflowNodes: string[]
): IndexedImage => ({
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

describe('visual-search scope snapshot', () => {
  const included = image('included.png', ['scope-model'], ['KSampler']);
  const wrongNode = image('wrong-node.png', ['scope-model'], ['VAEDecode']);
  const wrongScope = image('wrong-scope.png', ['other-model'], ['KSampler']);

  beforeEach(() => {
    useImageStore.getState().resetState();
    const previousResult: SemanticSearchResult = {
      generation: 1,
      query: 'old query',
      scoreById: new Map([[wrongScope.id, 0.9]]),
    };
    useImageStore.setState({
      directories: [directory],
      images: [included, wrongNode, wrongScope],
      filteredImages: [wrongScope],
      searchQuery: 'does-not-match-any-name',
      semanticResult: previousResult,
      selectedNodes: ['KSampler'],
      activeImageScope: { type: 'model', id: 'scope-model', label: 'scope-model' },
    });
  });

  it('ignores prior text/semantic results while honoring node and active scopes', () => {
    const snapshot = useImageStore.getState().getSemanticSearchScopeSnapshot();

    expect(snapshot.images.map((candidate) => candidate.id)).toEqual([included.id]);
    expect([...snapshot.imageIds]).toEqual([included.id]);
  });

  it('returns the cached snapshot until a scope dependency changes', () => {
    const first = useImageStore.getState().getSemanticSearchScopeSnapshot();
    useImageStore.setState({ previewImage: included });
    expect(useImageStore.getState().getSemanticSearchScopeSnapshot()).toBe(first);

    useImageStore.setState({ selectedNodes: ['VAEDecode'] });
    const second = useImageStore.getState().getSemanticSearchScopeSnapshot();
    expect(second).not.toBe(first);
    expect(second.revision).not.toBe(first.revision);
    expect(second.images.map((candidate) => candidate.id)).toEqual([wrongNode.id]);
  });

  it('uses folders as the text-query universe while ignoring facet and node filters', () => {
    const nested = image('nested/dog.png', ['dog-model'], ['KSampler']);
    useImageStore.setState({
      images: [included, wrongNode, wrongScope, nested],
      filteredImages: [nested],
      selectedFolders: new Set([`${directory.path}/nested`]),
      includeSubfolders: true,
      excludedModels: [],
      selectedNodes: [],
      activeImageScope: null,
    });

    const folderScope = useImageStore.getState().getSemanticTextQueryScopeSnapshot();
    expect(folderScope.images.map((candidate) => candidate.id)).toEqual([nested.id]);

    useImageStore.setState({
      excludedModels: ['dog-model'],
      selectedNodes: ['VAEDecode'],
    });
    expect(useImageStore.getState().getSemanticTextQueryScopeSnapshot()).toBe(folderScope);

    useImageStore.setState({ selectedFolders: new Set([directory.path]) });
    const rootScope = useImageStore.getState().getSemanticTextQueryScopeSnapshot();
    expect(rootScope).not.toBe(folderScope);
    expect(rootScope.images.map((candidate) => candidate.id)).toEqual([
      included.id,
      wrongNode.id,
      wrongScope.id,
      nested.id,
    ]);
  });
});
