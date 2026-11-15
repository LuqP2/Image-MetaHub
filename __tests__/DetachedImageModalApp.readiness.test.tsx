import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageViewerSnapshot } from '../services/imageViewerContracts';
import type { IndexedImage } from '../types';
import DetachedImageModalApp from '../components/DetachedImageModalApp';

const mocks = vi.hoisted(() => ({ displayed: null as string | null, setState: vi.fn() }));
vi.mock('../components/ImageModal', () => ({ default: ({ image, onOpenLineageImage }: {
  image: { id: string };
  onOpenLineageImage: (image: IndexedImage) => void;
}) => {
  mocks.displayed = image.id;
  return <div>
    {image.id}
    <button onClick={() => onOpenLineageImage({ id: 'source' } as IndexedImage)}>Source Image</button>
  </div>;
} }));
vi.mock('../components/ProOnlyModal', () => ({ default: () => null }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({}) }));
vi.mock('../store/useImageStore', () => ({ useImageStore: { setState: mocks.setState } }));
vi.mock('../store/useSettingsStore', () => ({ useSettingsStore: Object.assign(
  (selector: (state: { theme: string }) => unknown) => selector({ theme: 'dark' }),
  { persist: { rehydrate: async () => undefined } },
) }));
vi.mock('../store/useLicenseStore', () => ({ useLicenseStore: {
  persist: { rehydrate: async () => undefined },
  getState: () => ({ checkLicenseStatus: async () => undefined }),
} }));

const snapshot = (sessionId: string, imageId: string, revision: number): ImageViewerSnapshot => ({
  sessionId, revision, image: { id: imageId, name: `${imageId}.png` } as ImageViewerSnapshot['image'],
  previousImage: null, nextImage: null, previousDirectoryPath: null, nextDirectoryPath: null,
  currentIndex: 0, totalImages: 1, directoryPath: '/synthetic', isIndexing: false,
  startSlideshow: false, closeOnSlideshowExit: false, recentTags: [], comparisonCount: 0,
  comparisonImages: [], collections: [], selectedImageIds: [],
});

afterEach(() => {
  delete window.electronAPI;
  window.history.replaceState({}, '', '/');
});

describe('detached renderer applied-snapshot handshake', () => {
  it('routes a lineage click to the library renderer using the current viewer session', async () => {
    window.history.replaceState({}, '', '/?sessionId=lineage');
    let receive!: (snapshot: ImageViewerSnapshot | null) => void;
    const command = vi.fn(async () => ({ success: true }));
    window.electronAPI = {
      getTheme: async () => ({ shouldUseDarkColors: true }),
      onThemeUpdated: () => () => undefined,
      imageViewerReady: async () => ({ success: true }),
      onImageViewerSnapshot: (callback) => { receive = callback; return () => undefined; },
      imageViewerCommand: command,
    } as Window['electronAPI'];
    render(<DetachedImageModalApp />);
    await act(async () => receive(snapshot('lineage', 'derived', 1)));
    fireEvent.click(screen.getByRole('button', { name: 'Source Image' }));
    expect(command).toHaveBeenCalledWith({
      sessionId: 'lineage',
      command: { type: 'open-lineage-image', imageId: 'source' },
    });
  });

  it('acknowledges initial rendering and rebinding only after the corresponding image is mounted', async () => {
    window.history.replaceState({}, '', '/?sessionId=initial');
    let receive!: (snapshot: ImageViewerSnapshot | null) => void;
    const acknowledgments: Array<{ sessionId: string; revision?: number; displayed: string | null }> = [];
    const ready = vi.fn(async (sessionId: string, revision?: number) => {
      acknowledgments.push({ sessionId, revision, displayed: mocks.displayed });
      return { success: true };
    });
    window.electronAPI = {
      getTheme: async () => ({ shouldUseDarkColors: true }),
      onThemeUpdated: () => () => undefined,
      imageViewerReady: ready,
      onImageViewerSnapshot: (callback) => { receive = callback; return () => undefined; },
    } as Window['electronAPI'];
    render(<DetachedImageModalApp />);
    expect(ready).toHaveBeenCalledWith('initial');
    await act(async () => receive(snapshot('initial', 'a', 1)));
    expect(acknowledgments.at(-1)).toEqual({ sessionId: 'initial', revision: 1, displayed: 'a' });
    await act(async () => receive(null));
    await act(async () => receive(snapshot('rebound', 'b', 1)));
    expect(acknowledgments.at(-1)).toEqual({ sessionId: 'rebound', revision: 1, displayed: 'b' });
    // Simulate an unreceived ACK: main resends the same revision. The mounted
    // image must be acknowledged again without reapplying the snapshot.
    const appliedCount = mocks.setState.mock.calls.length;
    await act(async () => receive(snapshot('rebound', 'b', 1)));
    expect(acknowledgments.at(-1)).toEqual({ sessionId: 'rebound', revision: 1, displayed: 'b' });
    expect(mocks.setState.mock.calls.length).toBe(appliedCount);
    await act(async () => receive(snapshot('rebound', 'obsolete', 0)));
    expect(mocks.displayed).toBe('b');
    expect(ready).toHaveBeenCalledTimes(4);
    await act(async () => receive(null));
    await act(async () => receive(snapshot('rebound', 'c', 1)));
    expect(acknowledgments.at(-1)).toEqual({ sessionId: 'rebound', revision: 1, displayed: 'c' });
  });
});
