import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageModal from '../components/ImageModal';
import type { IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { mediaSourceCache } from '../services/mediaSourceCache';
import { mediaDecodeCache } from '../services/mediaDecodeCache';

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
  useShadowMetadata: () => ({
    metadata: null,
    saveMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
  }),
}));

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: (image: IndexedImage | null) => image
    ? {
        thumbnailUrl: image.thumbnailUrl ?? 'blob:test-image',
        thumbnailHandle: null,
        thumbnailStatus: 'ready',
        thumbnailError: null,
      }
    : null,
}));

vi.mock('../services/mediaSourceCache', () => ({
  getElectronAbsoluteMediaPath: () => null,
  mediaSourceCache: {
    getOrLoad: vi.fn(async () => 'blob:test-image'),
    peek: vi.fn(() => null),
  },
}));

vi.mock('../services/mediaDecodeCache', () => ({
  mediaDecodeCache: {
    retain: vi.fn(),
    release: vi.fn(),
    isWarm: vi.fn(() => false),
    getNaturalSize: vi.fn(() => ({ width: 1024, height: 768 })),
    warm: vi.fn(async () => undefined),
  },
}));

vi.mock('../components/ComfyUIWorkflowWorkspace', () => ({
  default: () => null,
}));

vi.mock('../components/MetadataEditorModal', () => ({
  MetadataEditorModal: () => null,
}));

vi.mock('../components/BatchExportModal', () => ({
  default: () => null,
}));

vi.mock('../components/ImageLineageSection', () => ({
  default: () => null,
}));

vi.mock('../components/CollectionFormModal', () => ({
  default: () => null,
}));

const createImage = (id: string, name = `${id}.png`): IndexedImage => ({
  id,
  name,
  handle: {} as FileSystemFileHandle,
  thumbnailUrl: 'blob:test-image',
  metadata: {
    rawMetadata: {},
    parsedMetadata: {},
    normalizedMetadata: {},
  },
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  fileType: 'image/png',
});

const installIdleController = () => {
  const callbacks = new Map<number, IdleRequestCallback>();
  let nextId = 1;
  const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  const cancelIdleCallback = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  vi.stubGlobal('requestIdleCallback', requestIdleCallback);
  vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

  const runNext = async () => {
    const next = callbacks.entries().next().value as [number, IdleRequestCallback] | undefined;
    if (!next) throw new Error('No idle callback is pending');
    callbacks.delete(next[0]);
    await act(async () => {
      next[1]({ didTimeout: false, timeRemaining: () => 50 });
      await Promise.resolve();
    });
  };

  return { callbacks, requestIdleCallback, runNext };
};

