import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasWorkspace from '../components/CanvasWorkspace';
import { useImageStore } from '../store/useImageStore';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { addAssets } from '../services/boards/operations';
import { createBoardAssetReference } from '../services/boards/assetResolver';
import { boardDirectory, boardImage } from './helpers/boardIntegrationFixtures';

const feature = vi.hoisted(() => ({ canUseCanvas: true, canUseComparison: true, showProModal: vi.fn() }));
const editor = vi.hoisted(() => ({ latest: null as Record<string, unknown> | null }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => feature }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
vi.mock('../components/BoardWorkspace', () => ({ default: props => { editor.latest = props; return <div>{props.extraToolbar}{props.assetInspector}</div>; } }));
vi.mock('../components/ComparisonMetadataPanel', () => ({ default: ({ image }) => <div>Metadata {image.name}</div> }));

beforeEach(() => { feature.canUseCanvas = true; feature.canUseComparison = true; feature.showProModal.mockClear(); useBoardStore.setState({ sessions: {}, activeBoardId: null, closing: false }); });
afterEach(async () => { await act(async () => useBoardStore.getState().flushAll()); cleanup(); });
describe('Canvas IMH integration', () => {
  it('opens the viewer with board navigation, compares distinct images and reuses annotations', async () => {
    const images = [boardImage('a.png'), boardImage('b.png')];
    useImageStore.setState({ images, directories: [boardDirectory] });
    const board = addAssets(createBoardDocument(), images.map(image => ({ name: image.name, mediaType: 'image', reference: createBoardAssetReference(image, [boardDirectory]) })), { x: 0, y: 0 });
    useBoardStore.getState().adoptBoard(board);
    useBoardStore.getState().setSelection(board.id, board.objects.map(object => object.id));
    const compare = vi.fn(); const open = vi.fn();
    render(<CanvasWorkspace loading={false} onOpenImage={open} onCompareImages={compare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected images' }));
    expect(compare).toHaveBeenCalledWith(images);
    act(() => useBoardStore.getState().setSelection(board.id, [board.objects[0].id]));
    fireEvent.click(screen.getByRole('button', { name: 'Open viewer' }));
    expect(open).toHaveBeenCalledWith(images[0], images);
    expect(screen.getByText('Metadata a.png')).toBeTruthy();
    const favorite = vi.spyOn(useImageStore.getState(), 'toggleFavorite').mockResolvedValue(undefined);
    fireEvent.click(screen.getByText('☆ Favorite'));
    expect(favorite).toHaveBeenCalledWith(images[0].id); favorite.mockRestore();
  });
  it('retains the comparison gate and rejects multimedia selections', () => {
    const images = [boardImage('a.png'), boardImage('b.png'), boardImage('clip.mp4')];
    useImageStore.setState({ images, directories: [boardDirectory] });
    const board = addAssets(createBoardDocument(), images.map(image => ({ name: image.name, mediaType: image.name.endsWith('.mp4') ? 'video' : 'image', reference: createBoardAssetReference(image, [boardDirectory]) })), { x: 0, y: 0 });
    useBoardStore.getState().adoptBoard(board);
    useBoardStore.getState().setSelection(board.id, board.objects.slice(0, 2).map(object => object.id));
    feature.canUseComparison = false;
    render(<CanvasWorkspace loading={false} onOpenImage={vi.fn()} onCompareImages={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected images' }));
    expect(feature.showProModal).toHaveBeenCalledWith('comparison');
    act(() => useBoardStore.getState().setSelection(board.id, board.objects.map(object => object.id)));
    expect((screen.getByRole('button', { name: 'Compare selected images' }) as HTMLButtonElement).disabled).toBe(true);
    feature.canUseCanvas = false;
  });
});
