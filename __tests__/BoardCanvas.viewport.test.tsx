import { BoardQueryContext } from '../components/boards/BoardQueryContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { useBoardUIStore } from '../store/useBoardUIStore';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardCanvas from '../components/boards/BoardCanvas';
vi.mock('../components/boards/BoardMiniMap', () => ({ default: () => null }));
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { addText, addAssets, createFrame } from '../services/boards/operations';
import { createStack } from '../services/boards/stackOperations';
import { boardLocator } from './helpers/boardFixtures';
import type { NodeChange } from '@xyflow/react';
import type { BoardFlowNode } from '../services/boards/reactFlowAdapter';

const flow = vi.hoisted(() => ({ fitView: vi.fn(), getViewport: vi.fn(), screenToFlowPosition: vi.fn() }));
const rendered = vi.hoisted(() => ({ viewport: null as unknown, props: {} as Record<string, unknown> }));
vi.mock('@xyflow/react', async importOriginal => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  ReactFlow: ({ children, defaultViewport, ...props }) => { rendered.viewport = defaultViewport; rendered.props = props; return <div>{children}</div>; },
  Background: () => null, MiniMap: () => null, Panel: ({ children }) => <div>{children}</div>,
  useReactFlow: () => flow, useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}));
vi.mock('../services/boards/boardService', () => ({ boardService: {
  save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {},
} }));

let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  frames = new Map(); let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  flow.fitView.mockClear();
  useBoardUIStore.setState({ uiHidden: false });
  useBoardStore.setState({ sessions: {}, activeBoardId: null });
});
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); vi.unstubAllGlobals(); });
function runFrames() {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); });
}
function setup() {
  const document = addText(createBoardDocument(), { x: 100, y: 200 });
  const state = useBoardStore.getState();
  state.adoptBoard(document);
  state.setSelection(document.id, [document.objects[0].id]);
  state.requestFitSelection(document.id);
  const mount = () => render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn() }}><BoardCanvas boardId={document.id} /></BoardEditorContext.Provider>);
  return { id: document.id, mount };
}

