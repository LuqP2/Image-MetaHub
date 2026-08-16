import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IndexedImage } from '../types';

const image = (id: string, name: string): IndexedImage => ({
  id,
  name,
  directoryId: 'C:\\Library',
  handle: {} as FileSystemFileHandle,
  metadata: {} as IndexedImage['metadata'],
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
});

const loadFileOperations = async (electronAPI: Record<string, unknown>) => {
  vi.resetModules();
  window.electronAPI = electronAPI as any;
  return (await import('../services/fileOperations')).FileOperations;
};

describe('FileOperations permanent-delete fallback', () => {
  afterEach(() => {
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  it('groups failed trash operations into one explicitly confirmed batch', async () => {
    const confirmPermanentDelete = vi.fn().mockResolvedValue({
      success: true,
      cancelled: false,
      deletedTokens: ['token-a', 'token-b'],
      failedTokens: [],
    });
    const FileOperations = await loadFileOperations({
      joinPaths: vi.fn(async (_directory, name) => ({ success: true, path: `C:\\Library\\${name}` })),
      trashFile: vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'trash disabled', permanentDeleteToken: 'token-a' })
        .mockResolvedValueOnce({ success: false, error: 'trash disabled', permanentDeleteToken: 'token-b' }),
      confirmPermanentDelete,
    });

    const results = await FileOperations.deleteFiles([
      image('a', 'a.png'),
      image('b', 'b.png'),
    ]);

    expect(confirmPermanentDelete).toHaveBeenCalledWith({ tokens: ['token-a', 'token-b'] });
    expect(results).toEqual([{ success: true }, { success: true }]);
  });

  it('preserves the file when permanent deletion is cancelled', async () => {
    const FileOperations = await loadFileOperations({
      joinPaths: vi.fn().mockResolvedValue({ success: true, path: 'C:\\Library\\a.png' }),
      trashFile: vi.fn().mockResolvedValue({
        success: false,
        error: 'permission denied',
        permanentDeleteToken: 'token-a',
      }),
      confirmPermanentDelete: vi.fn().mockResolvedValue({
        success: false,
        cancelled: true,
        deletedTokens: [],
        failedTokens: [],
      }),
    });

    const [result] = await FileOperations.deleteFiles([image('a', 'a.png')]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
    expect(result.error).toContain('preserved');
  });

  it('does not offer permanent deletion without a main-process failure grant', async () => {
    const confirmPermanentDelete = vi.fn();
    const FileOperations = await loadFileOperations({
      joinPaths: vi.fn().mockResolvedValue({ success: true, path: 'C:\\Library\\a.png' }),
      trashFile: vi.fn().mockResolvedValue({ success: false, error: 'Access denied' }),
      confirmPermanentDelete,
    });

    const [result] = await FileOperations.deleteFiles([image('a', 'a.png')]);

    expect(result).toEqual({ success: false, error: 'Access denied' });
    expect(confirmPermanentDelete).not.toHaveBeenCalled();
  });

  it('removes a stale library item when the primary file was deleted but its sidecar failed', async () => {
    const FileOperations = await loadFileOperations({
      joinPaths: vi.fn().mockResolvedValue({ success: true, path: 'C:\\Library\\model.glb' }),
      trashFile: vi.fn().mockResolvedValue({
        success: false,
        error: 'trash disabled',
        permanentDeleteToken: 'token-model',
      }),
      confirmPermanentDelete: vi.fn().mockResolvedValue({
        success: true,
        cancelled: false,
        deletedTokens: ['token-model'],
        failedTokens: [],
        error: 'model.glb.imagemetahub.json: sidecar locked',
      }),
    });

    await expect(FileOperations.deleteFiles([image('model', 'model.glb')]))
      .resolves.toEqual([{ success: true }]);
  });
});
