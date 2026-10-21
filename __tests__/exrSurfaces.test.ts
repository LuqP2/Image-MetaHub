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
  it('regenerates an evicted preview on back-navigation past the native cache limit', async () => {
    const active = new Set<string>();
    let regenerated = 0;
    nativePreview.mockImplementation(async ({ filePath }: { filePath: string }) => {
      if (!active.has(filePath)) regenerated++;
      active.delete(filePath); active.add(filePath);
      if (active.size > 24) active.delete(active.values().next().value!);
      return { success: true, value: { url: `imh-exr://local/${encodeURIComponent(filePath)}`, width: 64, height: 64 } };
    });
    const { mediaSourceCache } = await import('../services/mediaSourceCache');
    const images = Array.from({ length: 30 }, (_, i) => ({ ...image, id: `renders::frame-${i}.exr`, name: `frame-${i}.exr`, handle: { _filePath: `D:\\renders\\frame-${i}.exr` } }) as IndexedImage);
    for (const item of images) await mediaSourceCache.getOrLoad(item);
    expect(active.has('D:\\renders\\frame-0.exr')).toBe(false);
    expect(mediaSourceCache.peek(images[0])).toBeNull();
    await mediaSourceCache.getOrLoad(images[0]);
    expect(active.has('D:\\renders\\frame-0.exr')).toBe(true);
    expect(regenerated).toBe(31);
    expect(originalRead).not.toHaveBeenCalled();
  });
  it('still shares concurrent EXR requests without retaining completed preview URLs', async () => {
    let finish!: (value: unknown) => void;
    nativePreview.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { mediaSourceCache } = await import('../services/mediaSourceCache');
    const first = mediaSourceCache.getOrLoad(image);
    const second = mediaSourceCache.getOrLoad(image);
    await vi.waitFor(() => expect(nativePreview).toHaveBeenCalledTimes(1));
    finish({ success: true, value: { url: 'imh-exr://local/shared', width: 64, height: 64 } });
    expect(await Promise.all([first, second])).toEqual(['imh-exr://local/shared', 'imh-exr://local/shared']);
    expect(mediaSourceCache.peek(image)).toBeNull();
  });
  it('retains conventional media URLs in the existing renderer cache', async () => {
    const resolveUrl = vi.fn(async () => ({ success: true, url: 'imh-media://local/synthetic' }));
    window.electronAPI!.resolveMediaUrl = resolveUrl;
    const png = { ...image, id: 'renders::frame.png', name: 'frame.png', handle: { _filePath: 'D:\\renders\\frame.png' } } as IndexedImage;
    const { mediaSourceCache } = await import('../services/mediaSourceCache');
    await mediaSourceCache.getOrLoad(png);
    expect(mediaSourceCache.peek(png)).toBe('imh-media://local/synthetic');
    await mediaSourceCache.getOrLoad(png);
    expect(resolveUrl).toHaveBeenCalledTimes(1);
    expect(nativePreview).not.toHaveBeenCalled(); expect(originalRead).not.toHaveBeenCalled();
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
