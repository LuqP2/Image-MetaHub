import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageModal from '../components/ImageModal';
import type { IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

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
        thumbnailUrl: image.thumbnailUrl ?? 'blob:test-video',
        thumbnailHandle: null,
        thumbnailStatus: 'ready',
        thumbnailError: null,
      }
    : null,
}));

vi.mock('../services/mediaSourceCache', () => ({
  getElectronAbsoluteMediaPath: () => null,
  mediaSourceCache: {
    getOrLoad: vi.fn(async () => 'blob:test-video'),
    peek: vi.fn(() => null),
  },
}));

vi.mock('../components/ComfyUIWorkflowWorkspace', () => ({ default: () => null }));
vi.mock('../components/MetadataEditorModal', () => ({ MetadataEditorModal: () => null }));
vi.mock('../components/BatchExportModal', () => ({ default: () => null }));
vi.mock('../components/ImageLineageSection', () => ({ default: () => null }));
vi.mock('../components/CollectionFormModal', () => ({ default: () => null }));

const createVideo = (id: string): IndexedImage => ({
  id,
  name: `${id}.mp4`,
  handle: {} as FileSystemFileHandle,
  thumbnailUrl: 'blob:test-video',
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
  fileType: 'video/mp4',
});

const createImage = (id: string): IndexedImage => ({
  ...createVideo(id),
  name: `${id}.png`,
  fileType: 'image/png',
});

const renderVideoModal = async (props: Partial<React.ComponentProps<typeof ImageModal>> = {}) => {
  const view = render(
    <ImageModal
      image={createVideo('clip-one')}
      onClose={vi.fn()}
      currentIndex={0}
      totalImages={3}
      directoryPath="C:/videos"
      isActive
      {...props}
    />,
  );

  const video = await waitFor(() => {
    const element = view.container.querySelector('video');
    if (!element) {
      throw new Error('video element not rendered yet');
    }
    return element;
  });

  return { ...view, video };
};

