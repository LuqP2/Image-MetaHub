import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexedImage } from '../types';

const originalRead = vi.fn(() => { throw new Error('Original EXR bytes must stay outside the renderer'); });
const nativePreview = vi.fn();
const conventionalThumbnail = vi.fn();
const image = { id: 'renders::frame.exr', name: 'frame.exr', lastModified: 123, contentModifiedMs: 123, fileSize: 100, handle: { _filePath: 'D:\\renders\\frame.exr', getFile: originalRead }, metadata: {}, models: [], loras: [], scheduler: '' } as unknown as IndexedImage;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    readFile: originalRead, resolveMediaUrl: originalRead, generateThumbnailToCache: conventionalThumbnail,
    exr: { preview: nativePreview, onChanged: vi.fn(() => () => {}), cancel: vi.fn() },
  } });
});
describe('EXR source boundaries', () => {
  it('loads a managed preview instead of constructing an original URL', async () => {
    nativePreview.mockResolvedValue({ success: true, value: { url: 'imh-exr://local/synthetic', width: 64, height: 64 } });
    const { mediaSourceCache } = await import('../services/mediaSourceCache');
    expect(await mediaSourceCache.getOrLoad(image)).toBe('imh-exr://local/synthetic');
    expect(nativePreview).toHaveBeenCalledTimes(1); expect(originalRead).not.toHaveBeenCalled();
  });
  it('never exposes a display preview as an editable original', async () => {
    const { mediaSourceCache } = await import('../services/mediaSourceCache');
    await expect(mediaSourceCache.getRendererOwnedObjectUrl(image)).rejects.toThrow('not available for image editing');
    expect(originalRead).not.toHaveBeenCalled(); expect(nativePreview).not.toHaveBeenCalled();
  });
  it('does not fall back to nativeImage, getFile, or automatic retries when support is missing', async () => {
    nativePreview.mockResolvedValue({ success: false, error: 'EXR support not installed or disabled' });
    const { thumbnailManager } = await import('../services/thumbnailManager');
    await thumbnailManager.ensureThumbnail(image);
    await thumbnailManager.ensureThumbnail(image);
    expect(thumbnailManager.getResolvedState(image)).toMatchObject({ thumbnailStatus: 'error', thumbnailUrl: null });
    expect(nativePreview).toHaveBeenCalledTimes(1); expect(originalRead).not.toHaveBeenCalled(); expect(conventionalThumbnail).not.toHaveBeenCalled();
    await thumbnailManager.ensureThumbnail({ ...image, contentModifiedMs: 124 });
    expect(nativePreview).toHaveBeenCalledTimes(2);
  });
});
