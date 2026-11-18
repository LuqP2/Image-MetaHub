import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasWorkspace from '../components/CanvasWorkspace';
import { useBoardQueryActions } from '../components/boards/BoardQueryContext';
import { useBoardUIStore } from '../store/useBoardUIStore';
import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';
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
vi.mock('../components/BoardWorkspace', () => ({ default: props => { editor.latest = props; const queries = useBoardQueryActions(); return <div><button onClick={() => queries?.create({ x: 900, y: 600 })}>Create test Smart Frame</button>{props.selectionActions}{props.assetActions}{props.assetMetadata}{props.assetStatus}</div>; } }));
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
    expect(screen.queryByRole('button', { name: 'Locate missing file' })).toBeNull();
    const favorite = vi.spyOn(useImageStore.getState(), 'toggleFavorite').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }));
    expect(favorite).toHaveBeenCalledWith(images[0].id); favorite.mockRestore();
  });
  it('offers file recovery only for an unavailable board reference', () => {
    const image = boardImage('missing.png');
    const board = addAssets(createBoardDocument(), [{ name: image.name, mediaType: 'image', reference: createBoardAssetReference(image, [boardDirectory]) }], { x: 0, y: 0 });
    useImageStore.setState({ images: [], directories: [boardDirectory] });
    useBoardStore.getState().adoptBoard(board);
    useBoardStore.getState().setSelection(board.id, [board.objects[0].id]);
    render(<CanvasWorkspace loading={false} onOpenImage={vi.fn()} onCompareImages={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Locate missing file' })).toBeTruthy();
    expect(screen.getByText('Choose the library file for this board item to restore its reference.')).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: 'Compare selected images' })).toBeNull();
    feature.canUseCanvas = false;
  });
});


it('creates an independent whole-library frame immediately while loading and supports undo/redo', () => {
  const board = createBoardDocument();
  useBoardStore.getState().adoptBoard(board);
  useImageStore.setState({ images: [], searchQuery: 'forest', selectedModels: ['Flux'], isLoading: true });
  useBoardUIStore.getState().setFilterTarget({ boardId: board.id, frameId: 'previous' });
  render(<CanvasWorkspace loading onOpenImage={vi.fn()} onCompareImages={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create test Smart Frame' }));
  const session = useBoardStore.getState().sessions[board.id];
  const frame = session.document.objects[0];
  expect(frame).toMatchObject({ type: 'smart-frame', title: 'Smart Frame', x: 580, y: 390, width: 640, height: 420,
    source: { kind: 'library' }, criteria: normalizeLibraryQueryCriteria(), groupConstraints: [], layout: { kind: 'grid' } });
  expect(session.document.objects).toHaveLength(1);
  expect(session.selectedObjectIds).toEqual([frame.id]);
  expect(session.revealRequest).toMatchObject({ ids: [frame.id], shrink: true });
  expect(session.past).toHaveLength(1);
  expect(useBoardStore.getState().activeBoardId).toBe(board.id);
  expect(useBoardUIStore.getState().filterTarget).toBeNull();
  expect(useImageStore.getState()).toMatchObject({ searchQuery: 'forest', selectedModels: ['Flux'] });
  act(() => useBoardStore.getState().undo(board.id));
  expect(useBoardStore.getState().sessions[board.id].document.objects).toEqual([]);
  act(() => useBoardStore.getState().redo(board.id));
  expect(useBoardStore.getState().sessions[board.id].document.objects).toEqual([frame]);
  fireEvent.click(screen.getByRole('button', { name: 'Create test Smart Frame' }));
  const frames = useBoardStore.getState().sessions[board.id].document.objects;
  expect(frames).toHaveLength(2);
  expect(frames[1].id).not.toBe(frame.id);
  expect(frames[1].x === frame.x && frames[1].y === frame.y).toBe(false);
  useImageStore.setState({ isLoading: false, searchQuery: '', selectedModels: [] });
});

it.each(['read-only', 'closing', 'recovering'] as const)('blocks Smart Frame creation when %s', reason => {
  const board = createBoardDocument();
  useBoardStore.getState().adoptBoard(board);
  if (reason === 'read-only') feature.canUseCanvas = false;
  if (reason === 'closing') useBoardStore.setState({ closing: true });
  if (reason === 'recovering') useBoardStore.setState(state => ({ sessions: { ...state.sessions, [board.id]: { ...state.sessions[board.id], recovering: true } } }));
  render(<CanvasWorkspace loading={false} onOpenImage={vi.fn()} onCompareImages={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create test Smart Frame' }));
  expect(useBoardStore.getState().sessions[board.id].document.objects).toEqual([]);
});