describe('ImageModal video playback controls', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    localStorage.clear();
    useSettingsStore.getState().resetState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-plays by default and stops auto-playing when the setting is off', async () => {
    const { video, unmount } = await renderVideoModal();
    expect(video.autoplay).toBe(true);
    unmount();

    useSettingsStore.getState().setAutoPlayMedia(false);

    const { video: pausedVideo } = await renderVideoModal();
    expect(pausedVideo.autoplay).toBe(false);
  });

  it('cycles the repeat button through off, all and one', async () => {
    await renderVideoModal();

    expect(screen.getByRole('button', { name: 'Repeat off' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Repeat off' }));
    expect(useSettingsStore.getState().videoRepeatMode).toBe('all');

    fireEvent.click(screen.getByRole('button', { name: 'Repeat all' }));
    expect(useSettingsStore.getState().videoRepeatMode).toBe('one');

    fireEvent.click(screen.getByRole('button', { name: 'Repeat one' }));
    expect(useSettingsStore.getState().videoRepeatMode).toBe('off');
  });

  it('uses the native window frame instead of inline window controls and resize handles', async () => {
    const onToggleAlwaysOnTop = vi.fn();
    const { container } = await renderVideoModal({ hostMode: 'native-window', onToggleAlwaysOnTop });
    expect(container.querySelector('[data-resize-handle="true"]')).toBeNull();
    expect(screen.queryByTitle('Minimize window')).toBeNull();
    expect(screen.queryByTitle('Maximize window')).toBeNull();
    expect(screen.queryByTitle('Close (Esc)')).toBeNull();
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain('inset-0');
    expect(dialog.style.left).toBe('');
    expect(dialog.style.top).toBe('');
    expect(dialog.style.width).toBe('');
    expect(dialog.style.height).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Enable always on top' }));
    expect(onToggleAlwaysOnTop).toHaveBeenCalledTimes(1);
  });

  it('only loops the media element natively in repeat one', async () => {
    const { video } = await renderVideoModal();
    expect(video.loop).toBe(false);

    await act(async () => {
      useSettingsStore.getState().setVideoRepeatMode('all');
    });
    expect(video.loop).toBe(false);

    await act(async () => {
      useSettingsStore.getState().setVideoRepeatMode('one');
    });
    expect(video.loop).toBe(true);
  });

  it('toggles shuffle', async () => {
    await renderVideoModal();

    fireEvent.click(screen.getByRole('button', { name: 'Shuffle off' }));
    expect(useSettingsStore.getState().videoShuffle).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Shuffle on' }));
    expect(useSettingsStore.getState().videoShuffle).toBe(false);
  });

  it('does not navigate when the video ends with repeat off and shuffle off', async () => {
    const onNavigateNextWrapping = vi.fn();
    const onNavigateRandom = vi.fn();

    const { video } = await renderVideoModal({ onNavigateNextWrapping, onNavigateRandom });
    fireEvent.ended(video);

    expect(onNavigateNextWrapping).not.toHaveBeenCalled();
    expect(onNavigateRandom).not.toHaveBeenCalled();
  });

  it('advances with wrap-around when the video ends in repeat all', async () => {
    const onNavigateNextWrapping = vi.fn();
    const onNavigateRandom = vi.fn();
    useSettingsStore.getState().setVideoRepeatMode('all');

    const { video } = await renderVideoModal({ onNavigateNextWrapping, onNavigateRandom });
    fireEvent.ended(video);

    expect(onNavigateNextWrapping).toHaveBeenCalledTimes(1);
    expect(onNavigateRandom).not.toHaveBeenCalled();
  });

  it('jumps to a random item when the video ends in repeat all with shuffle on', async () => {
    const onNavigateNextWrapping = vi.fn();
    const onNavigateRandom = vi.fn();
    useSettingsStore.getState().setVideoShuffle(true);
    useSettingsStore.getState().setVideoRepeatMode('all');

    const { video } = await renderVideoModal({ onNavigateNextWrapping, onNavigateRandom });
    fireEvent.ended(video);

    expect(onNavigateRandom).toHaveBeenCalledTimes(1);
    expect(onNavigateNextWrapping).not.toHaveBeenCalled();
  });

  it('stops at the end of the video when repeat is off, even with shuffle on', async () => {
    const onNavigateNext = vi.fn();
    const onNavigateNextWrapping = vi.fn();
    const onNavigateRandom = vi.fn();
    useSettingsStore.getState().setVideoShuffle(true);

    const { video } = await renderVideoModal({ onNavigateNext, onNavigateNextWrapping, onNavigateRandom });
    fireEvent.ended(video);

    expect(onNavigateRandom).not.toHaveBeenCalled();
    expect(onNavigateNextWrapping).not.toHaveBeenCalled();
    expect(onNavigateNext).not.toHaveBeenCalled();
  });

  it('sends the next arrow to a random item while shuffle is on', async () => {
    const onNavigateNext = vi.fn();
    const onNavigateRandom = vi.fn();
    useSettingsStore.getState().setVideoShuffle(true);

    await renderVideoModal({ onNavigateNext, onNavigatePrevious: vi.fn(), onNavigateRandom });

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));

    expect(onNavigateRandom).toHaveBeenCalledTimes(1);
    expect(onNavigateNext).not.toHaveBeenCalled();
  });

  it('keeps the next arrow sequential while shuffle is off', async () => {
    const onNavigateNext = vi.fn();
    const onNavigateRandom = vi.fn();

    await renderVideoModal({ onNavigateNext, onNavigatePrevious: vi.fn(), onNavigateRandom });

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));

    expect(onNavigateNext).toHaveBeenCalledTimes(1);
    expect(onNavigateRandom).not.toHaveBeenCalled();
  });

  it('keeps the next arrow sequential on an image, even while shuffle is on', async () => {
    const onNavigateNext = vi.fn();
    const onNavigateRandom = vi.fn();
    useSettingsStore.getState().setVideoShuffle(true);

    render(
      <ImageModal
        image={createImage('shot-one')}
        onClose={vi.fn()}
        currentIndex={0}
        totalImages={3}
        directoryPath="C:/images"
        isActive
        onNavigateNext={onNavigateNext}
        onNavigatePrevious={vi.fn()}
        onNavigateRandom={onNavigateRandom}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Next image' }));

    expect(onNavigateNext).toHaveBeenCalledTimes(1);
    expect(onNavigateRandom).not.toHaveBeenCalled();
  });

  it('keeps the previous arrow sequential while shuffle is on', async () => {
    const onNavigatePrevious = vi.fn();
    const onNavigateRandom = vi.fn();
    useSettingsStore.getState().setVideoShuffle(true);

    await renderVideoModal({ onNavigateNext: vi.fn(), onNavigatePrevious, onNavigateRandom });

    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));

    expect(onNavigatePrevious).toHaveBeenCalledTimes(1);
    expect(onNavigateRandom).not.toHaveBeenCalled();
  });

  it('keeps playing the chained item even when auto-play is off', async () => {
    useSettingsStore.getState().setAutoPlayMedia(false);
    useSettingsStore.getState().setVideoRepeatMode('all');

    const { video, rerender, container } = await renderVideoModal({ onNavigateNextWrapping: vi.fn() });
    expect(video.autoplay).toBe(false);

    fireEvent.ended(video);

    rerender(
      <ImageModal
        image={createVideo('clip-two')}
        onClose={vi.fn()}
        currentIndex={1}
        totalImages={3}
        directoryPath="C:/videos"
        isActive
        onNavigateNextWrapping={vi.fn()}
      />,
    );

    await waitFor(() => {
      const nextVideo = container.querySelector('video');
      expect(nextVideo?.autoplay).toBe(true);
    });
  });
});
