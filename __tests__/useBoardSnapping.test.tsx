import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardSnapping } from '../hooks/useBoardSnapping';
import { useBoardStore } from '../store/useBoardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { boardToFlow } from '../services/boards/reactFlowAdapter';
import type { BoardAssetObject, BoardObject } from '../services/boards/types';
const viewport = vi.hoisted(() => ({ x: 0, y: 0, zoom: 1 }));
const flow = vi.hoisted(() => ({ getViewport: () => viewport, screenToFlowPosition: (p: { x: number; y: number }) => ({ x: (p.x - viewport.x) / viewport.zoom, y: (p.y - viewport.y) / viewport.zoom }) }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => flow }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
const card = (id: string, x: number, y: number): BoardAssetObject => ({ id, type: 'asset', mediaType: 'image', x, y, width: 100, height: 100, frameId: null, zIndex: 1, name: id, visibleFields: [], reference: { kind: 'path', locator: { imageId: id, directoryPath: null, relativePath: `${id}.png` } } });
beforeEach(() => { useBoardStore.setState({ sessions: {}, activeBoardId: null }); useSettingsStore.setState({ canvasSmartGuides: true, canvasSnapToGrid: false }); Object.assign(viewport, { x: 0, y: 0, zoom: 1 }); });
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); });
function setup(objects: BoardObject[] = [card('a', 0, 0), card('target', 200, 300)], selected = ['a']) {
  const document = { ...createBoardDocument(), objects };
  const state = useBoardStore.getState(); state.adoptBoard(document); state.setSelection(document.id, selected);
  const { result, unmount, rerender } = renderHook(({ id }) => useBoardSnapping(id), { initialProps: { id: document.id } });
  const nodes = boardToFlow(document, selected, [], true).nodes;
  const start = (shiftKey = false) => act(() => { state.beginInteraction(document.id); result.current.begin(new MouseEvent('mousedown', { clientX: 10, clientY: 10, shiftKey }), nodes.find(node => node.id === 'a')!, nodes.filter(node => selected.includes(node.id))); });
  const change = (x: number, y = 10) => act(() => {
    fireEvent.mouseMove(window, { clientX: x, clientY: y });
    // Deliberately feed a bogus/already corrected Flow position: it must be ignored.
    expect(result.current.filterChanges([{ type: 'position', id: 'a', position: { x: 9999, y: 9999 }, dragging: true }])).toEqual([]);
  });
  const position = () => useBoardStore.getState().sessions[document.id].document.objects.find(object => object.id === 'a')!;
  return { id: document.id, result, unmount, rerender, start, change, position };
}
describe('Canvas snapping drag lifecycle', () => {
  it('never accumulates corrections and recomputes Shift with a stationary mouse', () => {
    const { start, change, position, result } = setup(); start();
    change(107); expect(position().x).toBe(100); expect(result.current.guides).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true }); expect(position().x).toBe(97); expect(result.current.guides).toHaveLength(0);
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false }); expect(position().x).toBe(100);
    change(114); expect(position().x).toBe(100);
    change(117); expect(position().x).toBe(107); expect(result.current.guides).toHaveLength(0);
    change(107); expect(position().x).toBe(100);
    expect(useSettingsStore.getState().canvasSmartGuides).toBe(true);
  });
  it('inverts an initially disabled toggle and leaves grid active under Shift', () => {
    useSettingsStore.setState({ canvasSmartGuides: false, canvasSnapToGrid: true });
    const { start, change, position, result } = setup(); start(); change(107);
    expect(position().x).toBe(96);
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true }); expect(position().x).toBe(100); expect(result.current.guides).toHaveLength(1);
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false }); expect(position().x).toBe(96);
  });
  it('records one history operation, clears guides, and supports undo/redo', () => {
    const { id, start, change, result, position } = setup(); start(); change(107); change(114); change(107);
    expect(useBoardStore.getState().sessions[id].past).toHaveLength(0);
    act(() => { result.current.finish(); useBoardStore.getState().commitInteraction(id); });
    expect(result.current.guides).toHaveLength(0); expect(useBoardStore.getState().sessions[id].past).toHaveLength(1);
    act(() => useBoardStore.getState().undo(id)); expect(position().x).toBe(0);
    act(() => useBoardStore.getState().redo(id)); expect(position().x).toBe(100);
  });
  it.each(['escape', 'blur', 'pointercancel'])('restores originals on %s and rejects late position updates', reason => {
    const { id, start, change, result, position } = setup(); start(); change(107);
    if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent(window, new Event(reason));
    expect(position().x).toBe(0); expect(result.current.guides).toHaveLength(0);
    change(114); expect(position().x).toBe(0);
    act(() => expect(result.current.finish()).toBe(true));
    expect(useBoardStore.getState().sessions[id].past).toHaveLength(0);
  });
  it('cancels a pending gesture on unmount', () => {
    const { id, start, change, unmount, position } = setup(); start(); change(107); unmount();
    expect(position().x).toBe(0); expect(useBoardStore.getState().sessions[id].interaction).toBeNull();
  });
  it('accounts for viewport changes without using corrected positions', () => {
    const { start, change, position } = setup(); start(); Object.assign(viewport, { x: -50, y: 0, zoom: 2 });
    change(164); expect(position().x).toBe(100);
  });
});


it('moves images inside frames by one absolute displacement without changing their spacing', () => {
  const frame: BoardObject = { id: 'frame', type: 'frame', x: 50, y: 50, width: 300, height: 300, frameId: null, zIndex: 0, title: 'Frame', color: '#ffffff' };
  const { id, result, start, change, position } = setup([frame, { ...card('a', 75, 75), frameId: 'frame' }, { ...card('b', 175, 125), frameId: 'frame' }, card('target', 500, 500)], ['a', 'b']);
  start(); change(232);
  expect(position().x).toBe(300);
  const other = useBoardStore.getState().sessions[id].document.objects.find(object => object.id === 'b')!;
  expect(other.x - position().x).toBe(100); expect(other.y - position().y).toBe(50);
  act(() => result.current.finish());
});

it('passes mixed selection position changes through unchanged', () => {
  const text: BoardObject = { ...card('text', 200, 300), type: 'text', text: 'Text', fontSize: 24, color: '#ffffff' };
  const { result, start } = setup([card('a', 0, 0), text], ['a', 'text']); start();
  const changes = [{ type: 'position' as const, id: 'a', position: { x: 97, y: 0 }, dragging: true }];
  act(() => expect(result.current.filterChanges(changes)).toBe(changes));
  fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
  expect(result.current.guides).toHaveLength(0);
});

it('preserves the existing board-switch commit and clears transient guides', () => {
  const { id, result, start, change, rerender, position } = setup(); start(); change(107);
  const next = createBoardDocument(); act(() => useBoardStore.getState().adoptBoard(next));
  rerender({ id: next.id });
  expect(position().x).toBe(100); expect(result.current.guides).toHaveLength(0);
  expect(useBoardStore.getState().sessions[id].interaction).toBeNull();
  expect(useBoardStore.getState().sessions[id].past).toHaveLength(1);
});
