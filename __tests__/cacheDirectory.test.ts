import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openAuthorizedCacheDirectory } from '../electron/cacheDirectory.mjs';

describe('authorized cache directory opener', () => {
  it.each([
    'C:\\Users\\Test\\AppData\\Roaming\\image-metahub',
    'D:\\Image MetaHub Cache',
  ])('opens the internally resolved default or custom directory: %s', async (cacheRoot) => {
    const fsApi = { stat: vi.fn().mockResolvedValue({ isDirectory: () => true }) };
    const shellApi = { openPath: vi.fn().mockResolvedValue('') };

    await expect(openAuthorizedCacheDirectory({
      getCacheRootPath: async () => cacheRoot,
      fsApi,
      shellApi,
    })).resolves.toBe(path.normalize(cacheRoot));

    expect(fsApi.stat).toHaveBeenCalledWith(path.normalize(cacheRoot));
    expect(shellApi.openPath).toHaveBeenCalledWith(path.normalize(cacheRoot));
  });

  it('rejects files without asking the shell to open them', async () => {
    const shellApi = { openPath: vi.fn() };

    await expect(openAuthorizedCacheDirectory({
      getCacheRootPath: async () => 'C:\\Temp\\payload.exe',
      fsApi: { stat: vi.fn().mockResolvedValue({ isDirectory: () => false }) },
      shellApi,
    })).rejects.toThrow('Configured cache path is not a directory.');

    expect(shellApi.openPath).not.toHaveBeenCalled();
  });

  it('propagates missing-directory and shell errors', async () => {
    await expect(openAuthorizedCacheDirectory({
      getCacheRootPath: async () => 'C:\\Missing',
      fsApi: { stat: vi.fn().mockRejectedValue(new Error('not found')) },
      shellApi: { openPath: vi.fn() },
    })).rejects.toThrow('not found');

    await expect(openAuthorizedCacheDirectory({
      getCacheRootPath: async () => 'C:\\Cache',
      fsApi: { stat: vi.fn().mockResolvedValue({ isDirectory: () => true }) },
      shellApi: { openPath: vi.fn().mockResolvedValue('Access denied') },
    })).rejects.toThrow('Access denied');
  });
});
