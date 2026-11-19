import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { IndexedImage, Directory } from '../types';
import { getComparisonDirectories } from '../services/comparisonDirectories';
import useComparisonImageSource from '../hooks/useComparisonImageSource';
import { mediaSourceCache } from '../services/mediaSourceCache';

vi.mock('../hooks/useResolvedThumbnail', () => ({ useResolvedThumbnail: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.electronAPI; });

describe('comparison of external Canvas images', () => {
  it('loads an external original in Electron using the comparison-only directory', async () => {
    window.electronAPI = {} as Window['electronAPI'];
    const image = { id: 'external::reference.png', name: 'reference.png', directoryId: 'external', handle: { _filePath: '/synthetic/reference.png' } } as unknown as IndexedImage;
    const source = vi.spyOn(mediaSourceCache, 'getOrLoad').mockResolvedValue('blob:external-original');
    const directories = getComparisonDirectories([image], []);
    const { result } = renderHook(() => useComparisonImageSource(image, directories[0].path));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(source).toHaveBeenCalledWith(image, '/synthetic/');
    expect(result.current.imageUrl).toBe('blob:external-original');
    expect(result.current.loadError).toBeNull();
  });
  it('keeps the library root authoritative and does not invent directories for missing handles', () => {
    const image = { directoryId: 'library', handle: { _filePath: '/library/subfolder/reference.png' } } as unknown as IndexedImage;
    const root = { id: 'library', name: 'Library', path: '/library', handle: {} } as Directory;
    expect(getComparisonDirectories([image], [root])).toEqual([{ id: 'library', name: 'Library', path: '/library' }]);
    expect(getComparisonDirectories([{ directoryId: 'unavailable' } as IndexedImage], [])).toEqual([]);
  });
});
