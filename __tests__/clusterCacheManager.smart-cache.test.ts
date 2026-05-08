import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARSER_VERSION } from '../services/cacheManager';
import {
  loadClusterCache,
  saveClusterCache,
  generateDirectoryIdHash,
} from '../services/clusterCacheManager';

describe('clusterCacheManager smart library IPC', () => {
  afterEach(() => {
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
  });

  it('loads cluster cache through the internal smart library cache IPC', async () => {
    const directoryPath = 'D:/images';
    const cacheId = generateDirectoryIdHash(directoryPath, true);
    const readSmartLibraryCache = vi.fn().mockResolvedValue({
      success: true,
      data: JSON.stringify({
        id: cacheId,
        directoryPath,
        scanSubfolders: true,
        clusters: [],
        sourceSignature: 'sig',
        sourceImageCount: 0,
        processedImageCount: 0,
        lastGenerated: 123,
        parserVersion: PARSER_VERSION,
        similarityThreshold: 0.75,
      }),
    });
    const readFile = vi.fn();

    (window as any).electronAPI = {
      readSmartLibraryCache,
      writeSmartLibraryCache: vi.fn(),
      deleteSmartLibraryCache: vi.fn(),
      readFile,
    };

    const cache = await loadClusterCache(directoryPath, true, 'sig');

    expect(cache?.id).toBe(cacheId);
    expect(readSmartLibraryCache).toHaveBeenCalledWith({ cacheId, kind: 'clusters' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('saves cluster cache through the internal smart library cache IPC', async () => {
    const directoryPath = 'D:/images';
    const cacheId = generateDirectoryIdHash(directoryPath, false);
    const writeSmartLibraryCache = vi.fn().mockResolvedValue({ success: true });
    const writeFile = vi.fn();

    (window as any).electronAPI = {
      readSmartLibraryCache: vi.fn(),
      writeSmartLibraryCache,
      deleteSmartLibraryCache: vi.fn(),
      writeFile,
    };

    await saveClusterCache(directoryPath, false, [], 0.75, 'sig', 0, 0);

    expect(writeSmartLibraryCache).toHaveBeenCalledWith({
      cacheId,
      kind: 'clusters',
      data: expect.objectContaining({
        id: cacheId,
        directoryPath,
        sourceSignature: 'sig',
        parserVersion: PARSER_VERSION,
      }),
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('does not delete cluster cache when the restore signature does not match', async () => {
    const directoryPath = 'D:/images';
    const cacheId = generateDirectoryIdHash(directoryPath, true);
    const deleteSmartLibraryCache = vi.fn();

    (window as any).electronAPI = {
      readSmartLibraryCache: vi.fn().mockResolvedValue({
        success: true,
        data: JSON.stringify({
          id: cacheId,
          directoryPath,
          scanSubfolders: true,
          clusters: [],
          sourceSignature: 'complete-library',
          sourceImageCount: 0,
          processedImageCount: 0,
          lastGenerated: 123,
          parserVersion: PARSER_VERSION,
          similarityThreshold: 0.75,
        }),
      }),
      writeSmartLibraryCache: vi.fn(),
      deleteSmartLibraryCache,
    };

    const cache = await loadClusterCache(directoryPath, true, 'partial-library');

    expect(cache).toBeNull();
    expect(deleteSmartLibraryCache).not.toHaveBeenCalled();
  });
});
