import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardAssetNode from '../components/boards/BoardAssetNode';
import BoardVideoPreview from '../components/boards/BoardVideoPreview';
import BoardToolbar from '../components/boards/BoardToolbar';
import { useBoardStore } from '../store/useBoardStore';
import { BoardEditorContext, type BoardEditorActions } from '../components/boards/BoardEditorContext';
import { addAssets } from '../services/boards/operations';
import { createBoardDocument } from '../services/boards/document.mjs';
import { boardLocator } from './helpers/boardFixtures';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import type { IndexedImage } from '../types';
import type { BoardFlowNode } from '../services/boards/reactFlowAdapter';
import type { NodeProps } from '@xyflow/react';

const mocks = vi.hoisted(() => ({ thumbnail: vi.fn(), load: vi.fn() }));
vi.mock('../hooks/useThumbnail', () => ({ useThumbnail: mocks.thumbnail }));
vi.mock('../hooks/useResolvedThumbnail', () => ({ useResolvedThumbnail: () => ({ thumbnailUrl: 'poster.png', thumbnailStatus: 'ready' }) }));
vi.mock('../services/mediaSourceCache', () => ({ mediaSourceCache: { getOrLoad: mocks.load } }));
vi.mock('../components/boards/BoardNodeControls', () => ({ default: () => null }));
vi.mock('../components/Model3DThumbnail', () => ({ default: ({ directoryPath }) => <div data-testid="model-preview">{directoryPath}</div> }));

const image = { id: 'library::clip.mp4', directoryId: 'library', name: 'clip.mp4', lastModified: 1, tags: [] } as unknown as IndexedImage;
let intersect: (entries: { isIntersecting: boolean }[]) => void;
beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue('imh-media://clip.mp4');
  mocks.thumbnail.mockClear();
  useSettingsStore.setState({ disableThumbnails: false, enableSafeMode: false, canvasAutoplayVideos: true });
  useImageStore.setState({ directories: [{ id: 'library', path: 'C:/models' }] as never });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mountAsset(mediaType: 'video' | 'model3d', exporting = false) {
  const object = addAssets(createBoardDocument(), [{ name: image.name, mediaType, reference: { kind: 'path', locator: boardLocator(image.name) } }], { x: 0, y: 0 }).objects[0];
  const editor: BoardEditorActions = { editable: true, connecting: false, exporting, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn(), resolveAsset: () => ({ status: 'resolved', image }) };
  return render(<BoardEditorContext.Provider value={editor}><BoardAssetNode {...{ data: { object }, selected: false } as NodeProps<BoardFlowNode>} /></BoardEditorContext.Provider>);
}

describe('Canvas asset media', () => {
  it('toggles autoplay from the toolbar and preserves manual playback when disabled', async () => {
    useSettingsStore.getState().setCanvasAutoplayVideos(false);
    const board = createBoardDocument();
    useBoardStore.getState().adoptBoard(board);
    const { container } = render(<><BoardToolbar boardId={board.id} editable tool="select" setTool={vi.fn()} /><BoardVideoPreview image={image} /></>);
    act(() => intersect([{ isIntersecting: true }]));
    await waitFor(() => expect(container.querySelector('video')?.src).toBe('imh-media://clip.mp4'));
    const video = container.querySelector('video')!;
    const toggle = screen.getByRole('button', { name: 'Autoplay videos' });
    expect(toggle.textContent).toBe('');
    expect(toggle.title).toBe('Autoplay videos: off');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(video.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(video.play).toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().canvasAutoplayVideos).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    video.currentTime = 7;
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().canvasAutoplayVideos).toBe(false);
    expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();
    expect(video.pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(7);
    expect(container.querySelector('video')).toBe(video);
    cleanup();
    render(<BoardVideoPreview image={image} />);
    expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();
  });

  it('renders 3D with the model renderer and live library directory instead of requesting a raster thumbnail', () => {
    mountAsset('model3d');
    expect(screen.getByTestId('model-preview').textContent).toBe('C:/models');
    expect(mocks.thumbnail).toHaveBeenCalledWith(null);
  });

  it('exports video using its static poster without mounting playback', () => {
    const { container } = mountAsset('video', true);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')?.src).toContain('poster.png');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('loads visible videos, starts muted, supports sound and pause, and pauses/remutes offscreen', async () => {
    const { container, unmount } = render(<BoardVideoPreview image={image} directoryPath="C:/models" poster="poster.png" />);
    expect(mocks.load).not.toHaveBeenCalled();
    act(() => intersect([{ isIntersecting: true }]));
    await waitFor(() => expect(container.querySelector('video')?.src).toBe('imh-media://clip.mp4'));
    const video = container.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.play).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute video' }));
    expect(video.muted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Pause video' }));
    expect(video.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    act(() => intersect([{ isIntersecting: false }]));
    expect(video.muted).toBe(true);
    unmount();
    expect(video.pause).toHaveBeenCalled();
  });

  it('keeps a poster and explanation when the media cannot play', async () => {
    const { container } = render(<BoardVideoPreview image={image} poster="poster.png" />);
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByText('Playback unavailable')).toBeTruthy();
    expect(container.querySelector('img')?.src).toContain('poster.png');
  });
});
