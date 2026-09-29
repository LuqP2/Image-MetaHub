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

const image = (id: string) => ({
  id,
  name: `${id}.png`,
  directoryId: 'dir',
  lastModified: 1,
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
      useImageStore.setState({ images: [...original, image('new')], isLoading: false, indexingState: 'completed' });
    });
    await act(async () => {
      resolveCache({
        clusters: [{ id: 'saved', imageIds: original.map((entry) => entry.id), coverImageId: 'one' }],
        sourceSignature: buildClusterSourceSignature(original),
        sourceImageCount: 3,
        processedImageCount: 3,
        clusterCacheVersion: 1,
      });
    });

    await waitFor(() => expect(useImageStore.getState().clusters.map((cluster) => cluster.id)).toEqual(['saved']));
    expect(useImageStore.getState().clusterCacheLookup?.hasCache).toBe(true);
  });
});
