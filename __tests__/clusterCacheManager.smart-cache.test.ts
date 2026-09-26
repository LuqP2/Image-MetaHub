import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARSER_VERSION } from '../services/cacheManager';
import type { ImageCluster } from '../types';
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

  it('accepts a full-run cache as a compatible source after a license downgrade', async () => {
    const directoryPath = 'D:/images';
    const fullSignature = '501:full';
    (window as any).electronAPI = {
      readSmartLibraryCache: vi.fn().mockResolvedValue({
        success: true,
        data: JSON.stringify({
          clusters: [{ id: 'full-cluster' }],
          sourceSignature: fullSignature,
          sourceImageCount: 501,
          processedImageCount: 501,
          clusterCacheVersion: 1,
        }),
      }),
      writeSmartLibraryCache: vi.fn(),
      deleteSmartLibraryCache: vi.fn(),
    };

    const cache = await loadClusterCache(directoryPath, true, ['501:limited', fullSignature]);
    expect(cache?.clusters[0].id).toBe('full-cluster');
    expect(await loadClusterCache(directoryPath, true, ['501:limited'])).toBeNull();
  });

  it('restores generated clusters after restart despite an unrelated parser version change', async () => {
    const stored = new Map<string, unknown>();
    const directoryPath = 'D:/images';
    const deleteSmartLibraryCache = vi.fn();
    const clusters: ImageCluster[] = [{
      id: 'cluster-1', promptHash: 'cluster-1', basePrompt: 'prompt',
      imageIds: ['a', 'b', 'c'], coverImageId: 'a', size: 3,
      similarityThreshold: 0.75, createdAt: 1, updatedAt: 1,
    }];
    (window as any).electronAPI = {
      readSmartLibraryCache: vi.fn(async ({ cacheId, kind }: { cacheId: string; kind: string }) => ({
        success: true,
        data: JSON.stringify(stored.get(`${cacheId}:${kind}`)),
      })),
      writeSmartLibraryCache: vi.fn(async ({ cacheId, kind, data }: { cacheId: string; kind: string; data: unknown }) => {
        stored.set(`${cacheId}:${kind}`, data);
        return { success: true };
      }),
      deleteSmartLibraryCache,
    };

    await saveClusterCache(directoryPath, true, clusters, 0.75, 'same-library', 3, 3);
    const cacheId = generateDirectoryIdHash(directoryPath, true);
    stored.set(`${cacheId}:clusters`, {
      ...(stored.get(`${cacheId}:clusters`) as object),
      parserVersion: PARSER_VERSION - 1,
    });

    const restored = await loadClusterCache(directoryPath, true, 'same-library');
    expect(restored?.clusters).toEqual(clusters);
    expect(deleteSmartLibraryCache).not.toHaveBeenCalled();
  });

  it('invalidates a cluster cache with an incompatible clustering version', async () => {
    const directoryPath = 'D:/images';
    const deleteSmartLibraryCache = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = {
      readSmartLibraryCache: vi.fn().mockResolvedValue({
        success: true,
        data: JSON.stringify({
          clusters: [], sourceSignature: 'same-library',
          parserVersion: PARSER_VERSION, clusterCacheVersion: 2,
        }),
      }),
      writeSmartLibraryCache: vi.fn(),
      deleteSmartLibraryCache,
    };

    expect(await loadClusterCache(directoryPath, true, 'same-library')).toBeNull();
    expect(deleteSmartLibraryCache).toHaveBeenCalledWith({
      cacheId: generateDirectoryIdHash(directoryPath, true), kind: 'clusters',
    });
  });
});
