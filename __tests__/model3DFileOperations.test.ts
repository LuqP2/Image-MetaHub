import { describe, expect, it, vi } from 'vitest';
import {
  getModel3DSidecarPathIfPresent,
  renameModel3DWithSidecar,
} from '../utils/model3DFileOperations.mjs';

const missingFileError = () => Object.assign(new Error('missing'), { code: 'ENOENT' });

describe('3D model file operations', () => {
  it('finds an existing metadata sidecar for export', async () => {
    const fsApi = {
      lstat: vi.fn().mockResolvedValue({ isFile: () => true }),
    };

    await expect(getModel3DSidecarPathIfPresent(fsApi, 'model.glb'))
      .resolves.toBe('model.glb.imagemetahub.json');
  });

  it('ignores missing metadata sidecars during export', async () => {
    const fsApi = {
      lstat: vi.fn().mockRejectedValue(missingFileError()),
    };

    await expect(getModel3DSidecarPathIfPresent(fsApi, 'model.glb')).resolves.toBeNull();
  });

  it('renames a model normally when no sidecar exists', async () => {
    const fsApi = {
      lstat: vi.fn().mockRejectedValue(missingFileError()),
      rename: vi.fn().mockResolvedValue(undefined),
    };

    await renameModel3DWithSidecar(fsApi, 'old.glb', 'new.glb');

    expect(fsApi.rename).toHaveBeenCalledTimes(1);
    expect(fsApi.rename).toHaveBeenCalledWith('old.glb', 'new.glb');
  });

  it('renames the model and its sidecar together', async () => {
    const fsApi = {
      lstat: vi.fn()
        .mockResolvedValueOnce({ dev: 1, ino: 10 })
        .mockRejectedValueOnce(missingFileError()),
      rename: vi.fn().mockResolvedValue(undefined),
    };

    await renameModel3DWithSidecar(fsApi, 'old.glb', 'new.glb');

    expect(fsApi.rename.mock.calls).toEqual([
      ['old.glb', 'new.glb'],
      ['old.glb.imagemetahub.json', 'new.glb.imagemetahub.json'],
    ]);
  });

  it('rolls the model back when the sidecar rename fails', async () => {
    const sidecarError = Object.assign(new Error('locked'), { code: 'EACCES' });
    const fsApi = {
      lstat: vi.fn()
        .mockResolvedValueOnce({ dev: 1, ino: 10 })
        .mockRejectedValueOnce(missingFileError()),
      rename: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(sidecarError)
        .mockResolvedValueOnce(undefined),
    };

    await expect(renameModel3DWithSidecar(fsApi, 'old.glb', 'new.glb'))
      .rejects.toThrow('model rename was rolled back');
    expect(fsApi.rename.mock.calls[2]).toEqual(['new.glb', 'old.glb']);
  });

  it('rejects a conflicting destination sidecar before renaming the model', async () => {
    const fsApi = {
      lstat: vi.fn()
        .mockResolvedValueOnce({ dev: 1, ino: 10 })
        .mockResolvedValueOnce({ dev: 1, ino: 11 }),
      rename: vi.fn(),
    };

    await expect(renameModel3DWithSidecar(fsApi, 'old.glb', 'new.glb'))
      .rejects.toThrow('sidecar with that name already exists');
    expect(fsApi.rename).not.toHaveBeenCalled();
  });
});
