import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryCanvas } from '../hooks/useLibraryCanvas';
import { captureLibraryForCanvas, insertLibrarySmartFrame } from '../services/boards/libraryCapture';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { boardDirectory, boardImage } from './helpers/boardIntegrationFixtures';

vi.mock('../services/boards/referenceSync', () => ({ getBoardReferenceBaseline: async () => [] }));
const persistence = vi.hoisted(() => ({ list: vi.fn(async () => []), save: vi.fn(async document => ({ ...document, revision: document.revision + 1 })) }));
vi.mock('../services/boards/boardService', () => ({ boardService: {
  save: (...args) => persistence.save(...args), list: () => persistence.list(), flush: async () => {}, load: async () => { throw new Error('Board is unavailable'); },
} }));
const initial = useImageStore.getState();
const upgrade = vi.fn();
let board: ReturnType<typeof createBoardDocument>;
function Harness({ start = 'library', allowed = true, blocked = false }: { start?: string; allowed?: boolean; blocked?: boolean }) {
  const [view, navigate] = useState(start);
  const flow = useLibraryCanvas({ view, navigate, blocked, canEdit: allowed, upgrade });
  return <><span data-testid="view">{view}</span><button onClick={() => flow.explore(board.id)}>Explore library</button>
    <button onClick={() => navigate('canvas')}>Manual Canvas</button>{flow.action}{flow.dialog}</>;
}
beforeEach(() => {
  upgrade.mockClear(); persistence.save.mockClear();
  persistence.save.mockImplementation(async document => ({ ...document, revision: document.revision + 1 }));
  useImageStore.setState({ ...initial, isLoading: false, isLibraryQueryPending: false, directories: [boardDirectory],
    images: [boardImage()], filteredImages: [boardImage()], selectedImages: new Set(['unrelated']),
    selectedModels: ['Model A', 'Model B'], selectedLoras: ['Lora X'], advancedFilters: { dimension: '1024x1024' } });
  useSettingsStore.setState({ enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] });
  useBoardStore.setState({ sessions: {}, summaries: [], activeBoardId: null, openBoardIds: [], closing: false });
  board = { ...createBoardDocument(), name: 'References' };
  useBoardStore.getState().adoptBoard(board);
  persistence.list.mockResolvedValue([{ id: board.id, name: board.name }] as never[]);
});
afterEach(async () => {
  cleanup(); persistence.save.mockImplementation(async document => ({ ...document, revision: document.revision + 1 }));
  await useBoardStore.getState().flushAll();
});
describe('Library to Canvas', () => {
  it('captures independent criteria and creates one undoable frame, selecting and revealing it', async () => {
    const capture = await captureLibraryForCanvas();
    useImageStore.setState({ selectedModels: ['Changed'], advancedFilters: {} });
    insertLibrarySmartFrame(board.id, capture, 'frame');
    const session = useBoardStore.getState().sessions[board.id];
    expect(session.document.objects[0]).toMatchObject({ id: 'frame', source: { kind: 'library' }, criteria: {
      selectedModels: ['Model A', 'Model B'], selectedLoras: ['Lora X'], advancedFilters: { dimension: '1024x1024' },
    } });
    expect(session.past).toHaveLength(1);
    expect(session.selectedObjectIds).toEqual(['frame']);
    expect(session.revealRequest?.ids).toEqual(['frame']);
    useBoardStore.getState().undo(board.id);
    expect(useBoardStore.getState().sessions[board.id].document.objects).toHaveLength(0);
    useBoardStore.getState().redo(board.id);
    expect(useBoardStore.getState().sessions[board.id].document.objects).toHaveLength(1);
  });
  it('captures all scoped results as a Snapshot, ignoring incidental selection', async () => {
    const images = Array.from({ length: 15 }, (_, i) => boardImage(`${i}.png`));
    useImageStore.setState({ images, filteredImages: images, selectedNodes: ['VAELoader'],
      getScopedFilteredImages: () => images, selectedImages: new Set([images[0].id]) });
    const capture = await captureLibraryForCanvas();
    expect(capture.mode).toBe('Snapshot');
    expect(capture.source.kind === 'snapshot' && capture.source.references.length).toBe(15);
    expect(capture.criteria.selectedModels).toEqual([]);
    expect(capture.intentCriteria.selectedModels).toEqual(['Model A', 'Model B']);
  });
  it('rejects pending search results and accepts empty dynamic queries', async () => {
    useImageStore.setState({ isLibraryQueryPending: true });
    await expect(captureLibraryForCanvas()).rejects.toThrow('finish updating');
    useImageStore.setState({ isLibraryQueryPending: false, filteredImages: [] });
    expect(await captureLibraryForCanvas()).toMatchObject({ mode: 'Dynamic', count: 0 });
  });
  it('opens Library from Canvas without creating a frame and adds directly to the original board', async () => {
    render(<Harness start="canvas"/>);
    fireEvent.click(screen.getByText('Explore library'));
    expect(screen.getByTestId('view').textContent).toBe('library');
    expect(useBoardStore.getState().sessions[board.id].document.objects).toHaveLength(0);
    fireEvent.click(screen.getByText('Add to “References”'));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('canvas'));
    expect(useBoardStore.getState().sessions[board.id].document.objects).toHaveLength(1);
  });
  it('freezes the query while choosing a destination, then creates a new board', async () => {
    render(<Harness/>);
    fireEvent.click(screen.getByText('Add to Canvas'));
    await screen.findByRole('dialog');
    expect(screen.getByText(/Checkpoints: Model A, Model B/)).toBeTruthy();
    act(() => useImageStore.setState({ selectedModels: ['Changed'] }));
    fireEvent.change(screen.getByLabelText('New board name'), { target: { value: 'New destination' } });
    fireEvent.click(screen.getByText('Create board and add'));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('canvas'));
    const state = useBoardStore.getState();
    expect(state.activeBoardId).not.toBe(board.id);
    expect(state.sessions[state.activeBoardId!].document).toMatchObject({ name: 'New destination', objects: [
      { criteria: { selectedModels: ['Model A', 'Model B'] } },
    ] });
  });
  it('cancels the destination and manual return without changing Library filters', async () => {
    render(<Harness start="canvas"/>);
    fireEvent.click(screen.getByText('Explore library'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Add to Canvas')).toBeTruthy();
    fireEvent.click(screen.getByText('Explore library'));
    fireEvent.click(screen.getByText('Manual Canvas'));
    expect(screen.getByText('Add to Canvas')).toBeTruthy();
    expect(useImageStore.getState().selectedModels).toEqual(['Model A', 'Model B']);
  });
  it('adds to an existing destination and ignores repeated confirmation clicks', async () => {
    render(<Harness/>);
    fireEvent.click(screen.getByText('Add to Canvas'));
    const destination = await screen.findByRole('button', { name: 'References' });
    fireEvent.click(destination); fireEvent.click(destination);
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('canvas'));
    expect(useBoardStore.getState().sessions[board.id].document.objects).toHaveLength(1);
  });
  it('contains destination dialog keyboard focus and restores it on Escape', async () => {
    render(<Harness/>);
    const add = screen.getByRole('button', { name: 'Add to Canvas' });
    add.focus(); fireEvent.click(add);
    const dialog = await screen.findByRole('dialog');
    await screen.findByRole('button', { name: 'References' });
    expect(document.activeElement).toBe(screen.getByLabelText('Close Add to Canvas'));
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'References' }));
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('Close Add to Canvas'));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(add);
  });
  it('retains the capture when a destination disappears and permits choosing a new board', async () => {
    render(<Harness start="canvas"/>);
    fireEvent.click(screen.getByText('Explore library'));
    act(() => useBoardStore.setState({ sessions: {}, activeBoardId: null }));
    fireEvent.click(screen.getByText('Add to “References”'));
    await screen.findByText('Board is unavailable');
    act(() => useImageStore.setState({ selectedModels: ['Changed'] }));
    fireEvent.click(screen.getByText('Create board and add'));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('canvas'));
    const state = useBoardStore.getState();
    expect(state.sessions[state.activeBoardId!].document.objects[0]).toMatchObject({ criteria: { selectedModels: ['Model A', 'Model B'] } });
  });
  it('retries a failed save without inserting another frame', async () => {
    persistence.save.mockRejectedValue(new Error('Disk unavailable'));
    render(<Harness start="canvas"/>);
    fireEvent.click(screen.getByText('Explore library'));
    fireEvent.click(screen.getByText('Add to “References”'));
    await screen.findByText('Retry saving Smart Frame');
    expect(useBoardStore.getState().sessions[board.id].document.objects).toHaveLength(1);
    persistence.save.mockImplementation(async document => ({ ...document, revision: document.revision + 1 }));
    fireEvent.click(screen.getByText('Retry saving Smart Frame'));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('canvas'));
    expect(useBoardStore.getState().sessions[board.id].document.objects).toHaveLength(1);
  });
  it('respects the edit gate and pending Library state', () => {
    const view = render(<Harness allowed={false}/>);
    fireEvent.click(screen.getByText('Add to Canvas'));
    expect(upgrade).toHaveBeenCalledOnce();
    view.rerender(<Harness blocked/>);
    expect(screen.getByText('Add to Canvas').closest('button')?.disabled).toBe(true);
    expect(useBoardStore.getState().sessions[board.id].document.objects).toHaveLength(0);
  });
});
