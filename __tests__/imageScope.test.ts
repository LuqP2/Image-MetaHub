import { describe, expect, it } from 'vitest';
import type { IndexedImage, ImageCluster, SmartCollection } from '../types';
import {
  resolveScopeImageIds,
  filterImagesByScope,
  getScopeToastMessage,
} from '../utils/imageScope';

const createImage = (name: string, models: string[] = []): IndexedImage => ({
  id: `dir-1::${name}`,
  name,
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models,
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
});

const alpha = createImage('alpha.png', ['sdxl']);
const beta = createImage('beta.png', ['sdxl']);
const gamma = createImage('gamma.png', ['flux']);
const images = [alpha, beta, gamma];

const cluster: ImageCluster = {
  id: 'cluster-1',
  promptHash: 'hash',
  basePrompt: 'a prompt',
  imageIds: [alpha.id, gamma.id],
  coverImageId: alpha.id,
  size: 2,
  similarityThreshold: 0.85,
  createdAt: 0,
  updatedAt: 0,
};

const collection: SmartCollection = {
  id: 'collection-1',
  kind: 'manual',
  name: 'My Collection',
  sortIndex: 0,
  imageIds: [beta.id],
  imageCount: 1,
  createdAt: 0,
  updatedAt: 0,
};

const sources = { images, clusters: [cluster], collections: [collection] };

describe('resolveScopeImageIds', () => {
  it('returns null when there is no scope', () => {
    expect(resolveScopeImageIds(null, sources)).toBeNull();
  });

  it('resolves a model scope by checkpoint membership', () => {
    const resolved = resolveScopeImageIds({ type: 'model', id: 'sdxl', label: 'sdxl' }, sources);
    expect(resolved?.valid).toBe(true);
    expect([...(resolved?.ids ?? [])].sort()).toEqual([alpha.id, beta.id].sort());
  });

  it('marks a model scope invalid when no image references it', () => {
    const resolved = resolveScopeImageIds({ type: 'model', id: 'ghost', label: 'ghost' }, sources);
    expect(resolved?.valid).toBe(false);
    expect(resolved?.ids.size).toBe(0);
  });

  it('resolves a cluster scope from cluster.imageIds', () => {
    const resolved = resolveScopeImageIds({ type: 'cluster', id: 'cluster-1', label: 'c' }, sources);
    expect(resolved?.valid).toBe(true);
    expect([...(resolved?.ids ?? [])].sort()).toEqual([alpha.id, gamma.id].sort());
  });

  it('marks a cluster scope invalid when the cluster is gone (regenerated)', () => {
    const resolved = resolveScopeImageIds({ type: 'cluster', id: 'missing', label: 'c' }, sources);
    expect(resolved?.valid).toBe(false);
  });

  it('marks a collection scope invalid when the collection is deleted', () => {
    const resolved = resolveScopeImageIds({ type: 'collection', id: 'missing', label: 'c' }, sources);
    expect(resolved?.valid).toBe(false);
  });
});

describe('filterImagesByScope', () => {
  it('passes through when no scope is resolved', () => {
    expect(filterImagesByScope(images, null)).toEqual(images);
  });

  it('intersects the image list with the resolved ids', () => {
    const resolved = resolveScopeImageIds({ type: 'model', id: 'sdxl', label: 'sdxl' }, sources);
    expect(filterImagesByScope(images, resolved).map((image) => image.id)).toEqual([alpha.id, beta.id]);
  });
});

describe('getScopeToastMessage', () => {
  it('uses a cluster-specific message for regenerated clusters', () => {
    expect(getScopeToastMessage({ type: 'cluster', id: 'c', label: 'c' })).toBe(
      'Scope removed: clusters were regenerated',
    );
  });

  it('uses distinct messages per scope type', () => {
    expect(getScopeToastMessage({ type: 'collection', id: 'c', label: 'c' })).toContain('collection');
    expect(getScopeToastMessage({ type: 'model', id: 'm', label: 'm' })).toContain('model');
  });
});
