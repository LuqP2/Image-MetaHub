import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BoardSelectionResizer from '../components/boards/BoardSelectionResizer';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { addAssets } from '../services/boards/operations';
import { boardLocator } from './helpers/boardFixtures';

const view = vi.hoisted(() => ({ x: 50, y: 20, zoom: 2 }));
vi.mock('@xyflow/react', () => ({ useViewport: () => view, useReactFlow: () => ({ screenToFlowPosition: ({ x, y }) => ({ x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom }) }) }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async document => ({ ...document, revision: document.revision + 1 }), flush: async () => {} } }));

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type, init) { super(type, init); this.pointerId = init?.pointerId ?? 1; } });
  useBoardStore.setState({ sessions: {}, activeBoardId: null, closing: false });
});
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); vi.unstubAllGlobals(); });

function fixture() {
  const document = addAssets(createBoardDocument(), ['a', 'b'].map(name => ({ name, mediaType: 'image' as const, reference: { kind: 'path' as const, locator: boardLocator(name) } })), { x: 0, y: 0 });
  useBoardStore.getState().adoptBoard(document);
  useBoardStore.getState().setSelection(document.id, document.objects.map(object => object.id));
  render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, begin() {}, change() {}, commit() {}, cancel() {} }}><BoardSelectionResizer boardId={document.id} /></BoardEditorContext.Provider>);
  return document;
}
it('scales at zoom and pan, with one undo entry', () => {
  const document = fixture();
  const button = screen.getAllByRole('button', { name: 'Scale selected images se' }).at(-1)!;
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 1218, clientY: 504 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 2386, clientY: 988 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 2386, clientY: 988 });
  const state = useBoardStore.getState();
  expect(state.sessions[document.id].document.objects[0].width).toBeCloseTo(document.objects[0].width * 2);
  expect(state.sessions[document.id].past).toHaveLength(1);
  act(() => state.undo(document.id));
  expect(useBoardStore.getState().sessions[document.id].document.objects).toEqual(document.objects);
});
it.each(['Escape', 'pointercancel', 'selection'])('restores geometry on %s', kind => {
  const document = fixture();
  fireEvent.pointerDown(screen.getAllByRole('button', { name: 'Scale selected images se' }).at(-1)!, { pointerId: 1, clientX: 1218, clientY: 504 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 2386, clientY: 988 });
  if (kind === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  else if (kind === 'pointercancel') fireEvent.pointerCancel(window, { pointerId: 1 });
  else act(() => useBoardStore.getState().setSelection(document.id, []));
  expect(useBoardStore.getState().sessions[document.id].document.objects).toEqual(document.objects);
  expect(useBoardStore.getState().sessions[document.id].past).toHaveLength(0);
});
