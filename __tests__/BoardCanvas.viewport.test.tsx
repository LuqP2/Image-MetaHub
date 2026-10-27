import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardCanvas from '../components/boards/BoardCanvas';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { addText } from '../services/boards/operations';

const flow = vi.hoisted(() => ({ fitView: vi.fn(), getViewport: vi.fn(), screenToFlowPosition: vi.fn() }));
const rendered = vi.hoisted(() => ({ viewport: null as unknown }));
vi.mock('@xyflow/react', async importOriginal => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  ReactFlow: ({ children, defaultViewport }) => { rendered.viewport = defaultViewport; return <div>{children}</div>; },
  Background: () => null,
  useReactFlow: () => flow,
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
  it('preserves a saved viewport on remount and still handles a later insertion', async () => {
    const { id, mount } = setup();
    const view = mount(); runFrames();
    expect(flow.fitView).toHaveBeenCalledOnce();
    const viewport = { x: 900, y: -450, zoom: 0.65 };
    act(() => useBoardStore.getState().setViewport(id, viewport));
    await act(async () => useBoardStore.getState().closeBoard());
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
