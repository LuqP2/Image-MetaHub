import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageModal from '../components/ImageModal';
import { mediaDecodeCache } from '../services/mediaDecodeCache';
import { mediaSourceCache } from '../services/mediaSourceCache';
import { renderEditedImageToPngBlob } from '../services/imageEditingService';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { IndexedImage } from '../types';

vi.mock('../hooks/useCopyToA1111', () => ({
  useCopyToA1111: () => ({ copyToA1111: vi.fn(), isCopying: false, copyStatus: null }),
}));

vi.mock('../hooks/useGenerateWithA1111', () => ({
  useGenerateWithA1111: () => ({ generateWithA1111: vi.fn(), isGenerating: false, generateStatus: null }),
}));

vi.mock('../hooks/useCopyToComfyUI', () => ({
  useCopyToComfyUI: () => ({ copyToComfyUI: vi.fn(), isCopying: false, copyStatus: null }),
}));

vi.mock('../hooks/useGenerateWithComfyUI', () => ({
  useGenerateWithComfyUI: () => ({ generateWithComfyUI: vi.fn(), isGenerating: false, generateStatus: null }),
}));

vi.mock('../hooks/useImageComparison', () => ({
  comparisonWillAutoOpen: () => false,
  useImageComparison: () => ({ addImage: vi.fn(), comparisonCount: 0 }),
}));

vi.mock('../hooks/useReparseMetadata', () => ({
  useReparseMetadata: () => ({ isReparsing: false, reparseImages: vi.fn() }),
}));

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseA1111: true,
    canUseComfyUI: true,
    canUseComparison: true,
    canUseBatchExport: true,
    canUseImageEditor: true,
    canUseDuringTrialOrPro: true,
    showProModal: vi.fn(),
    initialized: true,
  }),
}));

vi.mock('../hooks/useGenerationProviderAvailability', () => ({
  useGenerationProviderAvailability: () => ({
    a1111Enabled: false,
    comfyUIEnabled: false,
    visibleProviders: [],
    singleVisibleProvider: null,
  }),
}));

vi.mock('../hooks/useShadowMetadata', () => ({
  useShadowMetadata: () => ({ metadata: null, saveMetadata: vi.fn(), deleteMetadata: vi.fn() }),
}));

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: (image: IndexedImage | null) => image
    ? {
        thumbnailUrl: image.thumbnailUrl ?? null,
        thumbnailHandle: null,
        thumbnailStatus: image.thumbnailUrl ? 'ready' : 'idle',
        thumbnailError: null,
      }
    : null,
}));

vi.mock('../services/mediaSourceCache', () => ({
  getElectronAbsoluteMediaPath: () => null,
  mediaSourceCache: {
    getOrLoad: vi.fn(),
    getRendererOwnedObjectUrl: vi.fn(async () => ({ url: 'blob:editable-source', revoke: vi.fn() })),
    peek: vi.fn(() => null),
  },
}));

vi.mock('../services/mediaDecodeCache', () => ({
  mediaDecodeCache: {
    retain: vi.fn(),
    release: vi.fn(),
    isWarm: vi.fn(),
    getNaturalSize: vi.fn(),
    warm: vi.fn(),
  },
}));

vi.mock('../services/imageEditingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/imageEditingService')>();
  return {
    ...actual,
    renderEditedImageToPngBlob: vi.fn(async () => new Blob(['edited'], { type: 'image/png' })),
  };
});

vi.mock('../components/ComfyUIWorkflowWorkspace', () => ({ default: () => null }));
vi.mock('../components/MetadataEditorModal', () => ({ MetadataEditorModal: () => null }));
vi.mock('../components/BatchExportModal', () => ({ default: () => null }));
vi.mock('../components/ImageLineageSection', () => ({ default: () => null }));
vi.mock('../components/CollectionFormModal', () => ({ default: () => null }));

