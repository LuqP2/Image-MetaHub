import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClusterCacheRestore } from '../hooks/useClusterCacheRestore';
import { useImageStore } from '../store/useImageStore';
import { buildClusterSourceSignature } from '../utils/smartLibraryClusterState';

vi.mock('../hooks/useFeatureAccess', async (importOriginal) => ({
  ...await importOriginal<typeof import('../hooks/useFeatureAccess')>(),
  useFeatureAccess: () => ({ canUseFullClustering: true, initialized: true }),
}));
vi.mock('../services/clusterCacheManager', () => ({ loadClusterCache: vi.fn() }));

import { loadClusterCache } from '../services/clusterCacheManager';

const image = (id: string, lastModified = 1) => ({
  id,
  name: `${id}.png`,
  directoryId: 'dir',
  lastModified,
  prompt: `synthetic prompt ${id}`,
}) as any;

beforeEach(() => {
  useImageStore.getState().resetState();
  vi.mocked(loadClusterCache).mockReset();
});
afterEach(() => cleanup());

describe('cluster cache restore during startup', () => {
  it('reads the saved cache early and restores old clusters after a new image arrives', async () => {
    const original = [image('one'), image('two'), image('three')];
    let resolveCache!: (cache: any) => void;
    vi.mocked(loadClusterCache).mockReturnValue(new Promise((resolve) => { resolveCache = resolve; }));
    useImageStore.setState({
      directories: [{ id: 'dir', name: 'Synthetic', path: 'D:/synthetic-library' } as any],
      isLoading: true,
      indexingState: 'indexing',
    });

    renderHook(() => useClusterCacheRestore());
    expect(loadClusterCache).toHaveBeenCalledWith('D:/synthetic-library', true);

    act(() => {
      useImageStore.setState({ images: [...original, image('new', 3)], isLoading: false, indexingState: 'completed' });
    });
    await act(async () => {
      resolveCache({
        clusters: [{ id: 'saved', imageIds: original.map((entry) => entry.id), coverImageId: 'one' }],
        sourceSignature: buildClusterSourceSignature(original),
        sourceImageCount: 3,
        processedImageCount: 3,
        lastGenerated: 2,
        clusterCacheVersion: 1,
      });
    });

    await waitFor(() => expect(useImageStore.getState().clusters.map((cluster) => cluster.id)).toEqual(['saved']));
    expect(useImageStore.getState().clusterCacheLookup?.hasCache).toBe(true);
  });

  it('ends saved-cluster loading when the loaded library has no prompt images', async () => {
    vi.mocked(loadClusterCache).mockResolvedValue({
      clusters: [{ id: 'saved', imageIds: ['deleted'], coverImageId: 'deleted' }],
      sourceSignature: '1:synthetic',
      sourceImageCount: 1,
      processedImageCount: 1,
      lastGenerated: 2,
      clusterCacheVersion: 1,
    } as any);
    useImageStore.setState({
      directories: [{ id: 'dir', name: 'Synthetic', path: 'D:/synthetic-library' } as any],
      isLoading: true,
      indexingState: 'indexing',
    });

    renderHook(() => useClusterCacheRestore());
    await waitFor(() => expect(useImageStore.getState().clusterCacheLookup?.hasCache).toBe(true));
    act(() => {
      useImageStore.setState({ isLoading: false, directoryProgress: {} });
    });

    await waitFor(() => expect(useImageStore.getState().clusterCacheLookup?.hasCache).toBe(false));
    expect(useImageStore.getState().clusters).toEqual([]);
  });
});
