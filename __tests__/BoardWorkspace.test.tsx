import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardWorkspace from '../components/BoardWorkspace';
import { addText } from '../services/boards/operations';
import { useBoardStore } from '../store/useBoardStore';

const mock = vi.hoisted(() => ({ documents: new Map(), exported: vi.fn(), setViewport: vi.fn() }));
vi.mock('@xyflow/react', async importOriginal => ({ ...await importOriginal<typeof import('@xyflow/react')>(), useReactFlow: () => ({ setViewport: mock.setViewport }) }));
vi.mock('../services/boards/boardService', () => ({
  boardService: {
    list: async () => [...mock.documents.values()].map(document => ({ ...document, objectCount: document.objects.length })),
    load: async id => mock.documents.get(id),
    save: async (document, revision) => { const saved = { ...document, revision: revision + 1 }; mock.documents.set(saved.id, saved); return saved; },
    remove: async id => { mock.documents.delete(id); }, flush: async () => {}, remapReferences: async () => {},
  },
  exportBoardFile: mock.exported, importBoardFile: async () => null,
}));
// Exercise the workspace/store/inspector without a browser geometry engine.
vi.mock('../components/boards/BoardCanvas', () => ({ default: ({ onFitAll }) => <div data-testid="board-stage"><button onClick={onFitAll}>Fit all</button></div> }));

beforeEach(() => { mock.documents.clear(); mock.exported.mockClear(); useBoardStore.setState({ sessions: {}, summaries: [], activeBoardId: null }); });
afterEach(async () => { await act(async () => { await useBoardStore.getState().flushAll(); }); cleanup(); });
describe('board workspace flow', () => {
  it('fits document geometry to the available stage and caps zoom at actual size', async () => {
    let id = '';
    await act(async () => { id = await useBoardStore.getState().createBoard('Fit'); });
    act(() => useBoardStore.getState().executeOperation(id, document => addText(document, { x: -900, y: 1500 })));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<BoardWorkspace editable />); });
    Object.defineProperty(view!.container.querySelector('.board-stage-container'), 'getBoundingClientRect', { value: () => ({ x: 200, y: 100, width: 1000, height: 600 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Fit all', exact: true }));
    const viewport = mock.setViewport.mock.calls.at(-1)![0];
    const object = useBoardStore.getState().sessions[id].document.objects[0];
    expect(viewport.zoom).toBeLessThanOrEqual(1);
    expect(object.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(0);
    expect(object.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(0);
    expect((object.x + object.width) * viewport.zoom + viewport.x).toBeLessThanOrEqual(1000);
    expect((object.y + object.height) * viewport.zoom + viewport.y).toBeLessThanOrEqual(600);
    expect((object.x + object.width / 2) * viewport.zoom + viewport.x).toBeCloseTo(500);
    expect((object.y + object.height / 2) * viewport.zoom + viewport.y).toBeCloseTo(300);
  });

  it('creates a board, adds text, edits through the inspector and preserves undo', async () => {
    render(<BoardWorkspace editable />);
    fireEvent.change(screen.getByLabelText('New board name'), { target: { value: 'Campaign' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
    await screen.findByRole('button', { name: 'Text', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Text', exact: true }));
    const id = useBoardStore.getState().activeBoardId!;
    expect(useBoardStore.getState().sessions[id].document.objects).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Text', exact: true }).getAttribute('aria-pressed')).toBe('true');
    // The canvas gesture supplies the geometry; selecting a tool only arms it.
    act(() => useBoardStore.getState().executeOperation(id, document => addText(document, { x: 25, y: 50 })));
    const object = useBoardStore.getState().sessions[id].document.objects[0];
    act(() => useBoardStore.getState().setSelection(id, [object.id]));
    fireEvent.change(screen.getByRole('textbox', { name: 'Text', exact: true }), { target: { value: 'Scene one' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Text', exact: true }));
    expect(useBoardStore.getState().sessions[id].document.objects[0]).toMatchObject({ text: 'Scene one' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(useBoardStore.getState().sessions[id].document.objects[0]).toMatchObject({ text: 'Text' });
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    await waitFor(() => expect(mock.exported).toHaveBeenCalled());
  });
  it('keeps existing boards viewable/exportable while disabling editing', async () => {
    let id: string;
    await act(async () => { id = await useBoardStore.getState().createBoard('Read only'); });
    await act(async () => { render(<BoardWorkspace editable={false} />); });
    const text = screen.getByRole('button', { name: 'Text', exact: true }) as HTMLButtonElement;
    expect(text.disabled).toBe(true);
    expect((screen.getByLabelText('Board name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Export', exact: true }) as HTMLButtonElement).disabled).toBe(false);
    expect(useBoardStore.getState().sessions[id!].document.name).toBe('Read only');
  });
});
