import { useBoardUIStore } from '../store/useBoardUIStore';
import { useBoardEditor } from '../components/boards/BoardEditorContext';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardWorkspace from '../components/BoardWorkspace';
import { addText, addAssets, createFrame, updateObjects } from '../services/boards/operations';
import { boardLocator } from './helpers/boardFixtures';
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
vi.mock('../components/boards/BoardCanvas', () => ({ default: ({ boardId, onFitAll }) => {
  const editor = useBoardEditor();
  return <div data-testid="board-stage"><button onClick={onFitAll}>Fit all</button><button className="react-flow__node" onClick={() => { const state = useBoardStore.getState(); state.setSelection(boardId, [state.sessions[boardId].document.objects[0].id]); editor.inspectSelection?.(); }}>Select test item</button><button onClick={() => useBoardStore.getState().setSelection(boardId, [])}>Clear test selection</button></div>;
} }));

beforeEach(() => { useBoardUIStore.setState({ inspectorOpen: true, libraryOpen: true }); mock.documents.clear(); mock.exported.mockClear(); useBoardStore.setState({ sessions: {}, summaries: [], openBoardIds: [], activeBoardId: null }); });
afterEach(async () => { await act(async () => { await useBoardStore.getState().flushAll(); }); cleanup(); vi.unstubAllGlobals(); });
describe('board workspace flow', () => {
  it('commits a frame resize and scaled images as one undo step and saves the resulting geometry', async () => {
    const state = useBoardStore.getState();
    const id = await state.createBoard('Scale references');
    state.executeOperation(id, doc => {
      const next = addAssets(doc, [{ name: 'image.png', mediaType: 'image', reference: { kind: 'path', locator: boardLocator('image.png') } }], { x: 80, y: 80 });
      return createFrame(next, [next.objects[0].id]);
    });
    const before = useBoardStore.getState().sessions[id].document;
    const frame = before.objects.find(object => object.type === 'frame')!;
    const image = before.objects.find(object => object.type === 'asset')!;
    const past = useBoardStore.getState().sessions[id].past.length;
    for (const scale of [1.5, 2]) state.updateInteraction(id, doc => updateObjects(doc, [{ id: frame.id, width: frame.width * scale, height: frame.height * scale }]));
    state.commitInteraction(id);
    expect(useBoardStore.getState().sessions[id].past).toHaveLength(past + 1);
    expect(useBoardStore.getState().sessions[id].document.objects.find(object => object.id === image.id)?.width).toBeCloseTo(image.width * 2);
    state.undo(id);
    expect(useBoardStore.getState().sessions[id].document.objects).toEqual(before.objects);
    state.redo(id);
    await state.flushBoard(id);
    expect(mock.documents.get(id).objects.find(object => object.id === image.id).width).toBeCloseTo(image.width * 2);
  });
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
    fireEvent.click(screen.getByRole('button', { name: 'Editable board (.imhboard.json)', exact: true }));
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


it('temporarily opens a collapsed inspector and closes it outside without changing the preference', async () => {
  const id = await useBoardStore.getState().createBoard('Inspect');
  useBoardStore.getState().executeOperation(id, doc => addText(doc, { x: 0, y: 0 }));
  useBoardUIStore.getState().setInspectorOpen(false);
  await act(async () => { render(<BoardWorkspace editable/>); });
  expect(screen.queryByLabelText('Board inspector')).toBeNull();
  fireEvent.click(screen.getByText('Select test item'));
  expect(screen.getByLabelText('Board inspector')).toBeTruthy();
  expect(useBoardUIStore.getState().inspectorOpen).toBe(false);
  fireEvent.pointerDown(screen.getByLabelText('Board inspector'));
  expect(screen.getByLabelText('Board inspector')).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Export', exact: true }));
  expect(screen.queryByLabelText('Board inspector')).toBeNull();
  fireEvent.click(screen.getByText('Select test item'));
  expect(screen.getByLabelText('Board inspector')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hide inspector' }));
  expect(screen.queryByLabelText('Board inspector')).toBeNull();
  fireEvent.click(screen.getByText('Select test item'));
  expect(screen.getByLabelText('Board inspector')).toBeTruthy();
  fireEvent.click(screen.getByText('Clear test selection'));
  expect(screen.queryByLabelText('Board inspector')).toBeNull();
});
it('keeps an explicitly open inspector visible on outside clicks and places the library toggle on the left', async () => {
  await useBoardStore.getState().createBoard('Panels');
  await act(async () => { render(<BoardWorkspace editable/>); });
  fireEvent.pointerDown(screen.getByText('Clear test selection'));
  expect(screen.getByLabelText('Board inspector')).toBeTruthy();
  const toggle = screen.getByRole('button', { name: 'Toggle library' });
  const toolbar = screen.getByLabelText('Board tools');
  expect(toolbar.firstElementChild).toBe(toggle);
  expect(toggle.closest('.board-toolbar-end')).toBeNull();
  fireEvent.click(toggle); expect(useBoardUIStore.getState().libraryOpen).toBe(false);
});

it('switches narrow side panels without overwriting widths and restores both on a wide window', async () => {
  let resize: ResizeObserverCallback | undefined;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
  const id = await useBoardStore.getState().createBoard('Narrow panels');
  useBoardStore.getState().executeOperation(id, doc => addText(doc, { x: 0, y: 0 }));
  useBoardUIStore.setState({ libraryWidth: 320, inspectorWidth: 340 });
  await act(async () => { render(<BoardWorkspace editable assetPanel={<p>Asset browser fixture</p>}/>); });
  const setWidth = (width: number) => act(() => resize?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
  setWidth(786);
  expect(screen.getByText('Asset browser fixture')).toBeTruthy();
  expect(screen.queryByLabelText('Board inspector')).toBeNull();
  fireEvent.click(screen.getByText('Select test item'));
  expect(screen.getByLabelText('Board inspector')).toBeTruthy();
  expect(screen.queryByText('Asset browser fixture')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle library' }));
  expect(screen.getByText('Asset browser fixture')).toBeTruthy();
  expect(screen.queryByLabelText('Board inspector')).toBeNull();
  setWidth(1440);
  expect(screen.getByLabelText('Board inspector')).toBeTruthy();
  expect(screen.getByText('Asset browser fixture')).toBeTruthy();
  expect(useBoardUIStore.getState()).toMatchObject({ libraryWidth: 320, inspectorWidth: 340 });
});

it('keeps the replacement library visible while a narrow inspector is requested', async () => {
  let resize: ResizeObserverCallback | undefined;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
  await useBoardStore.getState().createBoard('Replacement');
  await act(async () => { render(<BoardWorkspace editable libraryLocked assetPanel={<p>Replacement browser</p>}/>); });
  act(() => resize?.([{ contentRect: { width: 786 } } as ResizeObserverEntry], {} as ResizeObserver));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle inspector' }));
  expect(screen.getByText('Replacement browser')).toBeTruthy();
  expect(screen.queryByLabelText('Board inspector')).toBeNull();
  expect((screen.getByRole('button', { name: 'Toggle library' }) as HTMLButtonElement).disabled).toBe(true);
});