describe('Canvas fit-selection request lifecycle', () => {
  it('changes board backgrounds from the zoom swatch and pane menu, supports HEX and restores focus on Escape', () => {
    const { id, mount } = setup();
    const { container } = mount();
    const trigger = screen.getByRole('button', { name: 'Board background' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'White' }));
    expect(useBoardStore.getState().sessions[id].document.backgroundColor).toBe('#ffffff');
    expect(container.querySelector<HTMLElement>('.board-stage')?.style.background).toBe('rgb(255, 255, 255)');
    expect(rendered.props.style).toEqual({ background: '#ffffff' });
    fireEvent.change(screen.getByLabelText('Custom background color'), { target: { value: '#123456' } });
    fireEvent.blur(screen.getByLabelText('Custom background color'));
    expect(useBoardStore.getState().sessions[id].document.backgroundColor).toBe('#123456');
    fireEvent.change(screen.getByLabelText('Background HEX'), { target: { value: '#abcdef' } });
    fireEvent.blur(screen.getByLabelText('Background HEX'));
    expect(useBoardStore.getState().sessions[id].document.backgroundColor).toBe('#abcdef');
    fireEvent.change(screen.getByLabelText('Background HEX'), { target: { value: '#xyz' } });
    fireEvent.blur(screen.getByLabelText('Background HEX'));
    expect((screen.getByLabelText('Background HEX') as HTMLInputElement).value).toBe('#abcdef');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Board background' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => (rendered.props.onPaneContextMenu as (event: unknown) => void)({ preventDefault() {}, clientX: 100, clientY: 100 }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change background…' }));
    expect(screen.getByRole('dialog', { name: 'Board background' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Theme default' }));
    expect(useBoardStore.getState().sessions[id].document.backgroundColor).toBeNull();
  });
  it.each([
    { name: 'width then height', steps: [[2, 1], [2, 2]], scale: 2 },
    { name: 'shrink then restore', steps: [[0.5, 1], [1, 1]], scale: 1 },
  ])('resizes frame members from the starting geometry: $name', async ({ steps, scale }) => {
    const assets = addAssets(createBoardDocument(), ['a.png', 'b.png', 'c.png'].map(name => ({ name, mediaType: 'image' as const, reference: { kind: 'path' as const, locator: boardLocator(name) } })), { x: 80, y: 80 });
    const stacked = createStack(assets, assets.objects.slice(0, 2).map(object => object.id));
    const before = createFrame(stacked, stacked.objects.map(object => object.id));
    const frame = before.objects.find(object => object.type === 'frame')!;
    const state = useBoardStore.getState();
    state.adoptBoard(before);
    render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn() }}><BoardCanvas boardId={before.id} /></BoardEditorContext.Provider>);
    for (const [width, height] of steps) act(() => {
      (rendered.props.onNodesChange as (changes: NodeChange<BoardFlowNode>[]) => void)([{ id: frame.id, type: 'dimensions', resizing: true, setAttributes: true, dimensions: { width: frame.width * width, height: frame.height * height } }]);
    });
    act(() => {
      (rendered.props.onNodesChange as (changes: NodeChange<BoardFlowNode>[]) => void)([{ id: frame.id, type: 'dimensions', resizing: false }]);
    });
    const result = useBoardStore.getState().sessions[before.id].document;
    for (const original of before.objects.filter(object => object.type !== 'frame')) {
      expect(result.objects.find(object => object.id === original.id)).toMatchObject({ x: frame.x + (original.x - frame.x) * scale, y: frame.y + (original.y - frame.y) * scale, width: original.width * scale, height: original.height * scale });
    }
    expect(useBoardStore.getState().sessions[before.id].past).toHaveLength(scale === 1 ? 0 : 1);
    if (scale !== 1) {
      act(() => state.undo(before.id));
      expect(useBoardStore.getState().sessions[before.id].document.objects).toEqual(before.objects);
      act(() => state.redo(before.id));
      expect(useBoardStore.getState().sessions[before.id].document.objects).toEqual(result.objects);
    }
    await act(async () => state.flushBoard(before.id));
    expect(useBoardStore.getState().sessions[before.id].saveStatus).toBe('saved');
  });

  it('pans with the wheel and right drag, reserves zoom for modifiers and collapses the map', () => {
    const { mount } = setup(); mount();
    expect(rendered.props.zoomOnScroll).toBe(false);
    expect(rendered.props.zoomActivationKeyCode).toEqual(['Control', 'Meta']);
    expect(rendered.props.panOnDrag).toEqual([1, 2]);
    expect(rendered.props.panOnScroll).toBe(true);
    expect(rendered.props.selectionMode).toBe('partial');
    expect(rendered.props.multiSelectionKeyCode).toEqual(['Control', 'Meta', 'Shift']);
    fireEvent.click(screen.getByRole('button', { name: 'Viewport options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide minimap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Viewport options' }));
    expect(screen.getByRole('button', { name: 'Show minimap' })).toBeTruthy();
  });

  it('hides and restores UI through the context menu without changing panel preferences', () => {
    const { mount } = setup();
    mount();
    const before = useBoardUIStore.getState();
    const open = () => act(() => {
      (rendered.props.onPaneContextMenu as (event: unknown) => void)({ preventDefault() {}, clientX: 120, clientY: 150 });
    });
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide UI' }));
    expect(useBoardUIStore.getState().uiHidden).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show UI' }));
    expect(useBoardUIStore.getState()).toMatchObject({ uiHidden: false, libraryOpen: before.libraryOpen, inspectorOpen: before.inspectorOpen, libraryWidth: before.libraryWidth, inspectorWidth: before.inspectorWidth });
  });

  it('preserves a saved viewport on remount and still handles a later insertion', async () => {
    const { id, mount } = setup();
    const view = mount(); runFrames();
    expect(flow.fitView).toHaveBeenCalledOnce();
    const viewport = { x: 900, y: -450, zoom: 0.65 };
    act(() => useBoardStore.getState().setViewport(id, viewport));
    act(() => useBoardStore.getState().showBoardList());
    view.unmount();
    await act(async () => useBoardStore.getState().openBoard(id));
    mount(); runFrames();
    expect(flow.fitView).toHaveBeenCalledOnce();
    expect(rendered.viewport).toEqual(viewport);
    expect(useBoardStore.getState().sessions[id].document.viewport).toEqual(viewport);
    act(() => useBoardStore.getState().requestFitSelection(id)); runFrames();
    expect(flow.fitView).toHaveBeenCalledTimes(2);
    expect(useBoardStore.getState().sessions[id].changeSequence).toBe(useBoardStore.getState().sessions[id].savedSequence);
  });

  it('keeps a cancelled pending request for remount and consumes an empty selection', () => {
    const { id, mount } = setup();
    const view = mount(); view.unmount(); runFrames();
    expect(flow.fitView).not.toHaveBeenCalled();
    mount(); runFrames();
    expect(flow.fitView).toHaveBeenCalledOnce();
    act(() => { useBoardStore.getState().setSelection(id, []); useBoardStore.getState().requestFitSelection(id); });
    runFrames();
    act(() => useBoardStore.getState().setSelection(id, [useBoardStore.getState().sessions[id].document.objects[0].id]));
    runFrames();
    expect(flow.fitView).toHaveBeenCalledOnce();
    const session = useBoardStore.getState().sessions[id];
    expect(session.handledFitSelectionRequest).toBe(session.fitSelectionRequest);
  });
});