const createImage = (
  id: string,
  options: { lastModified?: number; thumbnailUrl?: string | null } = {},
): IndexedImage => ({
  id,
  name: `${id}.png`,
  handle: {} as FileSystemFileHandle,
  thumbnailUrl: options.thumbnailUrl === null ? undefined : options.thumbnailUrl ?? `blob:preview:${id}`,
  metadata: { rawMetadata: {}, parsedMetadata: {}, normalizedMetadata: {} },
  metadataString: '',
  lastModified: options.lastModified ?? 1,
  models: [],
  loras: [],
  scheduler: '',
  fileType: 'image/png',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('ImageModal source selection', () => {
  let warmUrls: Set<string>;
  let sizesByUrl: Map<string, { width: number; height: number }>;

  beforeEach(() => {
    vi.clearAllMocks();
    useImageStore.getState().resetState();
    useSettingsStore.setState({ imageViewerDefaultZoom: 'fit' });
    warmUrls = new Set();
    sizesByUrl = new Map();
    vi.mocked(mediaSourceCache.peek).mockReturnValue(null);
    vi.mocked(mediaSourceCache.getOrLoad).mockImplementation(async (image) =>
      `blob:original:${image.id}:${image.lastModified}`);
    vi.mocked(mediaDecodeCache.warm).mockImplementation(async (url) => {
      warmUrls.add(url);
      if (!sizesByUrl.has(url)) sizesByUrl.set(url, { width: 1600, height: 900 });
    });
    vi.mocked(mediaDecodeCache.isWarm).mockImplementation((url) => warmUrls.has(url));
    vi.mocked(mediaDecodeCache.getNaturalSize).mockImplementation((url) => sizesByUrl.get(url) ?? null);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(450);
  });

  afterEach(() => {
    useSettingsStore.setState({ imageViewerDefaultZoom: 'fit' });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows an already warmed original at 1:1 without waiting for onLoad', async () => {
    useSettingsStore.setState({ imageViewerDefaultZoom: 'actual' });
    const image = createImage('warm');
    const warmUrl = 'blob:warm-original';
    warmUrls.add(warmUrl);
    sizesByUrl.set(warmUrl, { width: 1600, height: 900 });
    vi.mocked(mediaSourceCache.peek).mockReturnValue(warmUrl);

    render(
      <ImageModal image={image} onClose={vi.fn()} directoryPath="C:/images" isActive />,
    );

    const displayed = await screen.findByAltText('warm.png');
    await waitFor(() => expect(displayed.style.transform).toContain('scale(2)'));
    expect(displayed.getAttribute('src')).toBe(warmUrl);
    expect(displayed.style.opacity).toBe('1');
    expect(mediaSourceCache.getOrLoad).not.toHaveBeenCalled();
    expect(mediaDecodeCache.warm).not.toHaveBeenCalled();
  });

  it('ignores a late source from image A after switching to image B', async () => {
    const imageA = createImage('a');
    const imageB = createImage('b');
    const sourceA = deferred<string>();
    vi.mocked(mediaSourceCache.getOrLoad).mockImplementation((image) =>
      image.id === 'a' ? sourceA.promise : Promise.resolve('blob:original:b'));
    const { rerender } = render(
      <ImageModal image={imageA} onClose={vi.fn()} directoryPath="C:/images" isActive />,
    );

    rerender(<ImageModal image={imageB} onClose={vi.fn()} directoryPath="C:/images" isActive />);
    await waitFor(() => expect(screen.getByAltText('b.png').getAttribute('src')).toBe('blob:original:b'));

    await act(async () => {
      sourceA.resolve('blob:late-a');
      await sourceA.promise;
    });

    expect(screen.getByAltText('b.png').getAttribute('src')).toBe('blob:original:b');
    expect(mediaDecodeCache.warm).not.toHaveBeenCalledWith('blob:late-a');
  });

  it('keeps image B preview visible in Fit while its original is pending in 1:1 mode', async () => {
    useSettingsStore.setState({ imageViewerDefaultZoom: 'actual' });
    const imageA = createImage('a');
    const imageB = createImage('b');
    const sourceB = deferred<string>();
    vi.mocked(mediaSourceCache.getOrLoad).mockImplementation((image) =>
      image.id === 'b' ? sourceB.promise : Promise.resolve('blob:original:a'));
    const { rerender } = render(
      <ImageModal image={imageA} onClose={vi.fn()} directoryPath="C:/images" isActive />,
    );
    await waitFor(() => expect(screen.getByAltText('a.png').getAttribute('src')).toBe('blob:original:a'));

    rerender(<ImageModal image={imageB} onClose={vi.fn()} directoryPath="C:/images" isActive />);

    const displayed = await screen.findByAltText('b.png');
    await waitFor(() => expect(mediaSourceCache.getOrLoad).toHaveBeenCalledWith(imageB, 'C:/images', { prioritize: true }));
    expect(displayed.getAttribute('src')).toBe('blob:preview:b');
    expect(displayed.style.transform).toContain('scale(1)');
    expect(displayed.style.opacity).toBe('1');
  });

  it('invalidates a pending source when the same image id receives a new revision', async () => {
    const revisionOne = createImage('same', { lastModified: 1, thumbnailUrl: 'blob:preview:same' });
    const revisionTwo = { ...revisionOne, lastModified: 2 };
    const sourceOne = deferred<string>();
    const sourceTwo = deferred<string>();
    vi.mocked(mediaSourceCache.getOrLoad).mockImplementation((image) =>
      image.lastModified === 1 ? sourceOne.promise : sourceTwo.promise);
    const { rerender } = render(
      <ImageModal image={revisionOne} onClose={vi.fn()} directoryPath="C:/images" isActive />,
    );
    await waitFor(() => expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(1));

    rerender(<ImageModal image={revisionTwo} onClose={vi.fn()} directoryPath="C:/images" isActive />);
    expect((await screen.findByAltText('same.png')).getAttribute('src')).toBe('blob:preview:same');
    await waitFor(() => expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(2));

    await act(async () => {
      sourceOne.resolve('blob:original:v1');
      await sourceOne.promise;
    });
    expect(screen.getByAltText('same.png').getAttribute('src')).toBe('blob:preview:same');

    await act(async () => {
      sourceTwo.resolve('blob:original:v2');
      await sourceTwo.promise;
    });
    await waitFor(() => expect(screen.getByAltText('same.png').getAttribute('src')).toBe('blob:original:v2'));
  });

  it('preserves the preview and does not retry when full-image decode fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const image = createImage('broken');
    vi.mocked(mediaDecodeCache.warm).mockResolvedValue(undefined);
    vi.mocked(mediaDecodeCache.isWarm).mockReturnValue(false);
    vi.mocked(mediaDecodeCache.getNaturalSize).mockReturnValue(null);
    const { rerender } = render(
      <ImageModal image={image} onClose={vi.fn()} directoryPath="C:/images" isActive />,
    );

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.getByAltText('broken.png').getAttribute('src')).toBe('blob:preview:broken');
    expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(1);

    rerender(<ImageModal image={image} onClose={vi.fn()} directoryPath="C:/images" isActive />);
    expect(screen.getByAltText('broken.png').getAttribute('src')).toBe('blob:preview:broken');
    expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(1);
  });

  it('does not show an edited preview from the previous image while the next source loads', async () => {
    const imageA = createImage('edited-a');
    const imageB = createImage('plain-b');
    const sourceB = deferred<string>();
    vi.mocked(mediaSourceCache.getOrLoad).mockImplementation((image) =>
      image.id === 'plain-b' ? sourceB.promise : Promise.resolve('blob:original:edited-a'));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:edited-preview-a'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(() => undefined),
    });
    const { rerender } = render(
      <ImageModal image={imageA} onClose={vi.fn()} directoryPath="C:/images" isActive />,
    );

    const original = await screen.findByAltText('edited-a.png');
    await waitFor(() => expect(original.getAttribute('src')).toBe('blob:original:edited-a'));
    Object.defineProperty(original, 'naturalWidth', { configurable: true, value: 1600 });
    Object.defineProperty(original, 'naturalHeight', { configurable: true, value: 900 });
    fireEvent.load(original);
    fireEvent.click(screen.getByTitle('Edit image adjustments'));
    fireEvent.change(await screen.findByLabelText('Brightness'), { target: { value: '110' } });
    await waitFor(() => expect(renderEditedImageToPngBlob).toHaveBeenCalled(), { timeout: 1000 });
    await waitFor(() => expect(screen.getByAltText('edited-a.png').getAttribute('src')).toBe('blob:edited-preview-a'));

    rerender(<ImageModal image={imageB} onClose={vi.fn()} directoryPath="C:/images" isActive />);

    expect((await screen.findByAltText('plain-b.png')).getAttribute('src')).toBe('blob:preview:plain-b');
  });

  it('accepts only imh-thumb snapshot previews', async () => {
    const image = createImage('native', { thumbnailUrl: null });
    const source = deferred<string>();
    vi.mocked(mediaSourceCache.getOrLoad).mockReturnValue(source.promise);
    const unsafeRender = render(
      <ImageModal
        hostMode="native-window"
        image={image}
        previewUrl="blob:unsafe-preview"
        onClose={vi.fn()}
        directoryPath="C:/images"
        isActive
      />,
    );

    expect(screen.queryByAltText('native.png')).toBeNull();
    unsafeRender.unmount();
    render(
      <ImageModal
        hostMode="native-window"
        image={image}
        previewUrl="imh-thumb://cache/native.webp"
        onClose={vi.fn()}
        directoryPath="C:/images"
        isActive
      />,
    );

    expect((await screen.findByAltText('native.png')).getAttribute('src')).toBe('imh-thumb://cache/native.webp');
    expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(2);
  });

  it('does not restart the original load when native previewUrl changes', async () => {
    const image = createImage('native-update', { thumbnailUrl: null });
    const source = deferred<string>();
    vi.mocked(mediaSourceCache.getOrLoad).mockReturnValue(source.promise);
    const { rerender } = render(
      <ImageModal
        hostMode="native-window"
        image={image}
        previewUrl="imh-thumb://cache/first.webp"
        onClose={vi.fn()}
        directoryPath="C:/images"
        isActive
      />,
    );
    await screen.findByAltText('native-update.png');

    rerender(
      <ImageModal
        hostMode="native-window"
        image={image}
        previewUrl="imh-thumb://cache/second.webp"
        onClose={vi.fn()}
        directoryPath="C:/images"
        isActive
      />,
    );

    expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(1);
  });
});
