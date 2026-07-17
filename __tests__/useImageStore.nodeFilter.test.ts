import { beforeEach, describe, expect, it } from 'vitest';
import type { IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { filterImagesByWorkflowNodes } from '../services/comfyUIWorkflowNodes';

const createImage = (name: string, workflowNodes: string[]): IndexedImage => ({
  id: `dir-1::${name}`,
  name,
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
  workflowNodes,
});

const ksampler = createImage('a.png', ['KSampler']);
const vae = createImage('b.png', ['VAEDecode']);
const both = createImage('c.png', ['KSampler', 'VAEDecode']);
const none = createImage('d.png', []);
const images = [ksampler, vae, both, none];

describe('useImageStore selectedNodes', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    useImageStore.setState({ images, filteredImages: images });
  });

  it('defaults to an empty node selection', () => {
    expect(useImageStore.getState().selectedNodes).toEqual([]);
  });

  it('setSelectedNodes stores the selection without touching filteredImages', () => {
    useImageStore.getState().setSelectedNodes(['KSampler']);
    expect(useImageStore.getState().selectedNodes).toEqual(['KSampler']);
    // Node filtering is a post-filter, so the core filteredImages list is unchanged.
    expect(useImageStore.getState().filteredImages).toHaveLength(4);
  });

  it('applies OR semantics across selected nodes (case-insensitive)', () => {
    const selected = ['ksampler', 'vaedecode'];
    const result = filterImagesByWorkflowNodes(images, selected).map((image) => image.id);
    expect(result).toEqual([ksampler.id, vae.id, both.id]);
  });

  it('with no selection keeps only images that have workflow nodes', () => {
    const result = filterImagesByWorkflowNodes(images, []).map((image) => image.id);
    expect(result).toEqual([ksampler.id, vae.id, both.id]);
  });
});