it('offers the two empty-board paths and focuses the reference library', () => {
  const board = createBoardDocument(); useBoardStore.getState().adoptBoard(board);
  const create = vi.fn();
  render(<><input aria-label="Search canvas library" /><BoardQueryContext.Provider value={{ images: new Map(), collections: [], open: vi.fn(), create, retry: vi.fn(), snapshot: vi.fn(), useCurrentFilters: vi.fn() }}>
    <BoardEditorContext.Provider value={{ editable: true, connecting: false, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn() }}><BoardCanvas boardId={board.id} /></BoardEditorContext.Provider>
  </BoardQueryContext.Provider></>);
  fireEvent.click(screen.getByRole('button', { name: 'Add references' })); runFrames();
  expect(useBoardUIStore.getState().libraryOpen).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText('Search canvas library'));
  fireEvent.click(screen.getByRole('button', { name: 'Explore library' })); expect(create).toHaveBeenCalledOnce();
});


it('exposes independent global snapping toggles beside zoom controls', () => {
  useSettingsStore.setState({ canvasSmartGuides: true, canvasSnapToGrid: false });
  setup().mount();
  const objects = screen.getByRole('button', { name: 'Smart Guides / Snap to Objects' });
  const grid = screen.getByRole('button', { name: 'Snap to Grid' });
  expect(objects.textContent).toBe('');
  expect(grid.textContent).toBe('');
  expect(objects.getAttribute('aria-pressed')).toBe('true');
  expect(grid.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(grid);
  expect(useSettingsStore.getState()).toMatchObject({ canvasSmartGuides: true, canvasSnapToGrid: true });
  fireEvent.click(objects);
  expect(useSettingsStore.getState()).toMatchObject({ canvasSmartGuides: false, canvasSnapToGrid: true });
  expect(objects.closest('.board-zoom-row')?.contains(screen.getByRole('button', { name: 'Zoom in' }))).toBe(true);
});


it('retains measured dimensions across document and selection updates without persisting them', () => {
  const { id, mount } = setup(); mount();
  const node = (rendered.props.nodes as { id: string; measured?: { width: number; height: number } }[])[0];
  const change = () => rendered.props.onNodesChange as (changes: unknown[]) => void;
  const before = useBoardStore.getState().sessions[id].changeSequence;
  act(() => change()([{ type: 'dimensions', id: node.id, dimensions: { width: 280, height: 120 } }]));
  expect((rendered.props.nodes as typeof node[])[0].measured).toEqual({ width: 280, height: 120 });
  expect(useBoardStore.getState().sessions[id].changeSequence).toBe(before);
  act(() => change()([{ type: 'position', id: node.id, position: { x: 150, y: 200 }, dragging: true }]));
  expect((rendered.props.nodes as typeof node[])[0].measured).toEqual({ width: 280, height: 120 });
  act(() => useBoardStore.getState().setSelection(id, []));
  expect((rendered.props.nodes as typeof node[])[0].measured).toEqual({ width: 280, height: 120 });
  expect(useBoardStore.getState().sessions[id].document.objects[0]).not.toHaveProperty('measured');
});
