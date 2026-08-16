import { describe, expect, it, vi } from 'vitest';
import {
  createPermanentDeleteGrantStore,
  permanentlyDeleteGrantedFiles,
  requestPermanentDeleteConfirmation,
} from '../electron/permanentDeletePolicy.mjs';

describe('permanent delete policy', () => {
  it('binds temporary grants to the renderer and exact failed paths', () => {
    let now = 100;
    const store = createPermanentDeleteGrantStore({
      now: () => now,
      ttlMs: 50,
      createToken: () => 'token-a',
    });
    const targetFiles = [
      { path: 'image.png', dev: 1, ino: 2 },
      { path: 'image.png.imagemetahub.json', dev: 1, ino: 3 },
    ];
    const token = store.issue(7, 'image.png', targetFiles);

    expect(store.inspect([token], 7)[0].targetFiles).toEqual(targetFiles);
    expect(() => store.inspect([token], 8)).toThrow('invalid or expired');
    now = 151;
    expect(() => store.inspect([token], 7)).toThrow('invalid or expired');
  });

  it('requires both the permanent-delete choice and a second confirmation', async () => {
    const cancelOffer = vi.fn().mockResolvedValue({ response: 1 });
    await expect(requestPermanentDeleteConfirmation(cancelOffer, {
      itemCount: 3,
      fileCount: 3,
      scopeLabel: '3 selected items (3 files)',
    })).resolves.toBe(false);
    expect(cancelOffer).toHaveBeenCalledTimes(1);

    const cancelConfirmation = vi.fn()
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 1 });
    await expect(requestPermanentDeleteConfirmation(cancelConfirmation, {
      itemCount: 3,
      fileCount: 3,
      scopeLabel: '3 selected items (3 files)',
    })).resolves.toBe(false);
    expect(cancelConfirmation).toHaveBeenCalledTimes(2);

    const confirmTwice = vi.fn().mockResolvedValue({ response: 0 });
    await expect(requestPermanentDeleteConfirmation(confirmTwice, {
      itemCount: 1,
      fileCount: 2,
      scopeLabel: 'model.glb',
    })).resolves.toBe(true);
    expect(confirmTwice).toHaveBeenCalledTimes(2);
    expect(confirmTwice.mock.calls[0][0].buttons).toEqual(['Delete permanently', 'Cancel']);
    expect(confirmTwice.mock.calls[1][0].buttons).toEqual(['Confirm permanent deletion', 'Cancel']);
    expect(confirmTwice.mock.calls[1][0].detail).toContain('2 files');
  });

  it('reports the primary model as deleted when its sidecar deletion fails', async () => {
    const sidecarError = Object.assign(new Error('sidecar locked'), { code: 'EACCES' });
    const fsApi = {
      lstat: vi.fn()
        .mockResolvedValueOnce({ dev: 1, ino: 2 })
        .mockResolvedValueOnce({ dev: 1, ino: 3 }),
      unlink: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(sidecarError),
    };

    await expect(permanentlyDeleteGrantedFiles(fsApi, {
      requestedPath: 'model.glb',
      primaryDeleted: false,
      targetFiles: [
        { path: 'model.glb', dev: 1, ino: 2 },
        { path: 'model.glb.imagemetahub.json', dev: 1, ino: 3 },
      ],
    })).resolves.toEqual({
      primaryDeleted: true,
      failures: [{ path: 'model.glb.imagemetahub.json', error: sidecarError }],
    });
  });
});
