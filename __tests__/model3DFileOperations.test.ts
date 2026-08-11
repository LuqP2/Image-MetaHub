import { describe, expect, it, vi } from 'vitest';
import {
  getModel3DSidecarPathIfPresent,
  renameModel3DWithSidecar,
  trashModel3DWithSidecar,
  transferModel3DWithSidecar,
  writeModel3DExportDataWithSidecar,
  writeModel3DExportWithSidecar,
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

  it('trashes a model sidecar with its model', async () => {
    const fsApi = {
      lstat: vi.fn().mockResolvedValue({ isFile: () => true }),
      unlink: vi.fn(),
    };
    const trashItem = vi.fn().mockResolvedValue(undefined);

    await trashModel3DWithSidecar(fsApi, trashItem, 'model.glb');

    expect(trashItem.mock.calls).toEqual([
      ['model.glb'],
      ['model.glb.imagemetahub.json'],
    ]);
  });

  it('reports and removes an orphaned sidecar when trashing it fails', async () => {
    const fsApi = {
      lstat: vi.fn().mockResolvedValue({ isFile: () => true }),
      unlink: vi.fn().mockResolvedValue(undefined),
    };
    const trashItem = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('trash failed'));

    await expect(trashModel3DWithSidecar(fsApi, trashItem, 'model.glb'))
      .rejects.toThrow('permanently removed');
    expect(fsApi.unlink).toHaveBeenCalledWith('model.glb.imagemetahub.json');
  });

  it('removes incomplete model exports when sidecar copying fails', async () => {
    const sidecarError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    const fsApi = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockRejectedValue(sidecarError),
      unlink: vi.fn().mockResolvedValue(undefined),
    };

    await expect(writeModel3DExportWithSidecar(
      fsApi,
      'export/model.stl',
      new Uint8Array([1, 2, 3]),
      'source/model.stl.imagemetahub.json',
    )).rejects.toThrow('incomplete output was removed');
    expect(fsApi.unlink.mock.calls).toEqual([
      ['export/model.stl.imagemetahub.json'],
      ['export/model.stl'],
    ]);
  });

  it('removes viewer model exports when writing sidecar data fails', async () => {
    const fsApi = {
      writeFile: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('sidecar locked')),
      unlink: vi.fn().mockResolvedValue(undefined),
    };

    await expect(writeModel3DExportDataWithSidecar(
      fsApi,
      'export/model.obj',
      new Uint8Array([1]),
      new Uint8Array([2]),
    )).rejects.toThrow('incomplete output was removed');
    expect(fsApi.unlink.mock.calls).toEqual([
      ['export/model.obj.imagemetahub.json'],
      ['export/model.obj'],
    ]);
  });

  it('rejects orphaned destination sidecars for sidecarless transfers', async () => {
    const fsApi = {
      lstat: vi.fn()
        .mockRejectedValueOnce(missingFileError())
        .mockResolvedValueOnce({ isFile: () => true }),
      copyFile: vi.fn(),
    };

    await expect(transferModel3DWithSidecar(fsApi, 'old.glb', 'new.glb', 'copy'))
      .rejects.toThrow('sidecar already exists at the destination');
    expect(fsApi.copyFile).not.toHaveBeenCalled();
  });

  it('rejects orphaned destination sidecars for sidecarless renames', async () => {
    const fsApi = {
      lstat: vi.fn()
        .mockRejectedValueOnce(missingFileError())
        .mockResolvedValueOnce({ isFile: () => true }),
      rename: vi.fn(),
    };

    await expect(renameModel3DWithSidecar(fsApi, 'old.glb', 'new.glb'))
      .rejects.toThrow('sidecar with that name already exists');
    expect(fsApi.rename).not.toHaveBeenCalled();
  });

  it('copies a model and its metadata sidecar together', async () => {
    const fsApi = {
      lstat: vi.fn()
        .mockResolvedValueOnce({ isFile: () => true })
        .mockRejectedValueOnce(missingFileError()),
      copyFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn(),
    };

    await transferModel3DWithSidecar(fsApi, 'old.glb', 'new.glb', 'copy');

    expect(fsApi.copyFile.mock.calls).toEqual([
      ['old.glb', 'new.glb'],
      ['old.glb.imagemetahub.json', 'new.glb.imagemetahub.json'],
    ]);
  });

  it('removes a copied model when its sidecar transfer fails', async () => {
    const sidecarError = Object.assign(new Error('locked'), { code: 'EACCES' });
    const fsApi = {
      lstat: vi.fn()
        .mockResolvedValueOnce({ isFile: () => true })
        .mockRejectedValueOnce(missingFileError()),
      copyFile: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(sidecarError),
      unlink: vi.fn()
        .mockRejectedValueOnce(missingFileError())
        .mockResolvedValueOnce(undefined),
    };

    await expect(transferModel3DWithSidecar(fsApi, 'old.glb', 'new.glb', 'copy'))
      .rejects.toThrow('model transfer was rolled back');
    expect(fsApi.unlink).toHaveBeenLastCalledWith('new.glb');
  });

  it('moves a model back when its sidecar transfer fails', async () => {
    const sidecarError = Object.assign(new Error('locked'), { code: 'EACCES' });
    const fsApi = {
      lstat: vi.fn()
        .mockResolvedValueOnce({ isFile: () => true })
        .mockRejectedValueOnce(missingFileError()),
      rename: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(sidecarError)
        .mockResolvedValueOnce(undefined),
      copyFile: vi.fn(),
      unlink: vi.fn().mockRejectedValue(missingFileError()),
    };

    await expect(transferModel3DWithSidecar(fsApi, 'old.glb', 'new.glb', 'move'))
      .rejects.toThrow('model transfer was rolled back');
    expect(fsApi.rename.mock.calls[2]).toEqual(['new.glb', 'old.glb']);
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
