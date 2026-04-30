import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageModal from '../components/ImageModal';
import type { IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';

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

describe('ImageModal slideshow behavior', () => {
  let setFullscreen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useImageStore.getState().resetState();
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

    await waitFor(() => expect(screen.getByText('100%')).toBeTruthy());
  });
});