describe('ImageModal slideshow behavior', () => {
  let setFullscreen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useImageStore.getState().resetState();
    vi.mocked(mediaSourceCache.getOrLoad).mockImplementation(async (image) => `blob:${image.id}`);
    vi.mocked(mediaSourceCache.peek).mockReturnValue(null);
    vi.mocked(mediaDecodeCache.isWarm).mockReturnValue(true);
    vi.mocked(mediaDecodeCache.getNaturalSize).mockReturnValue({ width: 1024, height: 768 });
    vi.mocked(mediaDecodeCache.warm).mockResolvedValue(undefined);
    setFullscreen = vi.fn(async (isFullscreen: boolean) => ({ success: true, isFullscreen }));
    window.electronAPI = {
      ...(window.electronAPI ?? {}),
      setFullscreen,
    };
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.electronAPI;
  });

  it('exits fullscreen and closes slideshow modals that were created for slideshow', async () => {
    const onClose = vi.fn();

    render(
      <ImageModal
        image={createImage('one')}
        onClose={onClose}
        currentIndex={0}
        totalImages={2}
        directoryPath="C:/images"
        isActive
        startSlideshow
        closeOnSlideshowExit
        onSlideshowStartAcknowledged={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Exit slideshow' }));

    await waitFor(() => expect(setFullscreen).toHaveBeenCalledWith(false));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('exits fullscreen without closing reused modals', async () => {
    const onClose = vi.fn();

    render(
      <ImageModal
        image={createImage('one')}
        onClose={onClose}
        currentIndex={0}
        totalImages={2}
        directoryPath="C:/images"
        isActive
        startSlideshow
        closeOnSlideshowExit={false}
        onSlideshowStartAcknowledged={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(setFullscreen).toHaveBeenCalledWith(false));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets zoom when the slideshow advances to another image', async () => {
    const firstImage = createImage('one');
    const secondImage = createImage('two');
    const onClose = vi.fn();

    const { rerender } = render(
      <ImageModal
        image={firstImage}
        onClose={onClose}
        currentIndex={0}
        totalImages={2}
        directoryPath="C:/images"
        isActive
        startSlideshow
        closeOnSlideshowExit={false}
        onSlideshowStartAcknowledged={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTitle('Zoom In'));
    expect(screen.getByText('150%')).toBeTruthy();

    await act(async () => {
      rerender(
        <ImageModal
          image={secondImage}
          onClose={onClose}
          currentIndex={1}
          totalImages={2}
          directoryPath="C:/images"
          isActive
          startSlideshow={false}
          closeOnSlideshowExit={false}
          onSlideshowStartAcknowledged={vi.fn()}
        />,
      );
    });

    await waitFor(() => expect(screen.getByTitle('Fit to Screen (Current)')).toBeTruthy());
  });

  it('dispatches an individual arrow key before any animation frame runs', async () => {
    const onNavigateNext = vi.fn();
    const animationFrames: FrameRequestCallback[] = [];
    const requestFrame = vi.mocked(window.requestAnimationFrame);

    render(
      <ImageModal
        image={createImage('one')}
        onClose={vi.fn()}
        currentIndex={0}
        totalImages={2}
        onNavigateNext={onNavigateNext}
        directoryPath="C:/images"
        isActive
      />,
    );
    await screen.findByAltText('one.png');
    requestFrame.mockClear();
    requestFrame.mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: false });

    expect(onNavigateNext).toHaveBeenCalledTimes(1);
    expect(animationFrames).toHaveLength(0);
  });

  it('cancels a queued repeat when an individual arrow key follows it', async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const animationFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestFrame = vi.mocked(window.requestAnimationFrame);

    render(
      <ImageModal
        image={createImage('one')}
        onClose={vi.fn()}
        currentIndex={1}
        totalImages={3}
        onNavigateNext={onNavigateNext}
        onNavigatePrevious={onNavigatePrevious}
        directoryPath="C:/images"
        isActive
      />,
    );
    await screen.findByAltText('one.png');
    requestFrame.mockClear();
    requestFrame.mockImplementation((callback) => {
      const frameId = nextFrameId++;
      animationFrames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      animationFrames.delete(frameId);
    });

    fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: false });

    for (const callback of animationFrames.values()) {
      callback(0);
    }

    expect(onNavigateNext).toHaveBeenCalledTimes(1);
    expect(onNavigatePrevious).not.toHaveBeenCalled();
  });

  it('prefetches explicit ComfyUI neighbors in direction order without consulting store order', async () => {
    const idle = installIdleController();
    const current = createImage('current');
    const previous = createImage('comfy-previous');
    const next = createImage('comfy-next');
    useImageStore.setState({
      images: [next, previous, current],
      filteredImages: [previous, current, next],
    });

    render(
      <ImageModal
        image={current}
        prefetchPrevious={{ image: previous, directoryPath: 'D:/previous-source' }}
        prefetchNext={{ image: next, directoryPath: 'E:/next-source' }}
        onClose={vi.fn()}
        currentIndex={4123}
        totalImages={10_000}
        directoryPath="C:/current-source"
        isActive
      />,
    );

    await waitFor(() => expect(idle.requestIdleCallback).toHaveBeenCalledTimes(1));
    vi.mocked(mediaSourceCache.getOrLoad).mockClear();
    vi.mocked(mediaDecodeCache.warm).mockClear();
    let finishFirstDecode!: () => void;
    vi.mocked(mediaDecodeCache.warm).mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishFirstDecode = resolve;
    }));

    await idle.runNext();

    await waitFor(() => expect(mediaSourceCache.getOrLoad).toHaveBeenCalledWith(next, 'E:/next-source'));
    expect(mediaDecodeCache.warm).toHaveBeenCalledWith('blob:comfy-next');
    expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(1);
    expect(idle.callbacks.size).toBe(0);

    await act(async () => {
      finishFirstDecode();
      await Promise.resolve();
    });
    await waitFor(() => expect(idle.callbacks.size).toBe(1));
    await idle.runNext();

    await waitFor(() => expect(mediaSourceCache.getOrLoad).toHaveBeenNthCalledWith(2, previous, 'D:/previous-source'));
    expect(mediaDecodeCache.warm).toHaveBeenNthCalledWith(2, 'blob:comfy-previous');
  });

  it('prefetches only the available neighbor at the start and end of a list', async () => {
    const idle = installIdleController();
    const first = createImage('first');
    const second = createImage('second');
    const firstRender = render(
      <ImageModal
        image={first}
        prefetchPrevious={null}
        prefetchNext={{ image: second, directoryPath: 'D:/second' }}
        onClose={vi.fn()}
        currentIndex={0}
        totalImages={2}
        directoryPath="C:/first"
        isActive
      />,
    );

    await waitFor(() => expect(idle.callbacks.size).toBe(1));
    vi.mocked(mediaSourceCache.getOrLoad).mockClear();
    vi.mocked(mediaDecodeCache.warm).mockClear();
    await idle.runNext();
    await waitFor(() => expect(mediaSourceCache.getOrLoad).toHaveBeenCalledWith(second, 'D:/second'));
    expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(1);
    expect(idle.callbacks.size).toBe(0);

    firstRender.unmount();
    idle.callbacks.clear();
    vi.mocked(mediaSourceCache.getOrLoad).mockClear();
    vi.mocked(mediaDecodeCache.warm).mockClear();

    render(
      <ImageModal
        image={second}
        prefetchPrevious={{ image: first, directoryPath: 'C:/first' }}
        prefetchNext={null}
        onClose={vi.fn()}
        currentIndex={1}
        totalImages={2}
        directoryPath="D:/second"
        isActive
      />,
    );

    await waitFor(() => expect(idle.callbacks.size).toBe(1));
    vi.mocked(mediaSourceCache.getOrLoad).mockClear();
    vi.mocked(mediaDecodeCache.warm).mockClear();
    await idle.runNext();
    await waitFor(() => expect(mediaSourceCache.getOrLoad).toHaveBeenCalledWith(first, 'C:/first'));
    expect(mediaSourceCache.getOrLoad).toHaveBeenCalledTimes(1);
    expect(idle.callbacks.size).toBe(0);
  });

  it('does not warm or continue an obsolete neighbor queue after the image changes', async () => {
    const idle = installIdleController();
    const current = createImage('current');
    const staleNext = createImage('stale-next');
    const stalePrevious = createImage('stale-previous');
    const replacement = createImage('replacement');
    const { rerender } = render(
      <ImageModal
        image={current}
        prefetchPrevious={{ image: stalePrevious, directoryPath: 'D:/stale-previous' }}
        prefetchNext={{ image: staleNext, directoryPath: 'D:/stale-next' }}
        onClose={vi.fn()}
        currentIndex={1}
        totalImages={3}
        directoryPath="C:/current"
        isActive
      />,
    );

    await waitFor(() => expect(idle.callbacks.size).toBe(1));
    vi.mocked(mediaSourceCache.getOrLoad).mockClear();
    vi.mocked(mediaDecodeCache.warm).mockClear();
    let resolveStaleSource!: (url: string) => void;
    vi.mocked(mediaSourceCache.getOrLoad).mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveStaleSource = resolve;
    }));
    await idle.runNext();
    await waitFor(() => expect(mediaSourceCache.getOrLoad).toHaveBeenCalledWith(staleNext, 'D:/stale-next'));

    rerender(
      <ImageModal
        image={replacement}
        prefetchPrevious={null}
        prefetchNext={null}
        onClose={vi.fn()}
        currentIndex={0}
        totalImages={1}
        directoryPath="E:/replacement"
        isActive
      />,
    );

    await act(async () => {
      resolveStaleSource('blob:stale-next');
      await Promise.resolve();
    });

    expect(mediaDecodeCache.warm).not.toHaveBeenCalledWith('blob:stale-next');
    expect(mediaSourceCache.getOrLoad).not.toHaveBeenCalledWith(stalePrevious, 'D:/stale-previous');
    expect(idle.callbacks.size).toBe(0);
  });
});
