import { addText } from '../services/boards/operations';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BoardCanvas from '../components/boards/BoardCanvas';
vi.mock('../components/boards/BoardMiniMap', () => ({ default: () => null }));
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { clearInternalImageDragData, INTERNAL_IMAGE_DRAG_TYPE } from '../utils/internalImageDrag';
const flow = vi.hoisted(() => ({ screenToFlowPosition: vi.fn().mockReturnValue({ x: 75, y: -20 }), getViewport: vi.fn(), fitView: vi.fn() }));
vi.mock('@xyflow/react', async importOriginal => ({ ...await importOriginal<typeof import('@xyflow/react')>(), ReactFlow: ({ children }) => <div>{children}</div>, Background: () => null, MiniMap: () => null, Panel: ({ children }) => <div>{children}</div>, useReactFlow: () => flow, useViewport: () => ({ x: 0, y: 0, zoom: 1 }) }));
afterEach(() => { vi.unstubAllGlobals(); cleanup(); clearInternalImageDragData(); });
describe('Canvas asset drop', () => {
  it('draws a frame in either direction at converted coordinates and selects it', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    flow.screenToFlowPosition.mockImplementation(point => ({ x: (point.x - 100) / 2, y: (point.y - 50) / 2 }));
    const document = createBoardDocument(); useBoardStore.getState().adoptBoard(document);
    const setTool = vi.fn();
    const view = render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, tool: 'frame', setTool, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn() }}><BoardCanvas boardId={document.id} /></BoardEditorContext.Provider>);
    const overlay = view.getByLabelText('Draw frame');
    Object.defineProperty(overlay, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(overlay, 'getBoundingClientRect', { value: () => ({ left: 200, top: 100 }) });
    fireEvent.pointerDown(overlay, { button: 0, clientX: 700, clientY: 450 });
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 150 });
    const preview = view.container.querySelector<HTMLElement>('.board-draw-preview')!;
    expect(preview.style.position).toBe('absolute');
    expect(preview.style.left).toBe('100px');
    expect(preview.style.top).toBe('50px');
    expect(preview.style.width).toBe('400px');
    expect(preview.style.height).toBe('300px');
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 150 });
    const session = useBoardStore.getState().sessions[document.id];
    expect(session.document.objects).toHaveLength(1);
    expect(session.document.objects[0]).toMatchObject({ type: 'frame', x: 100, y: 50, width: 200, height: 150 });
    expect(session.selectedObjectIds).toEqual([session.document.objects[0].id]);
    expect(session.past).toHaveLength(1);
    expect(setTool).toHaveBeenCalledWith('select');
    flow.screenToFlowPosition.mockReset().mockReturnValue({ x: 75, y: -20 });
  });

  it.each(['ellipse', 'diamond'] as const)('previews %s geometry while drawing', tool => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const doc = createBoardDocument(); useBoardStore.getState().adoptBoard(doc);
    const view = render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, tool, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn() }}><BoardCanvas boardId={doc.id} /></BoardEditorContext.Provider>);
    const overlay = view.getByLabelText(`Draw ${tool}`);
    Object.defineProperty(overlay, 'setPointerCapture', { value: vi.fn() });
    fireEvent.pointerDown(overlay, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(overlay, { clientX: 200, clientY: 100 });
    expect(view.container.querySelector(`.board-draw-preview ${tool === 'ellipse' ? 'ellipse' : 'polygon'}`)).toBeTruthy();
    expect(view.container.querySelector('.board-draw-preview rect')).toBeNull();
  });
  it('connects by dragging between card bodies without moving either card', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const doc = addText(addText(createBoardDocument(), { x: 0, y: 0 }), { x: 400, y: 0 });
    useBoardStore.getState().adoptBoard(doc);
    const view = render(<BoardEditorContext.Provider value={{ editable: true, connecting: true, tool: 'connect', begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn() }}><BoardCanvas boardId={doc.id} /></BoardEditorContext.Provider>);
    const stage = view.container.querySelector<HTMLElement>('.board-stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const source = document.createElement('div'), target = document.createElement('div');
    for (const [element, object] of [[source, doc.objects[0]], [target, doc.objects[1]]] as const) { element.className = 'react-flow__node'; element.dataset.id = object.id; stage.append(element); }
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    fireEvent.pointerDown(source, { button: 0, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(stage, { clientX: 500, clientY: 60 });
    expect(view.getByLabelText('Connection preview')).toBeTruthy();
    fireEvent.pointerUp(stage, { clientX: 500, clientY: 60 });
    const current = useBoardStore.getState().sessions[doc.id];
    expect(current.document.connections).toHaveLength(1);
    expect(current.document.objects).toEqual(doc.objects);
    expect(current.past).toHaveLength(1);
  });

  it('places all dragged references at converted board coordinates', () => {
    const document = createBoardDocument(); useBoardStore.getState().adoptBoard(document);
    const drop = vi.fn();
    const view = render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn(), dropAssets: drop }}><BoardCanvas boardId={document.id} /></BoardEditorContext.Provider>);
    const event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 340 });
    Object.defineProperty(event, 'dataTransfer', { value: { types: [INTERNAL_IMAGE_DRAG_TYPE], getData: () => JSON.stringify({ imageIds: ['first', 'second'] }) } });
    fireEvent(view.container.querySelector('.board-stage')!, event);
    expect(flow.screenToFlowPosition).toHaveBeenCalledWith({ x: 500, y: 340 });
    expect(drop).toHaveBeenCalledWith(['first', 'second'], { x: 75, y: -20 });
  });
});
